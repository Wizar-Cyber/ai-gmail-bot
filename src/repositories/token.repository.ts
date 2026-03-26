import fs from 'fs/promises';
import path from 'path';
import type { Credentials } from 'google-auth-library';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * ITokenRepository — contract for OAuth token persistence.
 *
 * The default implementation (FileTokenRepository) stores tokens in a local
 * JSON file, suitable for single-user development only.
 *
 * For multi-user production systems, implement DatabaseTokenRepository
 * backed by PostgreSQL / Redis / Firestore with userId as the lookup key.
 */
export interface ITokenRepository {
  save(tokens: Credentials): Promise<void>;
  load(): Promise<Credentials | null>;
  clear(): Promise<void>;
}

/**
 * FileTokenRepository — stores OAuth tokens in a local JSON file.
 *
 * SECURITY NOTES:
 * - .tokens.json must be in .gitignore (contains access + refresh tokens).
 * - In production, replace with a DB-backed implementation.
 * - Consider encrypting the stored refresh_token at rest.
 */
export class FileTokenRepository implements ITokenRepository {
  private readonly filePath: string;

  constructor(filePath = env.TOKEN_STORE_PATH) {
    this.filePath = path.resolve(filePath);
  }

  /** Merges new tokens with any previously stored tokens (preserves refresh_token). */
  async save(tokens: Credentials): Promise<void> {
    const existing = await this.load();
    const merged: Credentials = { ...existing, ...tokens };
    await fs.writeFile(this.filePath, JSON.stringify(merged, null, 2), 'utf-8');
    logger.info('OAuth tokens persisted', { path: this.filePath });
  }

  async load(): Promise<Credentials | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as Credentials;
    } catch {
      // File missing on first run: not an error
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
      logger.info('Token store cleared');
    } catch {
      // Ignore if file does not exist
    }
  }
}

// Singleton — shared across the application
export const tokenRepository = new FileTokenRepository();
