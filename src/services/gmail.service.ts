import { google, gmail_v1 } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { extractBodyFromPayload, getHeader } from '../utils/parser.util';
import { withRetry } from '../utils/retry';
import { GmailServiceError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Normalized representation of a Gmail message.
 * Used throughout the application — decoupled from the raw API schema.
 */
export interface ParsedMessage {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  messageIdHeader: string;
  body: string;
}

export interface AttachmentData {
  filename: string;
  data: Buffer;
  mimeType: string;
  size: number;
}

export interface WatchResult {
  historyId: string;
  emailAddress?: string;
  expiration: number;
}

export class GmailService {
  private readonly gmail: gmail_v1.Gmail;

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Lists unread message stubs (id + threadId only).
   * Full content must be fetched separately via getMessageContent().
   */
  async listUnreadMessages(maxResults = 10): Promise<gmail_v1.Schema$Message[]> {
    try {
      const response = await withRetry(() =>
        this.gmail.users.messages.list({
          userId: 'me',
          q: 'is:unread',
          maxResults,
        })
      );
      return response.data.messages ?? [];
    } catch (error) {
      throw new GmailServiceError('Failed to list unread messages', error);
    }
  }

  /**
   * Fetches a full message and normalizes it to ParsedMessage.
   * Handles multipart/alternative, text/plain, text/html, and empty bodies.
   */
  async getMessageContent(messageId: string): Promise<ParsedMessage> {
    let raw: gmail_v1.Schema$Message;

    try {
      const response = await withRetry(() =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        })
      );
      raw = response.data;
    } catch (error) {
      throw new GmailServiceError(`Failed to fetch message ${messageId}`, error);
    }

    if (!raw.payload) {
      throw new GmailServiceError(
        `Message ${messageId} returned no payload. The message may have been deleted.`
      );
    }

    const headers = raw.payload.headers ?? [];
    const subject = getHeader(headers, 'Subject') || '(no subject)';
    const from = getHeader(headers, 'From') || '(unknown sender)';
    const messageIdHeader = getHeader(headers, 'Message-ID');
    const body = extractBodyFromPayload(raw.payload);

    if (!body.trim()) {
      logger.warn('Message body is empty after parsing', { messageId, mimeType: raw.payload.mimeType });
    }

    return {
      messageId: raw.id!,
      threadId: raw.threadId!,
      subject,
      from,
      messageIdHeader,
      body: body.trim() || '(empty body)',
    };
  }

  /**
   * Creates a draft reply to message.
   * Builds a RFC 2822-compliant MIME message with correct threading headers.
   * Does NOT send the email — the draft must be reviewed and sent manually.
   *
   * Returns the id of the created draft.
   */
  async createDraftReply(message: ParsedMessage, responseText: string): Promise<string> {
    // Strip leading "Re:" prefixes to avoid "Re: Re: Re:" accumulation
    const cleanSubject = message.subject.replace(/^(re:\s*)+/i, '').trim();

    // RFC 2822 raw message headers + body.
    // Content-Transfer-Encoding: base64 allows UTF-8 content to be safely
    // embedded in the outer raw field (which is also base64url-encoded).
    const bodyBase64 = Buffer.from(responseText, 'utf-8').toString('base64');

    const rawLines = [
      `To: ${message.from}`,
      `Subject: Re: ${cleanSubject}`,
      `In-Reply-To: ${message.messageIdHeader}`,
      `References: ${message.messageIdHeader}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      bodyBase64,
    ];

    // The Gmail API's `raw` field must be base64url-encoded
    const encodedRaw = Buffer.from(rawLines.join('\r\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    try {
      const response = await withRetry(() =>
        this.gmail.users.drafts.create({
          userId: 'me',
          requestBody: {
            message: {
              raw: encodedRaw,
              threadId: message.threadId,
            },
          },
        })
      );

      const draftId = response.data.id!;
      logger.info('Draft reply created', {
        draftId,
        messageId: message.messageId,
        to: message.from,
        subject: `Re: ${cleanSubject}`,
      });
      return draftId;
    } catch (error) {
      throw new GmailServiceError(
        `Failed to create draft reply for message ${message.messageId}`,
        error
      );
    }
  }

  /**
   * Returns Gmail history records (new messages only) since startHistoryId.
   * Used by the Pub/Sub webhook to detect which specific messages arrived.
   *
   * IMPORTANT: historyId values are opaque and must be stored from the last
   * processed notification; do not use an arbitrary integer.
   */
  async getHistory(startHistoryId: string): Promise<gmail_v1.Schema$History[]> {
    try {
      const response = await withRetry(() =>
        this.gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded'],
          labelId: 'INBOX',
        })
      );
      return response.data.history ?? [];
    } catch (error) {
      throw new GmailServiceError(
        `Failed to fetch history starting at historyId ${startHistoryId}`,
        error
      );
    }
  }

  // ── Watch Management ────────────────────────────────────────────────────

  async setupWatch(topicName: string): Promise<WatchResult> {
    try {
      const response = await withRetry(() =>
        this.gmail.users.watch({
          userId: 'me',
          requestBody: {
            topicName,
            labelIds: ['INBOX'],
            labelFilterAction: 'include',
          },
        })
      );

      const watchData = response.data as any;
      return {
        historyId: watchData.historyId as string,
        emailAddress: (watchData.emailAddress as string) ?? undefined,
        expiration: parseInt(watchData.expiration as string, 10),
      };
    } catch (error) {
      throw new GmailServiceError('Failed to set up Gmail watch', error);
    }
  }

  async stopWatch(): Promise<void> {
    try {
      await withRetry(() =>
        this.gmail.users.stop({
          userId: 'me',
        })
      );
    } catch (error) {
      throw new GmailServiceError('Failed to stop Gmail watch', error);
    }
  }

  // ── Attachment Download ─────────────────────────────────────────────────

  async getPdfAttachmentFilenames(messageId: string): Promise<string[]> {
    try {
      const response = await withRetry(() =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        })
      );
      const filenames: string[] = [];
      this._collectFilenames(response.data.payload, filenames);
      return filenames.filter((f) => f.toLowerCase().endsWith('.pdf'));
    } catch (error) {
      throw new GmailServiceError(`Failed to get attachment list for message ${messageId}`, error);
    }
  }

  async downloadAttachment(
    messageId: string,
    attachmentId: string,
    filename: string,
    mimeType: string
  ): Promise<AttachmentData> {
    const response = await withRetry(() =>
      this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      })
    );

    const rawData = response.data.data!;
    const standard = rawData.replace(/-/g, '+').replace(/_/g, '/');
    const data = Buffer.from(standard, 'base64');

    return {
      filename: filename || 'unnamed',
      data,
      mimeType: mimeType || 'application/octet-stream',
      size: data.length,
    };
  }

  async getPdfAttachments(messageId: string): Promise<AttachmentData[]> {
    const attachments: AttachmentData[] = [];

    try {
      const response = await withRetry(() =>
        this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        })
      );

      const parts = this._collectAttachmentParts(response.data.payload);
      for (const part of parts) {
        const fn = (part.filename || '').toLowerCase();
        if (!fn.endsWith('.pdf')) continue;

        const partBody = part.body;
        if (partBody?.attachmentId) {
          const data = await this.downloadAttachment(
            messageId,
            partBody.attachmentId,
            part.filename || 'unnamed',
            part.mimeType || 'application/pdf'
          );
          attachments.push(data);
        }
      }
    } catch (error) {
      throw new GmailServiceError(`Failed to get PDF attachments for message ${messageId}`, error);
    }

    return attachments;
  }

  private _collectFilenames(
    payload: gmail_v1.Schema$MessagePart | undefined | null,
    result: string[]
  ): void {
    if (!payload) return;
    if (payload.filename) {
      result.push(payload.filename);
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        this._collectFilenames(part, result);
      }
    }
  }

  private _collectAttachmentParts(
    payload: gmail_v1.Schema$MessagePart | undefined | null
  ): gmail_v1.Schema$MessagePart[] {
    if (!payload) return [];

    const result: gmail_v1.Schema$MessagePart[] = [];

    if (payload.filename && payload.body?.attachmentId) {
      result.push(payload);
    }

    if (payload.parts) {
      for (const part of payload.parts) {
        result.push(...this._collectAttachmentParts(part));
      }
    }

    return result;
  }
}
