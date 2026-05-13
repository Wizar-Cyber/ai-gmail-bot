import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/** Persisted state for the Gmail Pub/Sub watch session. */
export interface WatchState {
  historyId?: string;
  emailAddress?: string;
  expiration?: number;
  lastProcessedHistoryId?: string;
  topicName?: string;
}

/** File-based repository for reading and persisting the Gmail watch state. */
export class WatchStateRepository {
  private readonly filePath: string;

  constructor(filePath = env.WATCH_STATE_PATH) {
    this.filePath = path.resolve(filePath);
  }

  /**
   * Persists the watch state to disk as JSON.
   * @param state - The watch state to save
   */
  async save(state: WatchState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    logger.info('Watch state persisted', { path: this.filePath });
  }

  /**
   * Reads the watch state from disk.
   * @returns The persisted state, or null if the file does not exist
   */
  async load(): Promise<WatchState | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as WatchState;
    } catch {
      return null;
    }
  }

  /**
   * Deletes the persisted watch state file from disk.
   */
  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch {
      // ok
    }
  }
}

export const watchStateRepository = new WatchStateRepository();
