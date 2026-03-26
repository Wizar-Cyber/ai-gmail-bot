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
  /** Value of the "Subject" header */
  subject: string;
  /** Value of the "From" header — used as the "To" address in the draft reply */
  from: string;
  /**
   * Value of the "Message-ID" header (e.g. <abc123@mail.gmail.com>).
   * Required for RFC 2822-compliant threading via In-Reply-To / References.
   */
  messageIdHeader: string;
  /** Decoded plain-text body (never raw base64) */
  body: string;
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
}
