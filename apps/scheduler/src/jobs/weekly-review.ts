import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users } from '@gtd/database';
import { eq, and, isNotNull } from 'drizzle-orm';
import { enqueueOutboundMessage } from '@gtd/queue';
import type { MessageJobData } from '@gtd/queue';
import {
  createTodoistClient,
  queryDueThisWeek,
  queryWaiting,
  queryOverdueWaiting,
  queryByLabel,
  type TodoistTaskResult,
} from '@gtd/todoist';

/**
 * Weekly Review Job
 *
 * Sends weekly review summary to users based on their preferences:
 * - Runs every minute
 * - Checks which users have weeklyReviewDay + weeklyReviewTime matching current time in their timezone
 * - Queries their Todoist for weekly summary data
 * - Sends SMS summary
 *
 * Note: Todoist's REST API doesn't easily expose completed task history,
 * so we focus on current state rather than weekly completion stats.
 */

interface WeeklyReviewData {
  upcomingThisWeek: number;
  topUpcoming: string[];
  waitingCount: number;
  overdueWaitingCount: number;
  somedayCount: number;
}

/**
 * Extract title from Todoist task
 */
function extractTaskTitle(task: TodoistTaskResult): string {
  return task.content;
}

/**
 * Run the weekly review job
 */
export async function runWeeklyReview(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
): Promise<void> {
  const now = new Date();

  // Find users who should receive weekly review at this time
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(users.status, 'active'),
      isNotNull(users.todoistAccessToken)
    ),
  });

  for (const user of activeUsers) {
    // Check if it's time for this user's weekly review
    if (!isWeeklyReviewTime(now, user.weeklyReviewDay, user.weeklyReviewTime, user.timezone)) {
      continue;
    }

    try {
      console.log(`[WeeklyReview] Sending review to user ${user.id}`);

      // Query user's tasks for the week
      const reviewData = await getWeeklyReviewData(user);

      if (!reviewData) {
        continue;
      }

      // Format and send review
      const message = formatWeeklyReviewMessage(reviewData);

      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: user.phoneNumber,
        content: message,
      });

      console.log(`[WeeklyReview] Sent review to ${user.phoneNumber}`);
    } catch (error) {
      console.error(`[WeeklyReview] Error for user ${user.id}:`, error);
    }
  }
}

/**
 * Check if it's time for user's weekly review
 */
function isWeeklyReviewTime(
  now: Date,
  reviewDay: string,
  reviewTime: string,
  timezone: string
): boolean {
  try {
    // Get current day and time in user's timezone
    const userDayOfWeek = now.toLocaleDateString('en-US', {
      timeZone: timezone,
      weekday: 'long',
    }).toLowerCase();

    const userTime = now.toLocaleTimeString('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    // Check if day and time match
    return userDayOfWeek === reviewDay && userTime === reviewTime;
  } catch {
    return false;
  }
}

/**
 * Get weekly review data from user's Todoist
 */
async function getWeeklyReviewData(user: {
  todoistAccessToken: string | null;
}): Promise<WeeklyReviewData | null> {
  if (!user.todoistAccessToken) {
    return null;
  }

  const todoist = createTodoistClient(user.todoistAccessToken);

  const [upcomingTasks, waitingTasks, overdueWaitingTasks, somedayTasks] = await Promise.all([
    queryDueThisWeek(todoist),
    queryWaiting(todoist),
    queryOverdueWaiting(todoist),
    queryByLabel(todoist, 'someday'),
  ]);

  return {
    upcomingThisWeek: upcomingTasks.length,
    topUpcoming: upcomingTasks.slice(0, 5).map(extractTaskTitle),
    waitingCount: waitingTasks.length,
    overdueWaitingCount: overdueWaitingTasks.length,
    somedayCount: somedayTasks.length,
  };
}

/**
 * Format weekly review message (~280 chars for SMS)
 */
function formatWeeklyReviewMessage(data: WeeklyReviewData): string {
  const lines: string[] = ['📋 WEEKLY REVIEW'];
  lines.push('');

  // Upcoming this week
  if (data.upcomingThisWeek > 0) {
    lines.push(`📅 ${data.upcomingThisWeek} due this week:`);
    for (const task of data.topUpcoming.slice(0, 3)) {
      lines.push(`  • ${truncate(task, 25)}`);
    }
    if (data.upcomingThisWeek > 3) {
      lines.push(`  (+${data.upcomingThisWeek - 3} more)`);
    }
  } else {
    lines.push('📅 Nothing due this week!');
  }

  lines.push('');

  // Waiting status
  const waitingLine = data.overdueWaitingCount > 0
    ? `⏳ ${data.waitingCount} waiting (${data.overdueWaitingCount} overdue!)`
    : `⏳ ${data.waitingCount} waiting`;
  lines.push(waitingLine);

  // Someday items
  lines.push(`💭 ${data.somedayCount} someday item${data.somedayCount !== 1 ? 's' : ''}`);

  lines.push('');
  lines.push("Reply 'review' for details.");

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
