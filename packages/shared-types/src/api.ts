/**
 * API Types
 * Types for webhook payloads and API responses
 */

/**
 * Sendblue Webhook Payload
 * Received when an SMS/iMessage arrives
 */
export interface SendblueWebhookPayload {
  /** Unique message identifier */
  message_handle: string;

  /** Sender's phone number (E.164 format) */
  from_number: string;

  /** Recipient's phone number (E.164 format) */
  to_number: string;

  /** Message content */
  content: string;

  /** Whether this is an outbound message (sent by us) */
  is_outbound: boolean;

  /** Message service type */
  service: 'iMessage' | 'SMS';

  /** Whether iMessage was downgraded to SMS */
  was_downgraded: boolean;

  /** Media URL if attachment present */
  media_url?: string;

  /** Group chat ID if applicable */
  group_id?: string;

  /** Timestamp when message was sent */
  date_sent: string;

  /** Message status */
  status: string;

  /** Contact opt-out status */
  opted_out: boolean;

  /** Error code if delivery failed */
  error_code?: string;

  /** Error message if delivery failed */
  error_message?: string;
}

/**
 * Sendblue Send Message Request
 */
export interface SendblueSendRequest {
  /** Recipient phone number (E.164 format) */
  number: string;

  /** Sender phone number (E.164 format) */
  from_number: string;

  /** Message content */
  content?: string;

  /** Media URL to send */
  media_url?: string;

  /** Callback URL for status updates */
  status_callback?: string;
}

/**
 * Sendblue Send Message Response
 */
export interface SendblueSendResponse {
  /** Unique message identifier */
  message_handle: string;

  /** Message status */
  status: string;

  /** Account UUID */
  account_uuid: string;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    database: boolean;
    redis: boolean;
    notion?: boolean;
    sendblue?: boolean;
  };
}

/**
 * Webhook acknowledgment response
 */
export interface WebhookAckResponse {
  received: boolean;
  queued: boolean;
  messageId?: string;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Notion OAuth callback params
 */
export interface NotionOAuthCallback {
  code: string;
  state?: string;
}

/**
 * Notion OAuth token response
 */
export interface NotionOAuthTokenResponse {
  access_token: string;
  token_type: string;
  bot_id: string;
  workspace_id: string;
  workspace_name: string;
  workspace_icon: string | null;
  owner: {
    type: string;
    user?: {
      id: string;
      name: string;
      avatar_url: string | null;
    };
  };
  duplicated_template_id: string | null;
}
