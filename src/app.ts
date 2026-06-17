import express, { Application, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { correlationStorage, logger } from './utils/logger';
import { AppError } from './utils/errors';

const app: Application = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId =
    (req.headers['x-correlation-id'] as string | undefined) || uuidv4();
  res.setHeader('x-correlation-id', correlationId);
  correlationStorage.run(correlationId, next);
});

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`→ ${req.method} ${req.path}`, { ip: req.ip });
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    logger.error(`[${err.code}] ${err.message}`, {
      path: req.path,
      statusCode: err.statusCode,
      details: err.details,
    });
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  logger.error('Unhandled server error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
  });
  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred. Check the server logs.',
  });
});

export default app;
