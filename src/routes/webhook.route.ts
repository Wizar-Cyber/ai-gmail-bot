import { Router, Request, Response } from 'express';
import { oauth2Client } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';
import { watchStateRepository } from '../repositories/watch.repository';
import { GmailService } from '../services/gmail.service';
import { EmailProcessorService } from '../services/email-processor.service';
import { AIService } from '../services/ai.service';
import { RAGService } from '../rag/rag.service';
import { validatePubSubToken } from '../middlewares/webhook.middleware';
import { logger } from '../utils/logger';

const router = Router();

const emailProcessor = new EmailProcessorService(new AIService(), new RAGService());

router.post(
  '/gmail',
  validatePubSubToken,
  async (req: Request, res: Response) => {
    res.status(200).send('OK');

    try {
      const pubSubMessage = req.body?.message;
      if (!pubSubMessage?.data) {
        logger.warn('Webhook payload missing message.data', { body: req.body });
        return;
      }

      const decoded = Buffer.from(pubSubMessage.data as string, 'base64').toString('utf-8');
      const notification = JSON.parse(decoded) as { emailAddress?: string; historyId?: string };

      if (!notification.historyId) {
        logger.warn('Pub/Sub notification missing historyId', { notification });
        return;
      }

      logger.info('Processing Gmail notification', {
        emailAddress: notification.emailAddress,
        historyId: notification.historyId,
      });

      const tokens = await tokenRepository.load();
      if (!tokens?.refresh_token) {
        logger.error('No OAuth refresh_token found. Re-authenticate by visiting GET /auth/google');
        return;
      }
      oauth2Client.setCredentials(tokens);

      const gmailService = new GmailService(oauth2Client);
      const watchState = await watchStateRepository.load();
      const startHistoryId = watchState?.lastProcessedHistoryId || notification.historyId;

      const histories = await gmailService.getHistory(startHistoryId);
      if (histories.length === 0) {
        logger.info('No new messages in history', { startHistoryId });
        await watchStateRepository.save({
          ...watchState,
          lastProcessedHistoryId: notification.historyId,
          emailAddress: notification.emailAddress || watchState?.emailAddress,
        });
        return;
      }

      const newMessageIds = new Set<string>();
      for (const history of histories) {
        for (const added of history.messagesAdded ?? []) {
          if (added.message?.id) {
            newMessageIds.add(added.message.id);
          }
        }
      }

      logger.info(`Found ${newMessageIds.size} new message(s) to process`);

      for (const messageId of newMessageIds) {
        await emailProcessor.processEmail(gmailService, messageId).catch((err: Error) => {
          logger.error(`Failed to process message ${messageId}`, {
            error: err.message,
            stack: err.stack,
          });
        });
      }

      await watchStateRepository.save({
        ...watchState,
        lastProcessedHistoryId: notification.historyId,
        emailAddress: notification.emailAddress || watchState?.emailAddress,
      });
    } catch (error) {
      logger.error('Unhandled error in webhook handler', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
);

export default router;
