import dotenv from 'dotenv';

// Load .env before any access to process.env
dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(
      `[Config] Missing required environment variable: ${key}. Check your .env file.`
    );
  }
  return value.trim();
}

function optionalEnv(key: string, defaultValue: string = ''): string {
  return process.env[key]?.trim() || defaultValue;
}

export const env = {
  // ── Server ──────────────────────────────────────────────────────────────
  PORT: parseInt(optionalEnv('PORT', '3000'), 10),
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),

  // ── Google OAuth 2.0 ────────────────────────────────────────────────────
  GOOGLE_CLIENT_ID: requireEnv('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: requireEnv('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: requireEnv('GOOGLE_REDIRECT_URI'),

  // ── AI Provider ─────────────────────────────────────────────────────────
  // "gemini" uses Gemini 1.5 Pro; "openai" uses GPT-4o
  AI_PROVIDER: optionalEnv('AI_PROVIDER', 'gemini') as 'gemini' | 'openai',

  // ── Google AI (Gemini) ───────────────────────────────────────────────────
  GEMINI_API_KEY: optionalEnv('GEMINI_API_KEY'),
  GEMINI_MODEL: optionalEnv('GEMINI_MODEL', 'gemini-2.5-flash'),

  // ── OpenAI ───────────────────────────────────────────────────────────────
  OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY'),
  OPENAI_MODEL: optionalEnv('OPENAI_MODEL', 'gpt-4o'),

  // ── Webhook Security ─────────────────────────────────────────────────────
  // Shared token appended as ?token=<value> to the Pub/Sub push URL
  PUBSUB_VERIFICATION_TOKEN: optionalEnv('PUBSUB_VERIFICATION_TOKEN'),

  // ── Token Storage ────────────────────────────────────────────────────────
  // File path for dev. Replace with DB URI in production.
  TOKEN_STORE_PATH: optionalEnv('TOKEN_STORE_PATH', '.tokens.json'),

  // ── Watch State ───────────────────────────────────────────────────────────
  WATCH_STATE_PATH: optionalEnv('WATCH_STATE_PATH', 'data/watch-state.json'),

  // ── Pub/Sub ───────────────────────────────────────────────────────────────
  // Gmail push notifications topic (e.g. projects/my-project/topics/gmail)
  GOOGLE_PUBSUB_TOPIC: optionalEnv('GOOGLE_PUBSUB_TOPIC'),

  // ── Pipeline Bridge ───────────────────────────────────────────────────────
  PDF_DOWNLOAD_DIR: optionalEnv('PDF_DOWNLOAD_DIR', 'data/pdfs'),
  PIPELINE_CMD: optionalEnv('PIPELINE_CMD', 'python3 -m src.main'),
  DATA_DIR: optionalEnv('DATA_DIR', 'data'),

  // ── Polling ────────────────────────────────────────────────────────────────
  // Interval in ms between inbox checks (default 30000 = 30s)
  POLL_INTERVAL: optionalEnv('POLL_INTERVAL', '30000'),

  // ── Personalización del propietario ────────────────────────────────
  // Nombre que aparece en el system prompt de la IA.
  OWNER_NAME: optionalEnv('OWNER_NAME', 'el dueño de este correo'),
  // Firma completa (texto plano, con saltos de línea \n).
  // Ejemplo: "Reiber Lozano\nCEO @ MiEmpresa\n+34 600 000 000"
  GMAIL_SIGNATURE: optionalEnv('GMAIL_SIGNATURE', ''),
} as const;

export type Env = typeof env;
