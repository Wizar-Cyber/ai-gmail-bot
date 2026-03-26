import { logger } from './logger';

export interface RetryOptions {
  /** Maximum number of attempts (including the first try). Default: 3 */
  maxAttempts?: number;
  /** Delay in ms before the first retry. Default: 1000 */
  baseDelayMs?: number;
  /** Multiplier applied to delay each attempt. Default: 2  */
  factor?: number;
  /** Hard cap on delay. Default: 30_000 (30 s) */
  maxDelayMs?: number;
  /** Custom predicate: return true if the error should trigger a retry */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULTS = {
  maxAttempts: 3,
  baseDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 30_000,
} satisfies Required<Omit<RetryOptions, 'isRetryable'>>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultIsRetryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: number | string; status?: number; message?: string };
  // Retry on HTTP 429 (rate-limit) and 5xx (transient server errors)
  const status = typeof e.status === 'number' ? e.status : parseInt(String(e.code ?? '0'), 10);
  return status === 429 || status >= 500;
}

/**
 * Executes fn with exponential backoff + jitter.
 *
 * Formula: delay = min(baseDelayMs × factor^(attempt-1) + jitter, maxDelayMs)
 * Jitter (0-200 ms) prevents thundering-herd when multiple workers retry simultaneously.
 *
 * @example
 * const data = await withRetry(() => gmail.users.messages.get({ ... }), { maxAttempts: 4 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const jitter = Math.random() * 200;
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(opts.factor, attempt - 1) + jitter,
        opts.maxDelayMs
      );

      logger.warn(`Retry attempt ${attempt}/${opts.maxAttempts - 1} failed. Next retry in ${Math.round(delay)}ms.`, {
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
    }
  }

  throw lastError;
}
