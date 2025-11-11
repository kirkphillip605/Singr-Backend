import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { AuthService } from '../../auth/auth-service';
import { AuthServiceError } from '../../auth/auth-service';
import type { TokenService } from '../../auth/token-service';
import {
  createAuthenticationError,
  createValidationError,
  HttpError,
  replyWithProblem,
} from '../../http/problem';
import type { RedisClient } from '../../lib/redis';
import { enforceSlidingWindowLimit } from '../../rate-limit/redis-window';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1).max(120).optional(),
  displayName: z.string().min(1).max(120).optional(),
  accountType: z.enum(['customer', 'singer', 'user']).optional(),
  organizationName: z.string().min(1).max(160).optional(),
});

const registerSingerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10),
  displayName: z.string().min(1).max(120).optional(),
  nickname: z.string().min(1).max(120).optional(),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const signOutSchema = z.object({
  refreshToken: z.string().min(10),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  token: z.string().min(16),
  password: z.string().min(12),
});

const contextSchema = z.object({
  type: z.enum(['customer', 'singer']),
  id: z.string().uuid(),
});

type RegisterAuthRoutesOptions = {
  config: AppConfig;
  redis: RedisClient;
  authService: AuthService;
};

export async function registerAuthRoutes(app: FastifyInstance, options: RegisterAuthRoutesOptions) {
  const { config, redis, authService } = options;

  app.post('/v1/auth/register', async (request, reply) => {
    await enforceIpRateLimit(redis, config, request, 'register', 3, 60 * 60 * 1000);

    const body = parseBody(registerSchema, request.body);

    try {
      const result = await authService.register({
        email: body.email,
        password: body.password,
        name: body.name,
        displayName: body.displayName,
        accountType: body.accountType ?? 'user',
        organizationName: body.organizationName,
      });

      reply.code(201).send(formatSessionResponse(result.session));
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.post('/v1/auth/register/singer', async (request, reply) => {
    await enforceIpRateLimit(redis, config, request, 'register-singer', 5, 60 * 60 * 1000);

    const body = parseBody(registerSingerSchema, request.body);

    try {
      const result = await authService.registerSinger({
        email: body.email,
        password: body.password,
        displayName: body.displayName ?? body.nickname ?? null,
        name: body.displayName ?? body.nickname ?? null,
        accountType: 'singer',
      });

      reply.code(201).send(formatSessionResponse(result.session));
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.post('/v1/auth/signin', async (request, reply) => {
    await enforceIpRateLimit(redis, config, request, 'signin', 5, 60 * 1000);

    const body = parseBody(signInSchema, request.body);

    try {
      const session = await authService.signIn(body.email, body.password);
      reply.send(formatSessionResponse(session));
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.post('/v1/auth/signout', async (request, reply) => {
    await app.authenticate(request, reply);
    await enforceUserRateLimit(redis, request, 'signout', 30, 60 * 1000);

    const body = parseBody(signOutSchema, request.body);

    try {
      const user = request.authorization.requireUser();
      await authService.signOut(user.id, body.refreshToken);
      reply.code(204).send();
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.post('/v1/auth/password/forgot', async (request, reply) => {
    await enforceIpRateLimit(redis, config, request, 'password-forgot', 5, 60 * 60 * 1000);

    const body = parseBody(forgotPasswordSchema, request.body);

    try {
      await authService.requestPasswordReset(body.email);
      reply.code(202).send({ accepted: true });
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.post('/v1/auth/password/reset', async (request, reply) => {
    await enforceIpRateLimit(redis, config, request, 'password-reset', 5, 60 * 60 * 1000);

    const body = parseBody(resetPasswordSchema, request.body);

    try {
      await authService.resetPassword(body.email, body.token, body.password);
      reply.code(204).send();
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.get('/v1/auth/profile', async (request, reply) => {
    await app.authenticate(request, reply);
    await enforceUserRateLimit(redis, request, 'profile', 30, 60 * 1000);

    try {
      const user = request.authorization.requireUser();
      const profile = await authService.getProfile(user.id, request.authorization.activeContext);
      reply.send(profile);
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });

  app.post('/v1/auth/context', async (request, reply) => {
    await app.authenticate(request, reply);
    await enforceUserRateLimit(redis, request, 'context', 10, 60 * 1000);

    const body = parseBody(contextSchema, request.body);

    try {
      const user = request.authorization.requireUser();
      const token = await authService.switchContext(user.id, body);
      reply.send(formatAccessTokenResponse(token));
    } catch (error) {
      await handleAuthError(request, reply, error);
    }
  });
}

type SessionType = Awaited<ReturnType<AuthService['register']>>['session'];

type AccessTokenType = Awaited<ReturnType<TokenService['createAccessToken']>>;

function formatSessionResponse(session: SessionType) {
  return {
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshToken: session.refreshToken.token,
    refreshTokenExpiresAt: session.refreshToken.expiresAt,
    claims: session.claims,
  };
}

function formatAccessTokenResponse(result: AccessTokenType) {
  return {
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt,
    claims: result.claims,
  };
}

function parseBody<T>(schema: z.ZodSchema<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }

  const error = createValidationError('Invalid request body.', {
    fieldErrors: parsed.error.flatten().fieldErrors,
    formErrors: parsed.error.flatten().formErrors,
  });
  throw error;
}

async function handleAuthError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) {
    replyWithProblem(reply, error.problem);
    return;
  }

  if (error instanceof AuthServiceError) {
    let problem: HttpError | null = null;
    switch (error.code) {
      case 'EMAIL_EXISTS':
        problem = new HttpError({
          title: 'Email Already Registered',
          status: 409,
          detail: error.message,
        });
        break;
      case 'INVALID_CREDENTIALS':
        problem = createAuthenticationError('Invalid email or password.', error);
        break;
      case 'INVALID_TOKEN':
        problem = createValidationError(error.message);
        break;
      case 'NOT_FOUND':
        problem = new HttpError({
          title: 'Not Found',
          status: 404,
          detail: error.message,
        });
        break;
      default:
        break;
    }

    if (problem) {
      replyWithProblem(reply, problem.problem);
      return;
    }
  }

  request.log.error({ err: error }, 'Unhandled auth error');
  const problem = createAuthenticationError('Authentication request failed.', error);
  replyWithProblem(reply, problem.problem);
}

async function enforceIpRateLimit(
  redis: RedisClient,
  config: AppConfig,
  request: FastifyRequest,
  bucket: string,
  limit: number,
  windowMs: number,
) {
  const identifier = resolveClientIdentifier(request, config.rateLimit.trustProxy);
  const key = `auth:${bucket}:ip:${identifier}`;
  await enforceSlidingWindowLimit(redis, key, { limit, windowMs });
}

async function enforceUserRateLimit(
  redis: RedisClient,
  request: FastifyRequest,
  bucket: string,
  limit: number,
  windowMs: number,
) {
  const user = request.authorization.requireUser();
  const key = `auth:${bucket}:user:${user.id}`;
  await enforceSlidingWindowLimit(redis, key, { limit, windowMs });
}

function resolveClientIdentifier(request: FastifyRequest, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]!.trim();
    }
  }

  return request.ip;
}
