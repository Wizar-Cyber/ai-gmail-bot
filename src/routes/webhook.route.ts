import { Router, Request, Response } from 'express';
import { oauth2Client } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';
import { GmailService } from '../services/gmail.service';
import { AIService } from '../services/ai.service';
import { RAGService } from '../rag/rag.service';
import { validatePubSubToken } from '../middlewares/webhook.middleware';
import { logger } from '../utils/logger';
import type { ParsedMessage } from '../services/gmail.service';

const router = Router();

// Singletons — initialized once at module load time
const aiService = new AIService();
const ragService = new RAGService();

// ──────────────────────────────────────────────────────────────────────────────
// POST /webhook/gmail
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Receives Google Cloud Pub/Sub push notifications.
 *
 * Expected body from Pub/Sub:
 * {
 *   "message": {
 *     "data": "<base64url({ emailAddress: string, historyId: string })>",
 *     "messageId": "pub-sub-message-id",
 *     "publishTime": "2024-01-01T00:00:00Z"
 *   },
 *   "subscription": "projects/PROJECT_ID/subscriptions/SUBSCRIPTION_ID"
 * }
 *
 * Flow:
 *   1. Acknowledge Pub/Sub immediately (200 OK) to prevent retries
 *   2. Parse notification → extract historyId
 *   3. Load saved OAuth tokens → authenticate gmail client
 *   4. Fetch history changes since historyId
 *   5. For each new INBOX message → getContent → enrichContext → generateReply → createDraft
 */
router.post(
  '/webhook/gmail',
  validatePubSubToken,
  async (req: Request, res: Response) => {
    // Step 1: ACK immediately — Pub/Sub retries on any non-2xx within the deadline
    res.status(200).send('OK');

    try {
      const pubSubMessage = req.body?.message;
      if (!pubSubMessage?.data) {
        logger.warn('Webhook payload missing message.data', { body: req.body });
        return;
      }

      // Step 2: Decode the base64-encoded notification payload
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

      // Step 3: Load persisted tokens and authenticate
      const tokens = await tokenRepository.load();
      if (!tokens?.refresh_token) {
        logger.error(
          'No OAuth refresh_token found. Re-authenticate by visiting GET /auth/google'
        );
        return;
      }
      oauth2Client.setCredentials(tokens);

      const gmailService = new GmailService(oauth2Client);

      // Step 4: Fetch history to get the specific message IDs that arrived
      const histories = await gmailService.getHistory(notification.historyId);
      if (histories.length === 0) {
        logger.info('No new messages in history', { historyId: notification.historyId });
        return;
      }

      // Deduplicate message IDs across history records
      const newMessageIds = new Set<string>();
      for (const history of histories) {
        for (const added of history.messagesAdded ?? []) {
          if (added.message?.id) {
            newMessageIds.add(added.message.id);
          }
        }
      }

      logger.info(`Found ${newMessageIds.size} new message(s) to process`);

      // Step 5: Process each message independently — one failure should not block others
      for (const messageId of newMessageIds) {
        await processEmail(gmailService, messageId).catch((err: Error) => {
          logger.error(`Failed to process message ${messageId}`, {
            error: err.message,
            stack: err.stack,
          });
        });
      }
    } catch (error) {
      logger.error('Unhandled error in webhook handler', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
);

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Full pipeline for a single email:
 * fetch → RAG enrich → AI reply → create draft
 */
async function processEmail(gmailService: GmailService, messageId: string): Promise<void> {
  logger.info('Fetching message', { messageId });
  const message: ParsedMessage = await gmailService.getMessageContent(messageId);

  logger.info('Message parsed', {
    messageId,
    subject: message.subject,
    from: message.from,
  });

  // RAG: look for relevant FAQ entries based on the email content
  const context = ragService.enrichContext(`${message.subject} ${message.body}`);

  // Generate draft reply via configured AI provider
  const replyText = await aiService.generateReply({
    subject: message.subject,
    body: message.body,
    context: context || undefined,
  });

  // Create the Gmail draft (no sending — requires manual approval)
  const draftId = await gmailService.createDraftReply(message, replyText);

  logger.info('Pipeline completed', {
    messageId,
    draftId,
    subject: message.subject,
    ragUsed: !!context,
  });
}

export default router;
