import fs from 'fs/promises';
import path from 'path';
import { oauth2Client } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';
import { GmailService } from '../services/gmail.service';
import { EmailProcessorService } from '../services/email-processor.service';
import { AIService } from '../services/ai.service';
import { RAGService } from '../rag/rag.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

const POLL_INTERVAL_MS = 30_000;
const PROCESSED_FILE = 'data/processed-messages.json';

const emailProcessor = new EmailProcessorService(new AIService(), new RAGService());

async function loadProcessedIds(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.resolve(PROCESSED_FILE), 'utf-8');
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

async function saveProcessedId(messageId: string): Promise<void> {
  const ids = await loadProcessedIds();
  ids.add(messageId);
  await fs.mkdir(path.dirname(PROCESSED_FILE), { recursive: true });
  await fs.writeFile(PROCESSED_FILE, JSON.stringify([...ids]), 'utf-8');
}

async function processMessage(gmailService: GmailService, messageId: string): Promise<void> {
  logger.info('Polling: fetching message', { messageId });

  await emailProcessor.processEmail(gmailService, messageId);
  await saveProcessedId(messageId);
}

async function poll(): Promise<void> {
  try {
    const tokens = await tokenRepository.load();
    if (!tokens?.refresh_token) {
      logger.debug('Polling: no tokens yet, skipping');
      return;
    }

    oauth2Client.setCredentials(tokens);
    const gmailService = new GmailService(oauth2Client);

    const unread = await gmailService.listUnreadMessages(50);
    if (unread.length === 0) {
      logger.info('Polling: sin correos nuevos');
      return;
    }

    const processed = await loadProcessedIds();
    const pending = unread.filter((m) => m.id && !processed.has(m.id));

    if (pending.length === 0) {
      logger.info(`Polling: ${unread.length} no leídos, todos ya procesados antes`);
      return;
    }

    logger.info(`Polling: ${pending.length} correo(s) nuevo(s) por procesar`);

    for (const msg of pending) {
      if (!msg.id) continue;
      await processMessage(gmailService, msg.id).catch((err: Error) => {
        logger.error(`Polling: failed to process ${msg.id}`, { error: err.message });
      });
    }
  } catch (err: any) {
    logger.error('Polling cycle error', { error: err.message });
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startPolling(): void {
  const interval = parseInt(env.POLL_INTERVAL || String(POLL_INTERVAL_MS), 10);

  logger.info(`Polling started every ${interval / 1000}s`);

  poll();
  intervalHandle = setInterval(poll, interval);
}

export function stopPolling(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info('Polling stopped');
  }
}
