import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type RequestContextStore = {
  requestId: string;
  userId: string | null;
};

const storage = new AsyncLocalStorage<RequestContextStore>();

declare module 'fastify' {
  interface FastifyRequest {
    singrContext: RequestContextStore;
  }
}

export function getRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}

export function setActiveUser(userId: string | null) {
  const context = storage.getStore();
  if (context) {
    context.userId = userId;
  }
}

export function registerRequestContextPlugin(app: FastifyInstance) {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestId = request.id || randomUUID();
    const store: RequestContextStore = {
      requestId,
      userId: null,
    };

    storage.enterWith(store);
    request.singrContext = store;
    reply.header('x-request-id', requestId);
  });
}
