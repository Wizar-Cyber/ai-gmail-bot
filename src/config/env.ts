import dotenv from 'dotenv';

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

export interface WebmailAccountConfig {
  username: string;
  password: string;
}

function buildAccounts(): WebmailAccountConfig[] {
  const accs: WebmailAccountConfig[] = [];
  const add = (u: string, p: string) => { if (u && p) accs.push({ username: u, password: p }); };
  add(optionalEnv('WEBMAIL_USER_1'), optionalEnv('WEBMAIL_PASS_1'));
  add(optionalEnv('WEBMAIL_USER_2'), optionalEnv('WEBMAIL_PASS_2'));
  add(optionalEnv('WEBMAIL_USER_3'), optionalEnv('WEBMAIL_PASS_3'));
  return accs;
}

export const env = {
  PORT: parseInt(optionalEnv('PORT', '3000'), 10),
  NODE_ENV: optionalEnv('NODE_ENV', 'development'),
  LOG_LEVEL: optionalEnv('LOG_LEVEL', 'info'),

  // ── Webmail (IMAP) ──────────────────────────────────────────────────────
  WEBMAIL_HOST: requireEnv('WEBMAIL_HOST'),
  WEBMAIL_PORT: parseInt(optionalEnv('WEBMAIL_PORT', '993'), 10),
  WEBMAIL_TLS: optionalEnv('WEBMAIL_TLS', 'true') !== 'false',

  WEBMAIL_USER_1: optionalEnv('WEBMAIL_USER_1'),
  WEBMAIL_PASS_1: optionalEnv('WEBMAIL_PASS_1'),
  WEBMAIL_USER_2: optionalEnv('WEBMAIL_USER_2'),
  WEBMAIL_PASS_2: optionalEnv('WEBMAIL_PASS_2'),
  WEBMAIL_USER_3: optionalEnv('WEBMAIL_USER_3'),
  WEBMAIL_PASS_3: optionalEnv('WEBMAIL_PASS_3'),

  accounts: buildAccounts(),

  // ── Pipeline Bridge ─────────────────────────────────────────────────────
  PDF_DOWNLOAD_DIR: optionalEnv('PDF_DOWNLOAD_DIR', 'data/pdfs'),
  PIPELINE_CMD: optionalEnv('PIPELINE_CMD', 'python3 -m src.main'),
  DATA_DIR: optionalEnv('DATA_DIR', 'data'),

  // ── Polling ─────────────────────────────────────────────────────────────
  POLL_INTERVAL: optionalEnv('POLL_INTERVAL', '30000'),
  // Toggle to disable automatic draft bot (polling / webhook processing)
  DISABLE_DRAFTS: optionalEnv('DISABLE_DRAFTS', 'false') !== 'false',

  // ── IMAP folders to search ──────────────────────────────────────────────
  WEBMAIL_FOLDERS: optionalEnv('WEBMAIL_FOLDERS', 'INBOX,Spam,Junk'),

  // ── SMTP para enviar respuestas ─────────────────────────────────────────
  WEBMAIL_SMTP_HOST: optionalEnv('WEBMAIL_SMTP_HOST', optionalEnv('WEBMAIL_HOST', '')),
  WEBMAIL_SMTP_PORT: parseInt(optionalEnv('WEBMAIL_SMTP_PORT', '587'), 10),
  WEBMAIL_SMTP_TLS: optionalEnv('WEBMAIL_SMTP_TLS', 'true') !== 'false',

  // ── Legacy (kept for reference / backward compat) ───────────────────────
  AI_PROVIDER: optionalEnv('AI_PROVIDER', 'gemini') as 'gemini' | 'openai',
  GEMINI_API_KEY: optionalEnv('GEMINI_API_KEY'),
  GEMINI_MODEL: optionalEnv('GEMINI_MODEL', 'gemini-2.5-flash'),
  OPENAI_API_KEY: optionalEnv('OPENAI_API_KEY'),
  OPENAI_MODEL: optionalEnv('OPENAI_MODEL', 'gpt-4o'),
  OWNER_NAME: optionalEnv('OWNER_NAME', ''),
  GMAIL_SIGNATURE: optionalEnv('GMAIL_SIGNATURE', ''),
  GOOGLE_CLIENT_ID: optionalEnv('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: optionalEnv('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: optionalEnv('GOOGLE_REDIRECT_URI'),
  PUBSUB_VERIFICATION_TOKEN: optionalEnv('PUBSUB_VERIFICATION_TOKEN'),
  TOKEN_STORE_PATH: optionalEnv('TOKEN_STORE_PATH', '.tokens.json'),
  WATCH_STATE_PATH: optionalEnv('WATCH_STATE_PATH', 'data/watch-state.json'),
  GOOGLE_PUBSUB_TOPIC: optionalEnv('GOOGLE_PUBSUB_TOPIC'),
};

export type Env = typeof env;
