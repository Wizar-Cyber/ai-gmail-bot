import { AsyncLocalStorage } from 'async_hooks';
import winston from 'winston';
import { env } from '../config/env';

// Each async request context gets its own correlation ID automatically propagated
export const correlationStorage = new AsyncLocalStorage<string>();

const addCorrelationId = winston.format((info) => {
  (info as Record<string, unknown>)['correlationId'] =
    correlationStorage.getStore() ?? '-';
  return info;
});

const devFormat = winston.format.combine(
  winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
  addCorrelationId(),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
    const metaStr = Object.keys(meta).length > 0 ? `  ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${String(correlationId)}] ${level}: ${String(message)}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  addCorrelationId(),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  format: env.NODE_ENV === 'production' ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    }),
  ],
});

/**
 * Runs fn within an async context tagged with correlationId.
 * Every logger call made inside fn (and any awaited code) will include the ID automatically.
 *
 * Works for both sync callbacks (express next) and async route handlers.
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run(correlationId, fn);
}

export function getCorrelationId(): string | undefined {
  return correlationStorage.getStore();
}
