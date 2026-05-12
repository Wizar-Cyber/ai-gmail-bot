import './config/env';

import http from 'http';
import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { startPolling } from './services/polling.service';

const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info('Server started', {
    port: env.PORT,
    environment: env.NODE_ENV,
    aiProvider: env.AI_PROVIDER,
    endpoints: {
      authInit: `http://localhost:${env.PORT}/auth/google`,
      webhook: `http://localhost:${env.PORT}/webhook/gmail`,
      health: `http://localhost:${env.PORT}/health`,
    },
  });

  startPolling();
});

function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception — process will exit', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

export default server;
