// Connection
export { createRedisConnection, createWorkerConnection } from './connection.js';

// Queues
export {
  createMessageQueue,
  enqueueInboundMessage,
  enqueueClassification,
  enqueueTodoistSync,
  enqueueOutboundMessage,
} from './queues/message.queue.js';

// Types
export * from './types/jobs.js';

// Re-export BullMQ types for convenience
export { Queue, Worker, Job } from 'bullmq';
export type { ConnectionOptions, Processor } from 'bullmq';
