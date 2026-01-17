import type { ClassificationResult } from '@clarity/shared-types';

/**
 * Queue Names
 */
export const QUEUE_NAMES = {
  MESSAGES: 'clarity-messages',
  NOTIFICATIONS: 'clarity-notifications',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Job Types for the Messages Queue
 */
export type MessageJobType =
  | 'inbound' // Process incoming SMS
  | 'classify' // AI classification
  | 'notion-sync' // Sync task to Notion
  | 'outbound'; // Send SMS reply

/**
 * Inbound Message Job Data
 * Created when Sendblue webhook receives a message
 */
export interface InboundMessageJobData {
  type: 'inbound';
  /** Sendblue message handle for deduplication */
  messageHandle: string;
  /** Sender's phone number (E.164) */
  fromNumber: string;
  /** Message content */
  content: string;
  /** Timestamp when received */
  receivedAt: string;
}

/**
 * Classification Job Data
 * AI processes the message to determine task type
 */
export interface ClassifyJobData {
  type: 'classify';
  /** User ID from database */
  userId: string;
  /** Message ID from database */
  messageId: string;
  /** Message content to classify */
  content: string;
}

/**
 * Notion Sync Job Data
 * Sync classified task to Notion database
 */
export interface NotionSyncJobData {
  type: 'notion-sync';
  /** User ID */
  userId: string;
  /** Task ID from local database */
  taskId: string;
  /** Classification result */
  classification: ClassificationResult;
}

/**
 * Outbound Message Job Data
 * Send SMS reply to user
 */
export interface OutboundMessageJobData {
  type: 'outbound';
  /** User ID */
  userId: string;
  /** Recipient phone number (E.164) */
  toNumber: string;
  /** Message content to send */
  content: string;
  /** Optional: Reference to triggering message */
  inReplyTo?: string;
}

/**
 * Union type for all message job data
 */
export type MessageJobData =
  | InboundMessageJobData
  | ClassifyJobData
  | NotionSyncJobData
  | OutboundMessageJobData;

/**
 * Notification Job Types
 */
export type NotificationJobType =
  | 'daily-digest'
  | 'meeting-reminder'
  | 'people-sync';

/**
 * Daily Digest Job Data
 */
export interface DailyDigestJobData {
  type: 'daily-digest';
  userId: string;
}

/**
 * Meeting Reminder Job Data
 */
export interface MeetingReminderJobData {
  type: 'meeting-reminder';
  userId: string;
  personId: string;
}

/**
 * People Sync Job Data
 */
export interface PeopleSyncJobData {
  type: 'people-sync';
  userId: string;
}

/**
 * Union type for all notification job data
 */
export type NotificationJobData =
  | DailyDigestJobData
  | MeetingReminderJobData
  | PeopleSyncJobData;
