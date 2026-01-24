import type { SendblueSendRequest, SendblueSendResponse } from '@gtd/shared-types';

/**
 * Sendblue API Error
 */
export class SendblueError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'SendblueError';
  }
}

/**
 * Sendblue API Client Configuration
 */
export interface SendblueClientConfig {
  /** API Key from Sendblue dashboard */
  apiKey: string;
  /** API Secret from Sendblue dashboard */
  apiSecret: string;
  /** Your Sendblue phone number (E.164 format) */
  phoneNumber: string;
  /** Base URL (default: https://api.sendblue.co/api) */
  baseUrl?: string;
}

/**
 * Sendblue API Client
 *
 * Handles sending SMS/iMessage via Sendblue API.
 * Receiving messages is handled via webhooks (see webhook-validator.ts).
 */
export class SendblueClient {
  private apiKey: string;
  private apiSecret: string;
  private phoneNumber: string;
  private baseUrl: string;

  constructor(config: SendblueClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.phoneNumber = config.phoneNumber;
    this.baseUrl = config.baseUrl ?? 'https://api.sendblue.co/api';
  }

  /**
   * Send an SMS/iMessage
   *
   * @param toNumber - Recipient phone number (E.164 format)
   * @param content - Message text content
   * @param options - Additional options
   * @returns Sendblue message response with message_handle
   */
  async sendMessage(
    toNumber: string,
    content: string,
    options?: {
      mediaUrl?: string;
      statusCallback?: string;
    }
  ): Promise<SendblueSendResponse> {
    const payload: SendblueSendRequest = {
      number: toNumber,
      from_number: this.phoneNumber,
      content,
      ...(options?.mediaUrl && { media_url: options.mediaUrl }),
      ...(options?.statusCallback && { status_callback: options.statusCallback }),
    };

    const response = await this.request<SendblueSendResponse>('/send-message', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return response;
  }

  /**
   * Send a typing indicator ("..." bubble)
   *
   * Shows the recipient that a message is being composed.
   * The indicator typically expires after ~60 seconds if no message is sent.
   *
   * @param toNumber - Recipient phone number (E.164 format)
   */
  async sendTypingIndicator(toNumber: string): Promise<void> {
    await this.request<{ status: string }>('/send-typing-indicator', {
      method: 'POST',
      body: JSON.stringify({ number: toNumber }),
    });
  }

  /**
   * Send a message with media attachment
   */
  async sendMediaMessage(
    toNumber: string,
    mediaUrl: string,
    content?: string
  ): Promise<SendblueSendResponse> {
    const payload: SendblueSendRequest = {
      number: toNumber,
      from_number: this.phoneNumber,
      media_url: mediaUrl,
      ...(content && { content }),
    };

    const response = await this.request<SendblueSendResponse>('/send-message', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return response;
  }

  /**
   * Make authenticated request to Sendblue API
   */
  private async request<T>(
    endpoint: string,
    options: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    // Sendblue uses custom headers for authentication
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'sb-api-key-id': this.apiKey,
        'sb-api-secret-key': this.apiSecret,
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new SendblueError(
        `Sendblue API error: ${response.statusText}`,
        response.status,
        data
      );
    }

    return data as T;
  }
}

/**
 * Create Sendblue client from environment variables
 */
export function createSendblueClient(): SendblueClient {
  const apiKey = process.env['SENDBLUE_API_KEY'];
  const apiSecret = process.env['SENDBLUE_API_SECRET'];
  const phoneNumber = process.env['SENDBLUE_PHONE_NUMBER'];

  if (!apiKey || !apiSecret || !phoneNumber) {
    throw new Error(
      'Missing Sendblue configuration. Required: SENDBLUE_API_KEY, SENDBLUE_API_SECRET, SENDBLUE_PHONE_NUMBER'
    );
  }

  return new SendblueClient({
    apiKey,
    apiSecret,
    phoneNumber,
  });
}

/**
 * Fire-and-forget typing indicator
 *
 * Sends a typing indicator without awaiting or throwing errors.
 * Failures are logged but never propagate to the caller.
 *
 * @param client - SendblueClient instance
 * @param toNumber - Recipient phone number (E.164 format)
 */
export function fireTypingIndicator(client: SendblueClient, toNumber: string): void {
  client.sendTypingIndicator(toNumber).catch((error) => {
    console.warn(`[Sendblue] Failed to send typing indicator to ${toNumber}:`, error.message);
  });
}

/**
 * Acknowledgment phrases for immediate response
 */
const ACK_PHRASES = [
  'On it',
  'Will do',
  'Working on this...',
  'Got it',
  'One sec...',
];

/**
 * Fire-and-forget acknowledgment message
 *
 * Sends a random acknowledgment phrase without awaiting or throwing errors.
 * Failures are logged but never propagate to the caller.
 *
 * @param client - SendblueClient instance
 * @param toNumber - Recipient phone number (E.164 format)
 */
export function fireAckMessage(client: SendblueClient, toNumber: string): void {
  const phrase = ACK_PHRASES[Math.floor(Math.random() * ACK_PHRASES.length)] ?? 'On it';
  client.sendMessage(toNumber, phrase).catch((error) => {
    console.warn(`[Sendblue] Failed to send ack to ${toNumber}:`, error.message);
  });
}
