import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users } from '@gtd/database';
import { eq, and, isNotNull } from 'drizzle-orm';
import { enqueueOutboundMessage } from '@gtd/queue';
import type { MessageJobData } from '@gtd/queue';
import {
  createTodoistClient,
  queryOverdueWaiting,
  type TodoistTaskResult,
} from '@gtd/todoist';

/**
 * Waiting Follow-up Job
 *
 * Reminds users about overdue waiting items:
 * - Runs daily at 10 AM UTC
 * - Queries Waiting tasks with past due dates
 * - Sends reminder SMS to follow up
 */

/**
 * Extract title from Todoist task
 */
function extractTaskTitle(task: TodoistTaskResult): string {
  return task.content;
}

/**
 * Extract due date from Todoist task
 */
function extractTaskDueDate(task: TodoistTaskResult): string | undefined {
  return task.due?.date;
}

/**
 * Run the waiting follow-ups job
 */
export async function runWaitingFollowups(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
): Promise<void> {
  // Find all active users with Todoist configured
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(users.status, 'active'),
      isNotNull(users.todoistAccessToken)
    ),
  });

  for (const user of activeUsers) {
    try {
      if (!user.todoistAccessToken) {
        continue;
      }

      const todoist = createTodoistClient(user.todoistAccessToken);
      // Query directly for overdue waiting tasks using Todoist filter
      const overdueItems = await queryOverdueWaiting(todoist);

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
function formatWaitingReminder(overdueItems: TodoistTaskResult[]): string {
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
