import { Worker, type Job, type ConnectionOptions } from 'bullmq';
import { createDbClient } from '@clarity/database';
import {
  createWorkerConnection,
  createMessageQueue,
  QUEUE_NAMES,
  type MessageJobData,
} from '@clarity/queue';
import { createInboundProcessor } from './processors/inbound.js';
import { createClassifyProcessor } from './processors/classify.js';
import { createNotionSyncProcessor } from './processors/notion-sync.js';
import { createOutboundProcessor } from './processors/outbound.js';

/**
 * Clarity Worker
 *
 * Processes background jobs:
 * - Inbound message handling
 * - AI classification
 * - Notion synchronization
 * - Outbound SMS sending
 */
async function main() {
  // Configuration
  const config = {
    databaseUrl: process.env['DATABASE_URL']!,
    redisUrl: process.env['REDIS_URL']!,
    appUrl: process.env['APP_URL'] ?? 'http://localhost:3000',
    concurrency: parseInt(process.env['WORKER_CONCURRENCY'] ?? '5', 10),
  };

  // Validate required env vars
  const required = ['DATABASE_URL', 'REDIS_URL'];
  for (const env of required) {
    if (!process.env[env]) {
      console.error(`Missing required environment variable: ${env}`);
      process.exit(1);
    }
  }

  console.log('[Worker] Starting Clarity message worker...');

  // Initialize database
  const db = createDbClient(config.databaseUrl);
  console.log('[Worker] Database connected');

  // Initialize Redis connection for worker
  const redis = createWorkerConnection(config.redisUrl);
  console.log('[Worker] Redis connected');

  // Create message queue (for enqueueing follow-up jobs)
  // Cast redis to ConnectionOptions to handle ioredis version differences
  const redisConnection = redis as unknown as ConnectionOptions;
  const messageQueue = createMessageQueue(redisConnection);

  // Create processors
  const inboundProcessor = createInboundProcessor(db, messageQueue, config.appUrl);
  const classifyProcessor = createClassifyProcessor(db, messageQueue);
  const notionSyncProcessor = createNotionSyncProcessor(db);
  const outboundProcessor = createOutboundProcessor(db);

  // Create worker
  const worker = new Worker<MessageJobData>(
    QUEUE_NAMES.MESSAGES,
    async (job: Job<MessageJobData>) => {
      const { type } = job.data;

      console.log(`[Worker] Processing job ${job.id} (type: ${type})`);

      switch (type) {
        case 'inbound':
          return inboundProcessor(job as any);
        case 'classify':
          return classifyProcessor(job as any);
        case 'notion-sync':
          return notionSyncProcessor(job as any);
        case 'outbound':
          return outboundProcessor(job as any);
        default:
          throw new Error(`Unknown job type: ${type}`);
      }
    },
    {
      connection: redisConnection,
      concurrency: config.concurrency,
    }
  );

  // Event handlers
  worker.on('completed', (job: Job<MessageJobData>) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job: Job<MessageJobData> | undefined, error: Error) => {
    console.error(`[Worker] Job ${job?.id} failed:`, error.message);
  });

  worker.on('error', (error: Error) => {
    console.error('[Worker] Worker error:', error);
  });

  console.log(`[Worker] Listening for jobs on ${QUEUE_NAMES.MESSAGES}`);
  console.log(`[Worker] Concurrency: ${config.concurrency}`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('[Worker] Shutting down...');
    await worker.close();
    await messageQueue.close();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('[Worker] Fatal error:', error);
  process.exit(1);
});
