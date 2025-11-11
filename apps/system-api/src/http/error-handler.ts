import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { HttpError, replyWithProblem } from './problem';

export function registerErrorHandlers(app: FastifyInstance) {
  app.setErrorHandler(
    (error: FastifyError | HttpError, request: FastifyRequest, reply: FastifyReply) => {
      if (error instanceof HttpError) {
        request.log.warn({ err: error }, 'Handled application error');
        return replyWithProblem(reply, error.problem);
      }

      if (error.validation) {
        request.log.warn({ err: error }, 'Request validation failed');
        return replyWithProblem(reply, {
          title: 'Validation Error',
          status: 422,
          detail: 'The request payload or parameters failed validation.',
          errors: error.validation,
        });
      }

      request.log.error({ err: error }, 'Unhandled error');
      return replyWithProblem(reply, {
        title: 'Internal Server Error',
        status: 500,
        detail: 'An unexpected error occurred.',
      });
    },
  );

  app.setNotFoundHandler((request, reply) => {
    replyWithProblem(reply, {
      title: 'Not Found',
      status: 404,
      detail: `Route ${request.method} ${request.url} was not found`,
    });
  });
}
