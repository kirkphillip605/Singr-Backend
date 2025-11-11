import type { Logger, LoggerOptions } from 'pino';
import pino from 'pino';

import type { AppConfig } from '../config';

const REDACT_FIELDS = [
  'req.headers.authorization',
  'res.headers.set-cookie',
  'response.headers.set-cookie',
  'user.password',
  'user.token',
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
    },
  };
}

export function createLogger(config: AppConfig): AppLogger {
  return pino(buildLoggerOptions(config));
}
