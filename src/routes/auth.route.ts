import { Router, Request, Response } from 'express';
import { oauth2Client, GMAIL_SCOPES } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /auth/google
 *
 * Step 1 of the OAuth 2.0 Authorization Code Flow.
 * Redirects the user to Google's consent screen.
 *
 * - access_type: 'offline'  → requests a refresh_token (mandatory for server-side automation)
 * - prompt: 'consent'       → forces Google to return refresh_token every time
 *                             (without this, Google only returns it on first authorization)
 */
router.get('/google', (_req: Request, res: Response) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [...GMAIL_SCOPES],
    prompt: 'consent',
  });

  logger.info('Redirecting user to Google OAuth consent screen');
  res.redirect(authUrl);
});

/**
 * GET /auth/callback
 *
 * Step 2 of the OAuth 2.0 Authorization Code Flow.
 * Google redirects here with ?code=<authorization_code> after user grants permission.
 * Exchanges the code for { access_token, refresh_token } and persists them.
 *
 * SECURITY: This endpoint should be protected in production
 * (e.g. only accessible from localhost or behind a trusted proxy).
 */
router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code) {
    logger.warn('OAuth callback called without authorization code');
    res.status(400).send('Missing authorization code. Please restart the OAuth flow.');
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    await tokenRepository.save(tokens);

    logger.info('OAuth authentication successful', {
      hasRefreshToken: !!tokens.refresh_token,
      scopes: tokens.scope,
    });

    res.send(`
      <html>
        <body style="font-family:sans-serif;max-width:480px;margin:60px auto;text-align:center">
          <h2>&#10003; Authentication successful</h2>
          <p>The bot is now authorized to read your Gmail inbox and create draft replies.</p>
          <p>You can close this window and start the server.</p>
        </body>
      </html>
    `);
  } catch (error) {
    logger.error('OAuth token exchange failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).send('Authentication failed. Please check the server logs and try again.');
  }
});

export default router;
