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
 * - Primera persona → la respuesta suena como si la escribiera el dueño de la cuenta.
 * - "ONLY use information in the email" → evita alucinaciones / responsabilidad legal.
 * - "Request clarification if context is missing" → comportamiento seguro por defecto.
 * - Tono cercano pero profesional → adecuado para comunicación directa entre personas.
 * - "Same language as the email" → evita respuestas bilingües incómodas.
 * - La firma se inyecta dinámicamente desde GMAIL_SIGNATURE en .env.
 */
function buildSystemPrompt(ownerName: string): string {
  return `Eres el asistente personal de redacción de correos de ${ownerName}.
Tu única tarea es redactar la respuesta al correo recibido EXACTAMENTE como si la escribiera ${ownerName} en primera persona.

REGLAS ESTRICTAS:
1. Escribe en primera persona ("Te escribo para...", "Me alegra saber que...", "Estaré encantado de...").
2. Usa ÚNICAMENTE la información presente en el asunto, el cuerpo del correo o el bloque de contexto proporcionado.
3. NO inventes hechos, precios, fechas, nombres ni ningún dato que no esté en el correo.
4. Si el correo hace una pregunta que no puedes responder con la información disponible, responde amablemente solicitando aclaración o más detalles.
5. Mantén un tono cercano, directo y profesional — como lo haría una persona real, no un robot.
6. Responde en el mismo idioma que el correo recibido.
7. Sé conciso — evita frases de relleno como "Espero que estés bien" o "Un cordial saludo".
8. Escribe SOLO el cuerpo del correo. NO incluyas línea de asunto.
9. NO añadas ninguna firma ni despedida al final — la firma se añadirá automáticamente después.`;
}

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

// ── Gemini ─────────────────────────────────────────────────────────────────

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
      systemInstruction: buildSystemPrompt(env.OWNER_NAME),
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
            { role: 'system', content: buildSystemPrompt(env.OWNER_NAME) },
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
  const contextBlock = input.context
    ? `\n--- CONTEXTO RELEVANTE (úsalo para responder preguntas factuales) ---\n${input.context}\n--- FIN DEL CONTEXTO ---\n`
    : '';

  return `${contextBlock}
Redacta la respuesta al siguiente correo:

Asunto: ${input.subject}

Cuerpo:
${input.body}

Escribe solo el cuerpo de la respuesta, sin firma.`;
}

/**
 * Appends the owner's signature below the AI-generated body.
 * The signature is stored in GMAIL_SIGNATURE with literal \n for line breaks
 * (e.g. "Reiber Lozano\nlozanoreiber1@gmail.com") and expanded here.
 * If no signature is configured the body is returned as-is.
 */
function appendSignature(body: string, signature: string): string {
  if (!signature.trim()) return body;
  // Expand literal \n sequences written in the .env value
  const expanded = signature.replace(/\\n/g, '\n');
  return `${body.trimEnd()}\n\n${expanded}`;
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
      // Append signature after the AI-generated body.
      // Doing it here (not in the prompt) prevents the model from modifying or
      // duplicating the signature.
      const signed = appendSignature(reply, env.GMAIL_SIGNATURE);
      logger.info('AI reply generated successfully');
      return signed;
    } catch (error) {
      if (error instanceof AIServiceError || error instanceof ConfigurationError) throw error;
      throw new AIServiceError('AI provider failed to generate a reply', error);
    }
  }
}
