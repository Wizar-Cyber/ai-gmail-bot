import fs from 'fs/promises';
import path from 'path';
import { WebmailService, WebmailConfig } from './webmail.service';
import { EmailProcessorService, SmtpConfig } from './email-processor.service';
import { AIService } from './ai.service';
import { RAGService } from '../rag/rag.service';
import { env } from '../config/env';
import { logger } from '../utils/logger';

type AccountConfig = WebmailConfig & SmtpConfig;

const POLL_INTERVAL_MS = 30_000;
const PROCESSED_FILE = 'data/processed-messages.json';

const emailProcessor = new EmailProcessorService(new AIService(), new RAGService());

function getWebmailConfigs(): AccountConfig[] {
  return env.accounts.map((acc) => ({
    host: env.WEBMAIL_HOST,
    port: env.WEBMAIL_PORT,
    username: acc.username,
    password: acc.password,
    tls: env.WEBMAIL_TLS,
    user: acc.username,
    pass: acc.password,
  }));
}

const FOLDERS = env.WEBMAIL_FOLDERS.split(',').map((f) => f.trim()).filter(Boolean);

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

async function poll(): Promise<void> {
  const configs = getWebmailConfigs();

  if (configs.length === 0) {
    logger.warn('No webmail accounts configured');
    return;
  }

  const processed = await loadProcessedIds();

  for (const cfg of configs) {
    const service = new WebmailService(cfg);

    try {
      const messages = await service.pollAccount(FOLDERS);

      for (const msg of messages) {
        if (processed.has(msg.messageId)) {
          logger.debug(`Skipping already processed ${msg.messageId}`);
          continue;
        }

        logger.info(`Processing from ${cfg.username} [${msg.folder}]`, {
          subject: msg.subject.substring(0, 80),
          pdfs: msg.pdfAttachments.length,
        });

        await emailProcessor
          .processEmail(
            async () => msg.pdfAttachments,
            {
              messageId: msg.messageId,
              subject: msg.subject,
              from: msg.from,
              body: msg.body,
            },
            {
              host: env.WEBMAIL_SMTP_HOST,
              port: env.WEBMAIL_SMTP_PORT,
              tls: env.WEBMAIL_SMTP_TLS,
              user: cfg.user,
              pass: cfg.pass,
            },
          )
          .catch((err: Error) => {
            logger.error(`Failed to process ${msg.messageId}`, { error: err.message });
          });

        await saveProcessedId(msg.messageId);
      }
    } catch (err: any) {
      logger.error(`Polling error for ${cfg.username}`, { error: err.message });
    }
  }
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startPolling(): void {
  const interval = parseInt(env.POLL_INTERVAL || String(POLL_INTERVAL_MS), 10);
  logger.info(`Webmail polling started every ${interval / 1000}s for ${env.accounts.length} account(s)`);
  logger.info(`Folders: ${FOLDERS.join(', ')}`);

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
