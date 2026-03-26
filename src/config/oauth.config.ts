import { google } from 'googleapis';
import { env } from './env';

/**
 * Gmail API Scopes — why each is required:
 *
 * gmail.readonly  → List and read unread messages (users.messages.list / .get)
 *                   Without this scope, we cannot see any inbox content.
 *
 * gmail.compose   → Create draft replies (users.drafts.create).
 *                   This scope allows creating/updating drafts but NOT sending email,
 *                   which limits blast-radius if the bot is compromised.
 *
 * NOTE: gmail.send is intentionally excluded. Drafts must be reviewed and
 *       sent manually by the user.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
] as const;

/**
 * Shared OAuth2 client instance.
 * Call oauth2Client.setCredentials(tokens) before making API calls.
 *
 * OAuth Flow (Authorization Code + Refresh Token):
 * 1. User visits GET /auth/google  →  redirected to Google consent screen
 * 2. User grants permission        →  Google redirects to GOOGLE_REDIRECT_URI with ?code=...
 * 3. GET /auth/callback exchanges the code for { access_token, refresh_token }
 * 4. Tokens are persisted via ITokenRepository
 * 5. On subsequent requests, the SDK auto-refreshes the access_token using refresh_token
 */
export const oauth2Client = new google.auth.OAuth2(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  env.GOOGLE_REDIRECT_URI
);
