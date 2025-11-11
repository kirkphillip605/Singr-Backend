import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ZodType } from 'zod';

import {
  createAuthorizationError,
  createValidationError,
  HttpError,
  replyWithProblem,
} from '../../http/problem';

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

export function requireCustomerContext(request: FastifyRequest): string {
  const user = request.authorization.requireUser();
  const context = request.authorization.activeContext;

  if (context?.type === 'customer') {
    return context.id;
  }

  throw createAuthorizationError('Active customer context is required.', {
    reason: 'customer_context_required',
    userId: user.id,
  });
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
