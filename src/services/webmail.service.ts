import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { logger } from '../utils/logger';
import { WebmailServiceError } from '../utils/errors';

export interface WebmailConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}

export interface AttachmentData {
  filename: string;
  data: Buffer;
  mimeType: string;
  size: number;
}

export interface ParsedWebmailMessage {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  date: Date;
  body: string;
  folder: string;
  pdfAttachments: AttachmentData[];
}

export class WebmailService {
  private config: WebmailConfig;

  constructor(config: WebmailConfig) {
    this.config = config;
  }

  get accountLabel(): string {
    return this.config.username;
  }

  private createConnection(): Imap {
    return new Imap({
      user: this.config.username,
      password: this.config.password,
      host: this.config.host,
      port: this.config.port,
      tls: this.config.tls,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 10000,
    });
  }

  private connect(imap: Imap): Promise<void> {
    return new Promise((resolve, reject) => {
      imap.once('ready', resolve);
      imap.once('error', reject);
      imap.connect();
    });
  }

  private openBox(imap: Imap, boxName: string, readOnly = false): Promise<Imap.Box> {
    return new Promise((resolve, reject) => {
      imap.openBox(boxName, readOnly, (err, box) => {
        if (err) reject(err);
        else resolve(box);
      });
    });
  }

  private search(imap: Imap, criteria: any[]): Promise<number[]> {
    return new Promise((resolve, reject) => {
      imap.search(criteria, (err, results) => {
        if (err) reject(err);
        else resolve(results || []);
      });
    });
  }

  private fetchSingleMessage(imap: Imap, uid: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const fetch = imap.fetch(uid, { bodies: '', struct: true, markSeen: false });
      const chunks: Buffer[] = [];
      let fetched = false;

      fetch.on('message', (msg) => {
        fetched = true;
        msg.on('body', (stream) => {
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        });
        msg.once('end', () => {
          resolve(Buffer.concat(chunks));
        });
      });

      fetch.once('error', reject);

      fetch.once('end', () => {
        if (!fetched) resolve(Buffer.from(''));
      });
    });
  }

  private addFlags(imap: Imap, uids: number[], flags: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      imap.addFlags(uids, flags, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async pollAccount(folders: string[] = ['INBOX', 'Spam', 'Junk']): Promise<ParsedWebmailMessage[]> {
    const results: ParsedWebmailMessage[] = [];
    const imap = this.createConnection();

    try {
      await this.connect(imap);
      logger.info(`[${this.config.username}] Connected to IMAP`);

      for (const folder of folders) {
        try {
          let box: Imap.Box;
          try {
            box = await this.openBox(imap, folder, false);
          } catch {
            logger.debug(`[${this.config.username}] Folder "${folder}" not found, skipping`);
            continue;
          }

          const uids = await this.search(imap, ['UNSEEN']);
          if (uids.length === 0) {
            logger.info(`[${this.config.username}] No unread messages in ${folder}`);
            continue;
          }

          logger.info(`[${this.config.username}] ${uids.length} unread message(s) in ${folder}`);

          const processedUids: number[] = [];

          for (const uid of uids) {
            try {
              const raw = await this.fetchSingleMessage(imap, uid);
              if (raw.length === 0) continue;

              const parsed = await simpleParser(raw);

              const pdfAttachments: AttachmentData[] = [];
              if (parsed.attachments && parsed.attachments.length > 0) {
                for (const att of parsed.attachments) {
                  const fn = (att.filename || '').toLowerCase();
                  const ct = (att.contentType || '').toLowerCase();
                  const isPdf = fn.endsWith('.pdf') || ct === 'application/pdf';
                  if (isPdf && att.content) {
                    pdfAttachments.push({
                      filename: att.filename || 'unnamed.pdf',
                      data: att.content,
                      mimeType: att.contentType || 'application/pdf',
                      size: att.content.length,
                    });
                  }
                }
              }

              if (pdfAttachments.length === 0) {
                logger.debug(`[${this.config.username}] Skipping message without PDF: "${(parsed.subject || '').substring(0, 80)}"`);
                processedUids.push(uid);
                continue;
              }

              results.push({
                uid,
                messageId: parsed.messageId || `uid-${uid}-${Date.now()}`,
                subject: parsed.subject || '',
                from: parsed.from?.text || '(unknown sender)',
                date: parsed.date || new Date(),
                body: parsed.text || '',
                folder,
                pdfAttachments,
              });

              processedUids.push(uid);

              logger.info(`[${this.config.username}] PDFs from ${folder}: "${(parsed.subject || '').substring(0, 80)}"`, {
                uid,
                pdfCount: pdfAttachments.length,
                filenames: pdfAttachments.map(a => a.filename),
              });
            } catch (msgErr: any) {
              logger.error(`[${this.config.username}] Failed to process UID ${uid}`, {
                error: msgErr.message,
              });
              processedUids.push(uid);
            }
          }

          if (processedUids.length > 0) {
            await this.addFlags(imap, processedUids, ['\\Seen']);
            logger.info(`[${this.config.username}] Marked ${processedUids.length} as SEEN in ${folder}`);
          }
        } catch (folderErr: any) {
          logger.warn(`[${this.config.username}] Error processing folder "${folder}": ${folderErr.message}`);
        }
      }
    } catch (err: any) {
      throw new WebmailServiceError(
        `IMAP connection failed for ${this.config.username}: ${err.message}`,
        err
      );
    } finally {
      try { imap.end(); } catch { /* ignore */ }
    }

    return results;
  }
}
