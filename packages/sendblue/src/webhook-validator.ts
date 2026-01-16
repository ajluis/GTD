import { createHmac } from 'node:crypto';

/**
 * Webhook Signature Validation Error
 */
export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

/**
 * Validate Sendblue webhook signature
 *
 * Sendblue signs webhooks using HMAC-SHA256 with the webhook secret.
 * The signature is computed over: `${timestamp}.${payload}`
 *
 * @param payload - Raw request body (string or Buffer)
 * @param signature - Value from x-sendblue-signature header
 * @param timestamp - Value from x-sendblue-timestamp header
 * @param secret - Webhook secret from Sendblue dashboard
 * @param toleranceMs - Maximum age of request in ms (default: 5 minutes)
 *
 * @throws WebhookValidationError if validation fails
 */
export function validateWebhookSignature(
  payload: string | Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string,
  toleranceMs: number = 5 * 60 * 1000
): void {
  // Check required headers exist
  if (!signature) {
    throw new WebhookValidationError('Missing x-sendblue-signature header');
  }
  if (!timestamp) {
    throw new WebhookValidationError('Missing x-sendblue-timestamp header');
  }

  // Parse and validate timestamp
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime)) {
    throw new WebhookValidationError('Invalid timestamp format');
  }

  // Check timestamp is within tolerance (prevent replay attacks)
  const now = Date.now();
  if (Math.abs(now - requestTime) > toleranceMs) {
    throw new WebhookValidationError(
      `Webhook timestamp outside acceptable window (${toleranceMs}ms)`
    );
  }

  // Compute expected signature
  const payloadString = typeof payload === 'string' ? payload : payload.toString('utf-8');
  const signaturePayload = `${timestamp}.${payloadString}`;

  const expectedSignature = createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(signature, expectedSignature)) {
    throw new WebhookValidationError('Invalid webhook signature');
  }
}

/**
 * Constant-time string comparison
 * Prevents timing attacks by always taking the same amount of time
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to maintain constant time
    const dummy = createHmac('sha256', 'dummy').update(a).digest('hex');
    createHmac('sha256', 'dummy').update(dummy).digest('hex');
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Extract validation params from Fastify request
 * Utility for use in route handlers
 */
export interface WebhookValidationParams {
  signature: string | undefined;
  timestamp: string | undefined;
}

export function extractValidationHeaders(headers: Record<string, string | string[] | undefined>): WebhookValidationParams {
  const getHeader = (name: string): string | undefined => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };

  return {
    signature: getHeader('x-sendblue-signature'),
    timestamp: getHeader('x-sendblue-timestamp'),
  };
}
