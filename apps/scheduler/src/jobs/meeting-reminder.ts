import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users, people } from '@gtd/database';
import { eq, and, isNotNull } from 'drizzle-orm';
import { enqueueOutboundMessage } from '@gtd/queue';
import type { MessageJobData } from '@gtd/queue';
import {
  createTodoistClient,
  queryPersonAgenda,
  type TodoistTaskResult,
} from '@gtd/todoist';
import type { DayOfWeek } from '@gtd/shared-types';

/**
 * Meeting Reminder Job
 *
 * Sends pre-meeting reminders based on user's people and their meeting schedules:
 * - Runs every 15 minutes
 * - Checks which people have meetings today
 * - Sends reminder X hours before (based on user preference)
 * - Includes pending agenda item count
 */

const DAY_NAMES: DayOfWeek[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * Extract title from Todoist task
 */
function extractTaskTitle(task: TodoistTaskResult): string {
  return task.content;
}

/**
 * Run the meeting reminders job
 */
export async function runMeetingReminders(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
): Promise<void> {
  // Get current day of week
  const now = new Date();

  // Find all active users with Todoist configured
  const activeUsers = await db.query.users.findMany({
    where: and(
      eq(users.status, 'active'),
      isNotNull(users.todoistAccessToken)
    ),
  });

  for (const user of activeUsers) {
    try {
      // Get user's current day and time in their timezone
      const userDay = getDayInTimezone(now, user.timezone);
      const userHour = getHourInTimezone(now, user.timezone);

      // Calculate when to send reminder (X hours before assumed meeting time)
      // Assume meetings are typically at 10 AM
      const reminderHour = 10 - user.meetingReminderHours;

      // Only send reminders at the right hour
      if (userHour !== reminderHour) {
        continue;
      }

      // Get people with meetings today
      const userPeople = await db.query.people.findMany({
        where: and(
          eq(people.userId, user.id),
          eq(people.active, true),
          eq(people.dayOfWeek, userDay)
        ),
      });

      if (userPeople.length === 0) {
        continue;
      }

      // Send reminder for each person with a meeting today
      for (const person of userPeople) {
        // Get pending agenda count using person's label
        const todoist = createTodoistClient(user.todoistAccessToken!);
        const personLabel = person.todoistLabel || person.name.toLowerCase().replace(/\s+/g, '_');
        const agendaItems = await queryPersonAgenda(todoist, personLabel);

        // Format and send reminder
        const message = formatMeetingReminder(person.name, agendaItems);

        await enqueueOutboundMessage(messageQueue, {
          userId: user.id,
          toNumber: user.phoneNumber,
          content: message,
        });

        console.log(`[MeetingReminder] Sent reminder for ${person.name} to ${user.phoneNumber}`);
      }
    } catch (error) {
      console.error(`[MeetingReminder] Error for user ${user.id}:`, error);
    }
  }
}

/**
 * Get day of week in user's timezone
 */
function getDayInTimezone(date: Date, timezone: string): DayOfWeek {
  try {
    const dayIndex = parseInt(
      date.toLocaleDateString('en-US', {
        timeZone: timezone,
        weekday: 'narrow',
      }),
      10
    );
    // toLocaleDateString returns day number 0-6
    const day = new Date(
      date.toLocaleString('en-US', { timeZone: timezone })
    ).getDay();
    return DAY_NAMES[day] ?? 'monday';
  } catch {
    return DAY_NAMES[date.getDay()] ?? 'monday';
  }
}

/**
 * Get current hour in user's timezone
 */
function getHourInTimezone(date: Date, timezone: string): number {
  try {
    return parseInt(
      date.toLocaleTimeString('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      }),
      10
    );
  } catch {
    return date.getHours();
  }
}

/**
 * Format meeting reminder message
 */
function formatMeetingReminder(personName: string, agendaItems: TodoistTaskResult[]): string {
  const itemCount = agendaItems.length;

  if (itemCount === 0) {
    return `📅 Meeting with ${personName} today!\n\nNo agenda items prepared.\nAdd one by texting '@${personName.split(' ')[0]} [topic]'`;
  }

  const lines: string[] = [
    `📅 Meeting with ${personName} today!`,
    `${itemCount} agenda item${itemCount === 1 ? '' : 's'}:`,
    '',
  ];

  // Show first few items
  const topItems = agendaItems.slice(0, 3);
  for (const item of topItems) {
    lines.push(`• ${truncate(extractTaskTitle(item), 35)}`);
  }

  if (itemCount > 3) {
    lines.push(`  (+${itemCount - 3} more)`);
  }

  lines.push(`\nText '${personName.split(' ')[0]?.toLowerCase()}' for full list.`);

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
