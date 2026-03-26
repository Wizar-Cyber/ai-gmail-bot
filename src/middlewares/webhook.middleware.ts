import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Validates Google Cloud Pub/Sub push subscription requests.
 *
 * Google Cloud Pub/Sub push subscriptions can be secured in two ways:
 *
 * 1. URL-based verification token (implemented here):
 *    Configure the push subscription URL as:
 *    https://your-host/webhook/gmail?token=<PUBSUB_VERIFICATION_TOKEN>
 *    This is the simplest approach and recommended by Google as an additional
 *    security layer for public endpoints.
 *    See: https://cloud.google.com/pubsub/docs/push#setting_up_for_push_authentication
 *
 * 2. JWT Bearer token validation (production recommended):
 *    Google sends an Authorization: Bearer <JWT> header signed with a
 *    service account. Validate this JWT against Google's OIDC token endpoint.
 *    See: https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
 *    NOTE: Full JWT validation requires fetching Google's public keys at:
 *    https://www.googleapis.com/oauth2/v3/certs
 *    Consider using the 'google-auth-library' verifyIdToken() method.
 *
 * This middleware implements approach #1.
 */
export function validatePubSubToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!env.PUBSUB_VERIFICATION_TOKEN) {
    if (env.NODE_ENV === 'production') {
      logger.warn(
        'PUBSUB_VERIFICATION_TOKEN is not set in production. The webhook endpoint is unprotected.'
      );
    }
    return next();
  }

  const token = req.query['token'] as string | undefined;

  if (!token || token !== env.PUBSUB_VERIFICATION_TOKEN) {
    logger.warn('Webhook request rejected: invalid or missing verification token', {
      ip: req.ip,
      hasToken: !!token,
    });
    // IMPORTANT: Return 200 (not 401) to prevent Pub/Sub from retrying indefinitely.
    // A 4xx/5xx would cause Pub/Sub to retry the same invalid request many times.
    // We treat unknown tokens as "acknowledged but discarded."
    res.status(200).send('OK');
    return;
  }

  next();
}
