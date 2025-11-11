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
