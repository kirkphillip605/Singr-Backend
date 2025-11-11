import type { Logger, LoggerOptions } from 'pino';
import pino from 'pino';

import type { AppConfig } from '../config';
import { sanitizeLogValue } from './log-sanitizer';

const REDACT_FIELDS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.x-api-key',
  'request.headers.authorization',
  'request.headers.cookie',
  'res.headers.set-cookie',
  'response.headers.set-cookie',
  'user.password',
  'user.token',
  'payload.password',
  'payload.token',
  'headers.authorization',
  'headers.cookie',
  'config.auth.secret',
  'config.auth.jwtPrivateKey',
  'config.auth.jwtPublicKey',
  'config.storage.secretAccessKey',
  'config.stripe.apiKey',
  'config.stripe.webhookSecret',
  'config.email.smtp.password',
];

export type AppLogger = Logger;

export function buildLoggerOptions(config: AppConfig): LoggerOptions {
  return {
    level: config.logging.level,
    redact: {
      paths: REDACT_FIELDS,
      remove: true,
    },
    formatters: {
      level: (label) => ({ level: label }),
      log: (object) => sanitizeLogValue(object),
    },
  };
}

export function createLogger(config: AppConfig): AppLogger {
  return pino(buildLoggerOptions(config));
}
