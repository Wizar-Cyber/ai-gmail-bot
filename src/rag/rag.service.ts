import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

interface FAQEntry {
  id: string;
  keywords: string[];
  answer: string;
}

/**
 * RAGService — Retrieval Augmented Generation (keyword-based, local).
 *
 * Architecture:
 *   email text → enrichContext() → relevant FAQ answers (plain text block)
 *                                         ↓
 *                              injected into AIService prompt as "context"
 *                                         ↓
 *                              AI generates a factually grounded reply
 *
 * How to upgrade to vector-based RAG (production):
 * 1. Embed FAQ entries using text-embedding-3-small (OpenAI) or embedding-001 (Gemini)
 * 2. Store vectors in pgvector / Pinecone / Qdrant
 * 3. On each incoming email, embed the email text and run a similarity search
 * 4. Return the top-k results as context instead of keyword matches
 *
 * This keyword implementation is zero-latency and zero-cost, suitable for
 * prototyping and low-traffic bots with a manageable FAQ (<200 entries).
 */
export class RAGService {
  private readonly faq: FAQEntry[];

  constructor(faqPath = path.join(__dirname, 'faq.json')) {
    try {
      const raw = fs.readFileSync(faqPath, 'utf-8');
      this.faq = JSON.parse(raw) as FAQEntry[];
      logger.info(`RAG service loaded ${this.faq.length} FAQ entries`, { source: faqPath });
    } catch (error) {
      logger.warn('RAG service could not load FAQ — context enrichment disabled', {
        path: faqPath,
        error: error instanceof Error ? error.message : String(error),
      });
      this.faq = [];
    }
  }

  /**
   * Returns applicable FAQ answers as a plain-text block for injection into the AI prompt.
   * Returns an empty string if no keywords match (AIService handles this gracefully).
   *
   * @param emailText - Concatenation of email subject + body for maximum coverage
   */
  enrichContext(emailText: string): string {
    if (this.faq.length === 0) return '';

    const normalized = emailText.toLowerCase();

    const matched = this.faq.filter((entry) =>
      entry.keywords.some((kw) => normalized.includes(kw.toLowerCase()))
    );

    if (matched.length === 0) {
      logger.info('RAG: no relevant FAQ entries matched');
      return '';
    }

    logger.info(`RAG: ${matched.length} FAQ entries matched`, {
      matchedIds: matched.map((e) => e.id),
    });

    // Format as a simple list — the AI prompt wraps this in an explicit context block
    return matched.map((e) => `• ${e.answer}`).join('\n');
  }
}
