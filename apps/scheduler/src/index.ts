import cron from 'node-cron';
import type { ConnectionOptions } from 'bullmq';
import { createDbClient } from '@clarity/database';
import { createMessageQueue, createWorkerConnection } from '@clarity/queue';
import { runDailyDigest } from './jobs/daily-digest.js';
import { runMeetingReminders } from './jobs/meeting-reminder.js';
import { runWaitingFollowups } from './jobs/waiting-followup.js';

/**
 * Clarity Scheduler
 *
 * Runs scheduled jobs for:
 * - Daily digest messages (morning summary of tasks)
 * - Meeting reminders (X hours before scheduled meeting times)
 * - Waiting task follow-ups (remind about overdue waiting items)
 *
 * Jobs run on a schedule and check which users are due for notifications
 * based on their timezone and preferences.
 */

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const DATABASE_URL = process.env['DATABASE_URL'];

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable');
  process.exit(1);
}

async function main() {
  console.log('[Scheduler] Starting Clarity Scheduler...');

  // Create database connection (DATABASE_URL validated above)
  const db = createDbClient(DATABASE_URL!);

  // Create Redis connection and message queue
  // Cast to ConnectionOptions to handle ioredis version differences
  const redis = createWorkerConnection(REDIS_URL);
  const redisConnection = redis as unknown as ConnectionOptions;
  const messageQueue = createMessageQueue(redisConnection);

  console.log('[Scheduler] Connected to database and Redis');

  // Daily Digest Job - runs every minute, checks user's digest time
  // This approach allows per-user scheduling based on their timezone
  cron.schedule('* * * * *', async () => {
    try {
      await runDailyDigest(db, messageQueue);
    } catch (error) {
      console.error('[Scheduler:DailyDigest] Error:', error);
    }
  });
  console.log('[Scheduler] Daily digest job scheduled (checks every minute)');

  // Meeting Reminders - runs every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runMeetingReminders(db, messageQueue);
    } catch (error) {
      console.error('[Scheduler:MeetingReminder] Error:', error);
    }
  });
  console.log('[Scheduler] Meeting reminder job scheduled (every 15 minutes)');

  // Waiting Follow-ups - runs daily at 10 AM UTC
  cron.schedule('0 10 * * *', async () => {
    try {
      await runWaitingFollowups(db, messageQueue);
    } catch (error) {
      console.error('[Scheduler:WaitingFollowup] Error:', error);
    }
  });
  console.log('[Scheduler] Waiting follow-up job scheduled (daily at 10 AM UTC)');

  console.log('[Scheduler] All jobs scheduled. Scheduler running...');

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('[Scheduler] Shutting down...');
    await redis.quit();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('[Scheduler] Shutting down...');
    await redis.quit();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[Scheduler] Fatal error:', error);
  process.exit(1);
});
