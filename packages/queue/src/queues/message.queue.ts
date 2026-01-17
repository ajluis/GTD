import { Queue, type ConnectionOptions } from 'bullmq';
import {
  QUEUE_NAMES,
  type MessageJobData,
  type InboundMessageJobData,
  type ClassifyJobData,
  type NotionSyncJobData,
  type OutboundMessageJobData,
} from '../types/jobs.js';

/**
 * Default job options for message queue
 *
 * - 3 retry attempts with exponential backoff
 * - Remove completed jobs (keep failed for debugging)
 * - Use message handle as job ID for idempotency
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 2000, // 2s -> 4s -> 8s
  },
  removeOnComplete: true,
  removeOnFail: false, // Keep failed jobs for inspection
};

/**
 * Create the messages queue
 */
export function createMessageQueue(connection: ConnectionOptions): Queue<MessageJobData> {
  return new Queue(QUEUE_NAMES.MESSAGES, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });
}

/**
 * Helper: Enqueue inbound message for processing
 *
 * Uses message_handle as job ID for idempotency - if the same message
 * is received twice (Sendblue retry), it won't be processed again.
 */
export async function enqueueInboundMessage(
  queue: Queue<MessageJobData>,
  data: Omit<InboundMessageJobData, 'type'>
): Promise<string> {
  const job = await queue.add(
    'inbound',
    { type: 'inbound', ...data },
    {
      jobId: `inbound-${data.messageHandle}`, // Idempotency key
    }
  );
  return job.id!;
}

/**
 * Helper: Enqueue message for AI classification
 */
export async function enqueueClassification(
  queue: Queue<MessageJobData>,
  data: Omit<ClassifyJobData, 'type'>
): Promise<string> {
  const job = await queue.add(
    'classify',
    { type: 'classify', ...data },
    {
      jobId: `classify-${data.messageId}`,
    }
  );
  return job.id!;
}

/**
 * Helper: Enqueue task for Notion sync
 */
export async function enqueueNotionSync(
  queue: Queue<MessageJobData>,
  data: Omit<NotionSyncJobData, 'type'>
): Promise<string> {
  const job = await queue.add(
    'notion-sync',
    { type: 'notion-sync', ...data },
    {
      jobId: `notion-sync-${data.taskId}`,
      attempts: 5, // More retries for Notion API
      backoff: {
        type: 'exponential',
        delay: 3000, // 3s -> 6s -> 12s -> 24s -> 48s
      },
    }
  );
  return job.id!;
}

/**
 * Helper: Enqueue outbound SMS message
 */
export async function enqueueOutboundMessage(
  queue: Queue<MessageJobData>,
  data: Omit<OutboundMessageJobData, 'type'>
): Promise<string> {
  const job = await queue.add('outbound', { type: 'outbound', ...data });
  return job.id!;
}
