import { gmail_v1 } from 'googleapis';

/**
 * Decodes a base64url string to UTF-8 text.
 * Gmail API always encodes body data in base64url (not standard base64).
 * Difference: base64url uses '-' and '_' instead of '+' and '/'.
 */
export function decodeBase64Url(encoded: string): string {
  const standard = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(standard, 'base64').toString('utf-8');
}

/**
 * Strips HTML markup to produce readable plain text.
 * Used as fallback when a message has no text/plain part (HTML-only emails).
 * Note: Does not decode all HTML entities — for production use consider
 *       the 'html-to-text' npm package for more accurate conversion.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Recursively extracts the best available plain-text content from a Gmail payload.
 *
 * Gmail message structure can be:
 *   - Simple:              payload.body.data  (text/plain or text/html)
 *   - multipart/alternative: parts containing both text/plain and text/html
 *                            → prefer text/plain
 *   - multipart/mixed:     parts with text + attachments
 *                            → recurse to collect all text parts
 *   - Nested multipart:    any of the above nested inside each other
 *
 * Priority: text/plain > text/html (stripped) > empty string
 */
export function extractBodyFromPayload(
  payload: gmail_v1.Schema$MessagePart | undefined | null
): string {
  if (!payload) return '';

  const mimeType = payload.mimeType ?? '';

  // ── Leaf node: has body data directly ──────────────────────────────────
  if (payload.body?.data && !mimeType.startsWith('multipart/')) {
    const decoded = decodeBase64Url(payload.body.data);
    return mimeType === 'text/html' ? stripHtml(decoded) : decoded;
  }

  if (!payload.parts || payload.parts.length === 0) return '';

  // ── multipart/alternative ───────────────────────────────────────────────
  // Contains both text/plain and text/html variants of the same content.
  // Always prefer text/plain to keep the AI prompt clean and token-efficient.
  if (mimeType === 'multipart/alternative') {
    const plainPart = payload.parts.find((p) => p.mimeType === 'text/plain');
    if (plainPart?.body?.data) {
      return decodeBase64Url(plainPart.body.data);
    }
    const htmlPart = payload.parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return stripHtml(decodeBase64Url(htmlPart.body.data));
    }
  }

  // ── multipart/mixed or other compound types ─────────────────────────────
  // Recurse into all parts and concatenate non-empty results.
  const segments: string[] = [];
  for (const part of payload.parts) {
    const text = extractBodyFromPayload(part);
    if (text.trim()) segments.push(text);
  }
  return segments.join('\n\n');
}

/**
 * Returns the value of a named header (case-insensitive).
 * Returns an empty string if the header is not present.
 */
export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined | null,
  name: string
): string {
  return (
    headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}
