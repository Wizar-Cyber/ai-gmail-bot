import fs from 'fs/promises';
import path from 'path';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export interface WatchState {
  historyId?: string;
  emailAddress?: string;
  expiration?: number;
  lastProcessedHistoryId?: string;
  topicName?: string;
}

export class WatchStateRepository {
  private readonly filePath: string;

  constructor(filePath = env.WATCH_STATE_PATH) {
    this.filePath = path.resolve(filePath);
  }

  async save(state: WatchState): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(state, null, 2), 'utf-8');
    logger.info('Watch state persisted', { path: this.filePath });
  }

  async load(): Promise<WatchState | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(raw) as WatchState;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch {
      // ok
    }
  }
}

export const watchStateRepository = new WatchStateRepository();
