import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  createAuthorizationError,
  createValidationError,
  HttpError,
  replyWithProblem,
} from '../../http/problem';

const GLOBAL_ADMIN_ROLES = ['platform-admin'];

export function parseBody<T>(schema: ZodType<T>, body: unknown, message?: string): T {
  return parseWithSchema(schema, body, message ?? 'Invalid request body.');
}

export function parseQuery<T>(schema: ZodType<T>, query: unknown, message?: string): T {
  return parseWithSchema(schema, query, message ?? 'Invalid query parameters.');
}

export function parseParams<T>(schema: ZodType<T>, params: unknown, message?: string): T {
  return parseWithSchema(schema, params, message ?? 'Invalid route parameters.');
}

export async function handleRouteError(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) {
    replyWithProblem(reply, error.problem);
    return;
  }

  throw error;
}

export function requireGlobalAdmin(request: FastifyRequest) {
  const user = request.authorization.requireUser();
  const hasRole = request.authorization.hasAnyGlobalRole(GLOBAL_ADMIN_ROLES);

  if (!hasRole) {
    throw createAuthorizationError('Global administrator role is required.', {
      requiredRoles: GLOBAL_ADMIN_ROLES,
      userId: user.id,
    });
  }

  return user;
}

function parseWithSchema<T>(schema: ZodType<T>, value: unknown, message: string): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }

  const flattened = parsed.error.flatten();

  throw createValidationError(message, {
    fieldErrors: flattened.fieldErrors,
    formErrors: flattened.formErrors,
  });
}
