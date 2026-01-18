import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users } from '@gtd/database';
import { eq, and, isNotNull } from 'drizzle-orm';
import { enqueueOutboundMessage } from '@gtd/queue';
import type { MessageJobData } from '@gtd/queue';
import {
  createNotionClient,
  queryTasksDueToday,
  queryActiveActions,
  extractTaskTitle,
} from '@gtd/notion';

/**
 * Daily Digest Job
 *
 * Sends morning summary to users based on their preferences:
 * - Runs every minute
 * - Checks which users have digestTime matching current time in their timezone
 * - Queries their Notion for today's tasks
 * - Sends SMS summary
 */

interface DigestData {
  todayCount: number;
  actionCount: number;
  topTasks: string[];
}

/**
 * Run the daily digest job
 */
export async function runDailyDigest(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
): Promise<void> {
  // Get current time in HH:MM format
  const now = new Date();

  // Find users who should receive digest at this time
  // We check all active users and compare their digest time + timezone
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(users.status, 'active'),
      isNotNull(users.notionAccessToken),
      isNotNull(users.notionTasksDatabaseId)
    ),
  });

  for (const user of activeUsers) {
    // Check if it's time for this user's digest
    if (!isDigestTime(now, user.digestTime, user.timezone)) {
      continue;
    }

    // Check if we already sent digest today (avoid duplicates)
    // For simplicity, we track this by checking if message was sent in last hour
    // A more robust solution would use a separate tracking table
    const recentlySent = await checkRecentDigest(db, user.id);
    if (recentlySent) {
      continue;
    }

    try {
      console.log(`[DailyDigest] Sending digest to user ${user.id}`);

      // Query user's tasks
      const digestData = await getDigestData(user);

      if (!digestData) {
        continue;
      }

      // Format and send digest
      const message = formatDigestMessage(digestData);

      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: user.phoneNumber,
        content: message,
      });

      console.log(`[DailyDigest] Sent digest to ${user.phoneNumber}`);
    } catch (error) {
      console.error(`[DailyDigest] Error for user ${user.id}:`, error);
    }
  }
}

/**
 * Check if it's time for user's daily digest
 */
function isDigestTime(now: Date, digestTime: string, timezone: string): boolean {
  try {
    // Parse the digest time (format: "HH:MM")
    const [targetHour, targetMinute] = digestTime.split(':').map(Number);
    if (targetHour === undefined || targetMinute === undefined) {
      return false;
    }

    // Get current hour and minute in user's timezone
    // Use numeric format to avoid locale inconsistencies
    const hourStr = now.toLocaleString('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const minuteStr = now.toLocaleString('en-US', {
      timeZone: timezone,
      minute: 'numeric',
    });

    const currentHour = parseInt(hourStr, 10);
    const currentMinute = parseInt(minuteStr, 10);

    // Compare hours and minutes directly
    return currentHour === targetHour && currentMinute === targetMinute;
  } catch {
    return false;
  }
}

/**
 * Check if we recently sent a digest (within last hour)
 */
async function checkRecentDigest(_db: DbClient, _userId: string): Promise<boolean> {
  // TODO: Implement proper tracking with a sent_digests table
  // For now, we rely on the minute-level scheduling to avoid duplicates
  return false;
}

/**
 * Get digest data from user's Notion
 */
async function getDigestData(user: {
  notionAccessToken: string | null;
  notionTasksDatabaseId: string | null;
  timezone: string;
}): Promise<DigestData | null> {
  if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
    return null;
  }

  const notion = createNotionClient(user.notionAccessToken);

  const [todayTasks, allActions] = await Promise.all([
    queryTasksDueToday(notion, user.notionTasksDatabaseId, user.timezone),
    queryActiveActions(notion, user.notionTasksDatabaseId),
  ]);

  return {
    todayCount: todayTasks.length,
    actionCount: allActions.length,
    topTasks: todayTasks.slice(0, 3).map((t: unknown) => extractTaskTitle(t)),
  };
}

/**
 * Format digest message
 */
function formatDigestMessage(data: DigestData): string {
  const lines: string[] = ['☀️ Good morning!'];

  if (data.todayCount === 0) {
    lines.push("No tasks due today - clear calendar!");
  } else {
    lines.push(`${data.todayCount} task${data.todayCount === 1 ? '' : 's'} for today:`);

    for (const task of data.topTasks) {
      lines.push(`• ${truncate(task, 35)}`);
    }

    if (data.todayCount > 3) {
      lines.push(`  (+${data.todayCount - 3} more)`);
    }
  }

  if (data.actionCount > data.todayCount) {
    lines.push(`\n${data.actionCount} total actions in queue.`);
  }

  lines.push("\nText 'today' for full list.");

  return lines.join('\n');
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '…';
}
