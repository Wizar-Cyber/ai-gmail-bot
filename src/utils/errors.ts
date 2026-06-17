/**
 * Centralized custom error hierarchy.
 * All domain errors extend AppError so the global error handler can
 * differentiate between known / unknown failures and respond accordingly.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** Wraps errors from the Gmail API (network, quota, auth) */
export class GmailServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'GMAIL_SERVICE_ERROR', 502, details);
  }
}

/** Wraps errors from AI providers (Gemini / OpenAI) */
export class AIServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'AI_SERVICE_ERROR', 502, details);
  }
}

/** Invalid or missing verification token on the webhook endpoint */
export class WebhookValidationError extends AppError {
  constructor(message: string) {
    super(message, 'WEBHOOK_VALIDATION_ERROR', 401);
  }
}

/** Missing or expired OAuth tokens */
export class TokenError extends AppError {
  constructor(message: string) {
    super(message, 'TOKEN_ERROR', 401);
  }
}

/** Required environment variable missing or invalid */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500);
  }
}

/** Error executing the external Python pipeline */
export class PipelineBridgeError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'PIPELINE_BRIDGE_ERROR', 502, details);
  }
}

/** Error managing Gmail watch */
export class WatchError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'WATCH_ERROR', 502, details);
  }
}

/** Error from Webmail (IMAP) operations */
export class WebmailServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'WEBMAIL_SERVICE_ERROR', 502, details);
  }
}
