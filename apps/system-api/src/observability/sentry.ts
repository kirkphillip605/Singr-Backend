import * as Sentry from '@sentry/node';
import '@sentry/tracing';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';

export function initSentry(config: AppConfig) {
  if (!config.sentry.enabled) {
    return;
  }

  if (isSentryEnabled()) {
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn ?? undefined,
    environment: config.env,
    tracesSampleRate: config.sentry.tracesSampleRate,
    profilesSampleRate: config.sentry.profilesSampleRate,
  });
}

export function registerSentryRequestInstrumentation(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (!isSentryEnabled()) {
      return;
    }

    const transaction = Sentry.startTransaction({
      name: `${request.method} ${request.routerPath ?? request.url}`,
      op: 'http.server',
    });

    request.raw.__sentryTransaction = transaction;
  });

  app.addHook('onResponse', async (request, reply) => {
    const transaction = request.raw.__sentryTransaction as Sentry.Transaction | undefined;
    if (!transaction) {
      return;
    }

    transaction.setHttpStatus(reply.statusCode);
    transaction.finish();
  });

  app.addHook('onError', async (request, _reply, error) => {
    if (!isSentryEnabled()) {
      return;
    }

    Sentry.captureException(error, {
      extra: {
        requestId: request.singrContext?.requestId,
      },
    });
  });
}

function isSentryEnabled() {
  return Boolean(Sentry.getCurrentHub().getClient());
}

declare module 'http' {
  interface IncomingMessage {
    __sentryTransaction?: Sentry.Transaction;
  }
}
