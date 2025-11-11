import * as Sentry from '@sentry/node';
import type { Hub, Transaction } from '@sentry/node';
import '@sentry/tracing';
import type { FastifyInstance } from 'fastify';

import type { AppConfig } from '../config';

type InitSentryOptions = {
  serviceName?: string;
  release?: string | null;
};

export function initSentry(config: AppConfig, options: InitSentryOptions = {}) {
  if (!config.sentry.enabled) {
    return;
  }

  if (isSentryEnabled()) {
    return;
  }

  const release = options.release ?? config.sentry.release ?? process.env.SENTRY_RELEASE ?? null;
  const environment = config.sentry.environment ?? config.env;
  const serverName = config.sentry.serverName ?? undefined;
  const serviceName = options.serviceName ?? 'system-api';

  Sentry.init({
    dsn: config.sentry.dsn ?? undefined,
    environment,
    release: release ?? undefined,
    serverName,
    tracesSampleRate: config.sentry.tracesSampleRate,
    profilesSampleRate: config.sentry.profilesSampleRate,
    integrations: [new Sentry.Integrations.Http({ tracing: true })],
  });

  Sentry.configureScope((scope) => {
    scope.setTag('service', serviceName);
    scope.setTag('environment', environment);
    scope.setTag('node_env', config.env);
    if (release) {
      scope.setTag('release', release);
    }
  });
}

export function registerSentryRequestInstrumentation(app: FastifyInstance) {
  app.addHook('onRequest', async (request) => {
    if (!isSentryEnabled()) {
      return;
    }

    const hub = Sentry.getCurrentHub().clone();
    const requestId = request.singrContext?.requestId ?? request.id;

    hub.configureScope((scope) => {
      scope.setTag('request_id', requestId);
      scope.setTag('http.method', request.method);
      scope.setContext('request', {
        method: request.method,
        url: request.url,
        route: request.routerPath,
        requestId,
      });
      const userId = request.singrContext?.userId;
      if (userId) {
        scope.setUser({ id: userId });
      }
    });

    const transaction = hub.startTransaction({
      name: `${request.method} ${request.routerPath ?? request.url}`,
      op: 'http.server',
    });

    hub.configureScope((scope) => {
      scope.setSpan(transaction);
    });

    request.raw.__sentryHub = hub;
    request.raw.__sentryTransaction = transaction;
  });

  app.addHook('onResponse', async (request, reply) => {
    const transaction = request.raw.__sentryTransaction as Transaction | undefined;
    if (!transaction) {
      return;
    }

    transaction.setHttpStatus(reply.statusCode);
    transaction.finish();

    const hub = request.raw.__sentryHub as Hub | undefined;
    hub?.configureScope((scope) => {
      scope.setUser(undefined);
    });
  });

  app.addHook('onError', async (request, _reply, error) => {
    if (!isSentryEnabled()) {
      return;
    }

    const hub = (request.raw.__sentryHub as Hub | undefined) ?? Sentry.getCurrentHub();
    hub.captureException(error, {
      extra: {
        requestId: request.singrContext?.requestId,
      },
    });

    Sentry.addBreadcrumb({
      message: 'Request failed',
      category: 'fastify',
      level: 'error',
      data: {
        method: request.method,
        url: request.url,
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
    __sentryTransaction?: Transaction;
    __sentryHub?: Hub;
  }
}
