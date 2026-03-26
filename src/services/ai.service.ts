import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { env } from '../config/env';
import { withRetry } from '../utils/retry';
import { AIServiceError, ConfigurationError } from '../utils/errors';
import { logger } from '../utils/logger';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface GenerateReplyInput {
  subject: string;
  body: string;
  /** Optional context injected by the RAG pipeline (FAQ entries, KB snippets) */
  context?: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// System Prompt — explicit and auditable
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Design decisions:
 * - "ONLY use information in the email" → prevents hallucination / liability
 * - "Request clarification if context is missing" → safe fallback behavior
 * - "Neutral/formal tone" → appropriate for B2B and transactional email
 * - "Same language as the email" → avoids awkward bilingual responses
 * - No external knowledge references → reduces hallucination surface
 */
const SYSTEM_PROMPT = `You are a professional email assistant for a business.
Your sole task is to draft a polished, concise reply to the email provided.

STRICT RULES:
1. Use ONLY information explicitly present in the email subject, body, or the provided context block.
2. Do NOT invent facts, figures, prices, deadlines, names, or anything not stated in the email.
3. If the email asks a question you cannot answer from the available information, reply politely asking for clarification or additional details.
4. Maintain a neutral, professional, and courteous tone at all times.
5. Respond in the same language as the received email.
6. Be concise — omit filler phrases like "I hope this email finds you well."
7. Output the email body only. Do not include a subject line.
8. End with: "Best regards,\n[Your Team]"`;

// ──────────────────────────────────────────────────────────────────────────────
// Temperature rationale
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Temperature = 0.3
 *
 * Lower temperature → more deterministic, consistent outputs → fewer hallucinations.
 * This is critical for business email where accuracy and tone consistency outweigh
 * creative variation. Values ≥ 0.7 increase linguistic variety but risk invented
 * content, which is unacceptable in a professional communication context.
 */
const TEMPERATURE = 0.3;

// ──────────────────────────────────────────────────────────────────────────────
// Provider Interface & Implementations (Strategy Pattern)
// ──────────────────────────────────────────────────────────────────────────────

interface IAIProvider {
  generateReply(input: GenerateReplyInput): Promise<string>;
}

// ── Gemini 1.5 Pro ─────────────────────────────────────────────────────────

class GeminiProvider implements IAIProvider {
  private readonly client: GoogleGenerativeAI;

  constructor() {
    if (!env.GEMINI_API_KEY) {
      throw new ConfigurationError(
        'GEMINI_API_KEY is not set. Add it to your .env file or switch AI_PROVIDER=openai.'
      );
    }
    this.client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }

  async generateReply(input: GenerateReplyInput): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: env.GEMINI_MODEL,
      generationConfig: {
        temperature: TEMPERATURE,
        maxOutputTokens: 1024,
      },
      systemInstruction: SYSTEM_PROMPT,
    });

    const prompt = buildUserPrompt(input);

    const result = await withRetry(() => model.generateContent(prompt), {
      maxAttempts: 3,
      baseDelayMs: 2_000,
    });

    const text = result.response.text().trim();
    if (!text) {
      throw new AIServiceError('Gemini returned an empty response');
    }
    return text;
  }
}

// ── GPT-4o ─────────────────────────────────────────────────────────────────

class OpenAIProvider implements IAIProvider {
  private readonly client: OpenAI;

  constructor() {
    if (!env.OPENAI_API_KEY) {
      throw new ConfigurationError(
        'OPENAI_API_KEY is not set. Add it to your .env file or switch AI_PROVIDER=gemini.'
      );
    }
    this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  async generateReply(input: GenerateReplyInput): Promise<string> {
    const completion = await withRetry(
      () =>
        this.client.chat.completions.create({
          model: env.OPENAI_MODEL,
          temperature: TEMPERATURE,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(input) },
          ],
        }),
      { maxAttempts: 3, baseDelayMs: 2_000 }
    );

    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) {
      throw new AIServiceError('OpenAI returned an empty response');
    }
    return text;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function buildUserPrompt(input: GenerateReplyInput): string {
  // RAG context injected here, before the email — visible to the model
  const contextBlock = input.context
    ? `\n--- RELEVANT CONTEXT (use this to answer factual questions) ---\n${input.context}\n--- END CONTEXT ---\n`
    : '';

  return `${contextBlock}
Please draft a professional reply to the following email:

Subject: ${input.subject}

Body:
${input.body}

Draft the reply body only.`;
}

// ──────────────────────────────────────────────────────────────────────────────
// AIService — public facade
// ──────────────────────────────────────────────────────────────────────────────

/**
 * AIService is fully decoupled from Gmail logic.
 * Switch between Gemini and GPT-4o by setting AI_PROVIDER in .env.
 * Add new providers by implementing IAIProvider and extending the factory.
 */
export class AIService {
  private readonly provider: IAIProvider;

  constructor(providerName: 'gemini' | 'openai' = env.AI_PROVIDER) {
    logger.info(`AI service initializing with provider: ${providerName}`);
    switch (providerName) {
      case 'gemini':
        this.provider = new GeminiProvider();
        break;
      case 'openai':
        this.provider = new OpenAIProvider();
        break;
      default: {
        // TypeScript exhaustive check
        const _exhaustive: never = providerName;
        throw new ConfigurationError(`Unknown AI provider: ${String(_exhaustive)}`);
      }
    }
  }

  async generateReply(input: GenerateReplyInput): Promise<string> {
    logger.info('Generating AI reply', { subject: input.subject, hasContext: !!input.context });
    try {
      const reply = await this.provider.generateReply(input);
      logger.info('AI reply generated successfully');
      return reply;
    } catch (error) {
      if (error instanceof AIServiceError || error instanceof ConfigurationError) throw error;
      throw new AIServiceError('AI provider failed to generate a reply', error);
    }
  }
}
