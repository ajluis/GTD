import type { Queue } from 'bullmq';
import type { DbClient } from '@clarity/database';
import { users } from '@clarity/database';
import { eq, and, isNotNull } from 'drizzle-orm';
import { enqueueOutboundMessage } from '@clarity/queue';
import type { MessageJobData } from '@clarity/queue';
import {
  createNotionClient,
  queryWaitingTasks,
  extractTaskTitle,
  extractTaskDueDate,
} from '@clarity/notion';

/**
 * Waiting Follow-up Job
 *
 * Reminds users about overdue waiting items:
 * - Runs daily at 10 AM UTC
 * - Queries Waiting tasks with past due dates
 * - Sends reminder SMS to follow up
 */

/**
 * Run the waiting follow-ups job
 */
export async function runWaitingFollowups(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
): Promise<void> {
  const today = new Date().toISOString().split('T')[0]!;

  // Find all active users with Notion configured
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(users.status, 'active'),
      isNotNull(users.notionAccessToken),
      isNotNull(users.notionTasksDatabaseId)
    ),
  });

  for (const user of activeUsers) {
    try {
      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        continue;
      }

      const notion = createNotionClient(user.notionAccessToken);
      const waitingTasks = await queryWaitingTasks(notion, user.notionTasksDatabaseId);

      // Filter to overdue items
      const overdueItems = waitingTasks.filter((task: unknown) => {
        const dueDate = extractTaskDueDate(task);
        return dueDate && dueDate < today;
      });

      if (overdueItems.length === 0) {
        continue;
      }

      // Format and send reminder
      const message = formatWaitingReminder(overdueItems);

      await enqueueOutboundMessage(messageQueue, {
        userId: user.id,
        toNumber: user.phoneNumber,
        content: message,
      });

      console.log(`[WaitingFollowup] Sent reminder for ${overdueItems.length} items to ${user.phoneNumber}`);
    } catch (error) {
      console.error(`[WaitingFollowup] Error for user ${user.id}:`, error);
    }
  }
}

/**
 * Format waiting reminder message
 */
function formatWaitingReminder(overdueItems: unknown[]): string {
  const count = overdueItems.length;

  const lines: string[] = [
    `⏳ ${count} waiting item${count === 1 ? '' : 's'} overdue:`,
    '',
  ];

  // Show first few items
  const topItems = overdueItems.slice(0, 3);
  for (const item of topItems) {
    const title = extractTaskTitle(item);
    const dueDate = extractTaskDueDate(item);
    const daysOverdue = dueDate ? getDaysOverdue(dueDate) : 0;

    let detail = '';
    if (daysOverdue === 1) {
      detail = ' (1 day)';
    } else if (daysOverdue > 1) {
      detail = ` (${daysOverdue} days)`;
    }

    lines.push(`• ${truncate(title, 30)}${detail}`);
  }

  if (count > 3) {
    lines.push(`  (+${count - 3} more)`);
  }

  lines.push("\nTime to follow up? Text 'waiting' to see all.");

  return lines.join('\n');
}

/**
 * Calculate days overdue
 */
function getDaysOverdue(dueDate: string): number {
  const due = new Date(dueDate + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = today.getTime() - due.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
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
