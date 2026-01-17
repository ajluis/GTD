import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users } from '@gtd/database';
import { eq, and, isNotNull } from 'drizzle-orm';
import { enqueueOutboundMessage } from '@gtd/queue';
import type { MessageJobData } from '@gtd/queue';
import {
  createNotionClient,
  queryCompletedTasksInRange,
  queryTasksDueInRange,
  queryActiveProjects,
  queryWaitingTasks,
  querySomedayTasks,
  extractTaskTitle,
  extractTaskDueDate,
} from '@gtd/notion';

/**
 * Weekly Review Job
 *
 * Sends weekly review summary to users based on their preferences:
 * - Runs every minute
 * - Checks which users have weeklyReviewDay + weeklyReviewTime matching current time in their timezone
 * - Queries their Notion for weekly summary data
 * - Sends SMS summary
 */

interface WeeklyReviewData {
  completedThisWeek: number;
  completedTasks: string[];
  activeProjectsCount: number;
  waitingCount: number;
  overdueWaitingCount: number;
  somedayCount: number;
  upcomingNextWeek: number;
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
      isNotNull(users.notionAccessToken),
      isNotNull(users.notionTasksDatabaseId)
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
      const reviewData = await getWeeklyReviewData(user, user.timezone);

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
 * Get the start and end of the week for a given timezone
 */
function getWeekBounds(timezone: string): { weekStart: string; weekEnd: string; nextWeekEnd: string } {
  const now = new Date();

  // Get today in the user's timezone
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format
  const today = new Date(todayStr + 'T00:00:00');

  // Week start (7 days ago)
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 7);

  // Week end (today)
  const weekEnd = today;

  // Next week end (7 days from now)
  const nextWeekEnd = new Date(today);
  nextWeekEnd.setDate(today.getDate() + 7);

  return {
    weekStart: weekStart.toISOString().split('T')[0]!,
    weekEnd: weekEnd.toISOString().split('T')[0]!,
    nextWeekEnd: nextWeekEnd.toISOString().split('T')[0]!,
  };
}

/**
 * Get weekly review data from user's Notion
 */
async function getWeeklyReviewData(user: {
  notionAccessToken: string | null;
  notionTasksDatabaseId: string | null;
}, timezone: string): Promise<WeeklyReviewData | null> {
  if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
    return null;
  }

  const notion = createNotionClient(user.notionAccessToken);
  const { weekStart, weekEnd, nextWeekEnd } = getWeekBounds(timezone);

  const [completedTasks, upcomingTasks, projects, waitingTasks, somedayTasks] = await Promise.all([
    queryCompletedTasksInRange(notion, user.notionTasksDatabaseId, weekStart, weekEnd),
    queryTasksDueInRange(notion, user.notionTasksDatabaseId, weekEnd, nextWeekEnd),
    queryActiveProjects(notion, user.notionTasksDatabaseId),
    queryWaitingTasks(notion, user.notionTasksDatabaseId),
    querySomedayTasks(notion, user.notionTasksDatabaseId),
  ]);

  // Count overdue waiting tasks
  const today = weekEnd;
  const overdueWaiting = waitingTasks.filter((task) => {
    const dueDate = extractTaskDueDate(task);
    return dueDate && dueDate < today;
  });

  return {
    completedThisWeek: completedTasks.length,
    completedTasks: completedTasks.slice(0, 5).map((t: unknown) => extractTaskTitle(t)),
    activeProjectsCount: projects.length,
    waitingCount: waitingTasks.length,
    overdueWaitingCount: overdueWaiting.length,
    somedayCount: somedayTasks.length,
    upcomingNextWeek: upcomingTasks.length,
  };
}

/**
 * Format weekly review message (~280 chars for SMS)
 */
function formatWeeklyReviewMessage(data: WeeklyReviewData): string {
  const lines: string[] = ['📋 WEEKLY REVIEW'];
  lines.push('');

  // Completed this week (wins)
  if (data.completedThisWeek > 0) {
    lines.push(`🎯 ${data.completedThisWeek} completed!`);
    for (const task of data.completedTasks.slice(0, 3)) {
      lines.push(`  ✓ ${truncate(task, 25)}`);
    }
    if (data.completedThisWeek > 3) {
      lines.push(`  (+${data.completedThisWeek - 3} more)`);
    }
  } else {
    lines.push('🎯 No tasks completed');
  }

  lines.push('');

  // Summary stats
  lines.push(`📁 ${data.activeProjectsCount} active project${data.activeProjectsCount !== 1 ? 's' : ''}`);

  const waitingLine = data.overdueWaitingCount > 0
    ? `⏳ ${data.waitingCount} waiting (${data.overdueWaitingCount} overdue!)`
    : `⏳ ${data.waitingCount} waiting`;
  lines.push(waitingLine);

  lines.push(`💭 ${data.somedayCount} someday item${data.somedayCount !== 1 ? 's' : ''}`);

  lines.push('');
  lines.push(`📅 ${data.upcomingNextWeek} due next week`);

  lines.push('');
  lines.push("Reply REVIEW for details.");

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
