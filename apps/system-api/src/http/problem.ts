import type { FastifyReply } from 'fastify';
import { createProblemDocument } from 'problem-json';

export type ProblemDetail = {
  type?: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
};

export type HttpErrorOptions = {
  cause?: unknown;
};

export class HttpError extends Error {
  constructor(
    public readonly problem: ProblemDetail,
    options?: HttpErrorOptions,
  ) {
    super(problem.detail ?? problem.title);
    this.name = 'HttpError';

    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function replyWithProblem(reply: FastifyReply, problem: ProblemDetail) {
  const document = createProblemDocument(problem);
  void reply.code(problem.status).type('application/problem+json').send(document);
}

export const PROBLEM_TYPES = {
  authenticationFailed: 'https://singrkaraoke.com/problems/authentication_failed',
  authorizationDenied: 'https://singrkaraoke.com/problems/authorization_denied',
  rateLimited: 'https://singrkaraoke.com/problems/rate_limited',
  validationError: 'https://singrkaraoke.com/problems/validation_error',
  notFound: 'https://singrkaraoke.com/problems/not_found',
  internalError: 'https://singrkaraoke.com/problems/internal_error',
} as const;

export function createAuthenticationError(detail?: string, cause?: unknown): HttpError {
  return new HttpError(
    {
      type: PROBLEM_TYPES.authenticationFailed,
      title: 'Authentication Failed',
      status: 401,
      detail: detail ?? 'Authentication is required to access this resource.',
    },
    cause ? { cause } : undefined,
  );
}

export function createAuthorizationError(
  detail?: string,
  extras?: Record<string, unknown>,
  cause?: unknown,
): HttpError {
  return new HttpError(
    {
      type: PROBLEM_TYPES.authorizationDenied,
      title: 'Forbidden',
      status: 403,
      detail: detail ?? 'You do not have permission to perform this action.',
      ...extras,
    },
    cause ? { cause } : undefined,
  );
}

export function createValidationError(
  detail: string,
  errors?: Record<string, unknown>,
  cause?: unknown,
): HttpError {
  return new HttpError(
    {
      type: PROBLEM_TYPES.validationError,
      title: 'Validation Failed',
      status: 422,
      detail,
      errors,
    },
    cause ? { cause } : undefined,
  );
}

export function createNotFoundError(
  resource: string,
  extras?: Record<string, unknown>,
  cause?: unknown,
): HttpError {
  return new HttpError(
    {
      type: PROBLEM_TYPES.notFound,
      title: 'Not Found',
      status: 404,
      detail: `${resource} was not found.`,
      ...extras,
    },
    cause ? { cause } : undefined,
  );
}
