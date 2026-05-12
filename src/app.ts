import express, { Application, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import webhookRouter from './routes/webhook.route';
import authRouter from './routes/auth.route';
import watchRouter from './routes/watch.route';
import sheetsRouter from './routes/sheets.route';
import { correlationStorage, logger } from './utils/logger';
import { AppError } from './utils/errors';
import { oauth2Client } from './config/oauth.config';
import { tokenRepository } from './repositories/token.repository';

const app: Application = express();

// ──────────────────────────────────────────────────────────────────────────────
// Body Parsers
// ──────────────────────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ──────────────────────────────────────────────────────────────────────────────
// Correlation ID Middleware
// Tags every incoming request with a unique ID that flows automatically
// through all async operations (AsyncLocalStorage).
// The ID is included in every logger.* call made during the request lifecycle.
// ──────────────────────────────────────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const correlationId =
    (req.headers['x-correlation-id'] as string | undefined) || uuidv4();
  res.setHeader('x-correlation-id', correlationId);
  // Run next() inside the AsyncLocalStorage context so all downstream
  // middleware and route handlers inherit the same correlation ID.
  correlationStorage.run(correlationId, next);
});

// ──────────────────────────────────────────────────────────────────────────────
// Request Logger
// ──────────────────────────────────────────────────────────────────────────────

app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`→ ${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ──────────────────────────────────────────────────────────────────────────────
// OAuth Token Auto-Refresh Listener
// When googleapis silently refreshes the access_token, persist the new value
// so it is available on the next cold start (refresh_token never changes after
// first authorization, but expiry_date and access_token do).
// ──────────────────────────────────────────────────────────────────────────────

oauth2Client.on('tokens', async (tokens) => {
  logger.info('Access token refreshed — persisting updated credentials');
  await tokenRepository.save(tokens).catch((err: Error) => {
    logger.error('Failed to persist refreshed tokens', { error: err.message });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

app.use('/auth', authRouter);
app.use('/webhook', webhookRouter);
app.use('/api/watch', watchRouter);
app.use('/api/sheets', sheetsRouter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ──────────────────────────────────────────────────────────────────────────────
// 404 Handler
// ──────────────────────────────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' });
});

// ──────────────────────────────────────────────────────────────────────────────
// Centralized Error Handler
// Express requires a 4-argument signature to recognize this as an error handler.
// ──────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    logger.error(`[${err.code}] ${err.message}`, {
      path: req.path,
      statusCode: err.statusCode,
      details: err.details,
    });
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    });
    return;
  }

  // Unknown / unexpected errors
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
