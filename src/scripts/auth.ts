import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { oauth2Client, GMAIL_SCOPES } from '../config/oauth.config';
import { tokenRepository } from '../repositories/token.repository';

/**
 * Interactive CLI script for initial OAuth 2.0 authorization.
 * Run once before starting the server for the first time.
 *
 * Usage: npm run auth
 *
 * Flow:
 * 1. Prints the Google consent URL
 * 2. You open the URL in a browser and grant permission
 * 3. Google redirects to GOOGLE_REDIRECT_URI with ?code=...
 * 4. Paste the code here (or copy it from the browser URL bar)
 * 5. Tokens are saved to TOKEN_STORE_PATH (.tokens.json by default)
 *
 * Alternative: start the server (npm run dev) and visit GET /auth/google
 */
async function main(): Promise<void> {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [...GMAIL_SCOPES],
    prompt: 'consent',
  });

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Gmail Bot — Initial OAuth Authorization');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('1. Open the following URL in your browser:\n');
  console.log(`   ${authUrl}\n`);
  console.log('2. Grant the required permissions.');
  console.log('3. Copy the authorization code from the browser URL bar.\n');

  const rl = readline.createInterface({ input, output });
  const code = await rl.question('Paste the authorization code here: ');
  rl.close();

  if (!code.trim()) {
    console.error('\nNo code provided. Aborting.');
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    await tokenRepository.save(tokens);

    console.log('\n✓ Authentication successful!');
    console.log(`  Tokens saved to: ${process.env['TOKEN_STORE_PATH'] ?? '.tokens.json'}`);
    console.log('  You can now run: npm run dev\n');
  } catch (error) {
    console.error('\nFailed to exchange authorization code:', error);
    process.exit(1);
  }
}

main();
