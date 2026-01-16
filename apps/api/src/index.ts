import Fastify from 'fastify';
import cors from '@fastify/cors';
import { createDbClient } from '@clarity/database';
import { createRedisConnection, createMessageQueue } from '@clarity/queue';
import { healthRoutes } from './routes/health.js';
import { createSendblueWebhook } from './routes/webhooks/sendblue.js';
import { createNotionOAuthRoutes } from './routes/oauth/notion.js';

/**
 * Clarity API Server
 *
 * Handles:
 * - Sendblue webhook for incoming SMS
 * - Notion OAuth flow
 * - Health checks
 */
async function main() {
  // Configuration from environment
  const config = {
    port: parseInt(process.env.PORT ?? '3000', 10),
    host: process.env.HOST ?? '0.0.0.0',
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    sendblueWebhookSecret: process.env.SENDBLUE_WEBHOOK_SECRET!,
    appUrl: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? '3000'}`,
  };

  // Validate required env vars
  const required = ['DATABASE_URL', 'REDIS_URL', 'SENDBLUE_WEBHOOK_SECRET'];
  for (const env of required) {
    if (!process.env[env]) {
      console.error(`Missing required environment variable: ${env}`);
      process.exit(1);
    }
  }

  // Initialize Fastify
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport:
        process.env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // CORS
  await fastify.register(cors, {
    origin: true,
  });

  // Initialize database
  const db = createDbClient(config.databaseUrl);
  fastify.log.info('Database client initialized');

  // Initialize Redis and queue
  const redis = createRedisConnection(config.redisUrl);
  const messageQueue = createMessageQueue(redis);
  fastify.log.info('Redis and message queue initialized');

  // Register routes
  await fastify.register(healthRoutes, { prefix: '/health' });

  await fastify.register(
    createSendblueWebhook({
      webhookSecret: config.sendblueWebhookSecret,
      messageQueue,
    }),
    { prefix: '/webhooks/sendblue' }
  );

  await fastify.register(
    createNotionOAuthRoutes({
      db,
      appUrl: config.appUrl,
    }),
    { prefix: '/oauth/notion' }
  );

  // Graceful shutdown
  const shutdown = async () => {
    fastify.log.info('Shutting down...');
    await fastify.close();
    await messageQueue.close();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  try {
    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(`Server listening on ${config.host}:${config.port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();
