import { Router, Request, Response } from 'express';
import { oauth2Client } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';
import { watchStateRepository } from '../repositories/watch.repository';
import { GmailService } from '../services/gmail.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { TokenError, ConfigurationError } from '../utils/errors';

const router = Router();

function getAuthenticatedGmailService(): GmailService | null {
  oauth2Client.setCredentials(null as any);
  // Will fail at runtime if no tokens — handled by each route
  return new GmailService(oauth2Client);
}

async function ensureAuthenticated(): Promise<GmailService> {
  const tokens = await tokenRepository.load();
  if (!tokens?.refresh_token) {
    throw new TokenError(
      'No OAuth tokens found. Run "npm run auth" or visit GET /auth/google first.'
    );
  }
  oauth2Client.setCredentials(tokens);
  return new GmailService(oauth2Client);
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/watch/start
// ──────────────────────────────────────────────────────────────────────────────

router.post('/start', async (_req: Request, res: Response) => {
  try {
    const topicName = env.GOOGLE_PUBSUB_TOPIC;
    if (!topicName) {
      throw new ConfigurationError(
        'GOOGLE_PUBSUB_TOPIC is not set. Add it to your .env file (e.g. projects/my-project/topics/gmail).'
      );
    }

    const gmail = await ensureAuthenticated();
    const result = await gmail.setupWatch(topicName);

    await watchStateRepository.save({
      historyId: result.historyId,
      emailAddress: result.emailAddress,
      expiration: result.expiration,
      lastProcessedHistoryId: result.historyId,
      topicName,
    });

    const expiresAt = new Date(result.expiration).toISOString();

    logger.info('Gmail watch started', {
      historyId: result.historyId,
      emailAddress: result.emailAddress,
      expiresAt,
    });

    res.json({
      status: 'ok',
      historyId: result.historyId,
      emailAddress: result.emailAddress,
      expiresAt,
      expiresInDays: 7,
    });
  } catch (error: any) {
    logger.error('Failed to start Gmail watch', {
      error: error.message,
      code: error.code,
    });

    if (error.code === 'WATCH_ERROR' || error.code === 'TOKEN_ERROR' || error.code === 'CONFIGURATION_ERROR') {
      res.status(error.statusCode || 502).json({
        error: error.code,
        message: error.message,
      });
      return;
    }

    res.status(502).json({
      error: 'WATCH_ERROR',
      message: `Failed to start watch: ${error.message}`,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/watch/renew
// ──────────────────────────────────────────────────────────────────────────────

router.post('/renew', async (_req: Request, res: Response) => {
  try {
    const state = await watchStateRepository.load();
    const topicName = state?.topicName || env.GOOGLE_PUBSUB_TOPIC;

    if (!topicName) {
      throw new ConfigurationError(
        'GOOGLE_PUBSUB_TOPIC is not set. Start the watch first via POST /api/watch/start.'
      );
    }

    const gmail = await ensureAuthenticated();
    const result = await gmail.setupWatch(topicName);

    await watchStateRepository.save({
      ...state,
      historyId: result.historyId,
      emailAddress: result.emailAddress || state?.emailAddress,
      expiration: result.expiration,
      lastProcessedHistoryId: state?.lastProcessedHistoryId || result.historyId,
      topicName,
    });

    const expiresAt = new Date(result.expiration).toISOString();
    logger.info('Gmail watch renewed', { expiresAt });

    res.json({
      status: 'ok',
      historyId: result.historyId,
      expiresAt,
      expiresInDays: 7,
    });
  } catch (error: any) {
    logger.error('Failed to renew Gmail watch', { error: error.message });
    res.status(error.statusCode || 502).json({
      error: error.code || 'WATCH_ERROR',
      message: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/watch/status
// ──────────────────────────────────────────────────────────────────────────────

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const state = await watchStateRepository.load();

    if (!state) {
      res.json({
        active: false,
        message: 'No watch has been started yet. POST /api/watch/start to begin.',
      });
      return;
    }

    const now = Date.now();
    const isExpired = state.expiration ? now > state.expiration : true;
    const expiresAt = state.expiration ? new Date(state.expiration).toISOString() : null;

    res.json({
      active: !isExpired,
      historyId: state.historyId,
      lastProcessedHistoryId: state.lastProcessedHistoryId,
      emailAddress: state.emailAddress,
      expiresAt,
      expiresInMs: state.expiration ? Math.max(0, state.expiration - now) : 0,
      topicName: state.topicName,
    });
  } catch (error: any) {
    logger.error('Failed to get watch status', { error: error.message });
    res.status(500).json({ error: 'INTERNAL_ERROR', message: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/watch/stop
// ──────────────────────────────────────────────────────────────────────────────

router.delete('/stop', async (_req: Request, res: Response) => {
  try {
    const gmail = await ensureAuthenticated();
    await gmail.stopWatch();

    await watchStateRepository.clear();

    logger.info('Gmail watch stopped');

    res.json({ status: 'ok', message: 'Watch stopped and state cleared.' });
  } catch (error: any) {
    logger.error('Failed to stop Gmail watch', { error: error.message });
    res.status(error.statusCode || 502).json({
      error: error.code || 'WATCH_ERROR',
      message: error.message,
    });
  }
});

export default router;
