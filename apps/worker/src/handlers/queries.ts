import { people } from '@gtd/database';
import { eq } from 'drizzle-orm';
import {
  createTodoistClient,
  queryDueToday,
  queryDueTomorrow,
  queryWaiting,
  queryOverdueWaiting,
  queryByContext,
  queryByLabel,
  queryHighPriority,
  queryDueThisWeek,
  type TodoistTaskResult,
} from '@gtd/todoist';
import { formatTaskList, formatHelp } from '@gtd/gtd';
import type { IntentEntities } from '@gtd/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Extract title from Todoist task (just the content field)
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
 * Get ISO date string (YYYY-MM-DD) in a specific timezone
 */
function getISODateInTimezone(date: Date, timezone: string): string {
  const year = date.toLocaleString('en-US', { year: 'numeric', timeZone: timezone });
  const month = date.toLocaleString('en-US', { month: '2-digit', timeZone: timezone });
  const day = date.toLocaleString('en-US', { day: '2-digit', timeZone: timezone });
  return `${year}-${month}-${day}`;
}

/**
 * Handle query_today intent
 */
export async function handleQueryToday(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "🔥 TODAY:\nConnect Todoist first to see your tasks.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    const tasks = await queryDueToday(todoist);

    if (tasks.length === 0) {
      return "🔥 TODAY:\nNo tasks due today! 🎉\n\nText something to capture a task.";
    }

    const today = getISODateInTimezone(new Date(), ctx.user.timezone);
    const formatted = tasks.map((t) => ({
      title: extractTaskTitle(t),
      detail: extractTaskDueDate(t) === today ? undefined : 'due soon',
    }));

    return formatTaskList('🔥 TODAY:', formatted);
  } catch (error) {
    console.error('[Query:today] Error:', error);
    return "🔥 TODAY:\nCouldn't fetch tasks. Try again later.";
  }
}

/**
 * Handle query_tomorrow intent
 */
export async function handleQueryTomorrow(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "📅 TOMORROW:\nConnect Todoist first to see your tasks.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    const tasks = await queryDueTomorrow(todoist);

    if (tasks.length === 0) {
      return "📅 TOMORROW:\nNo tasks due tomorrow.\n\nText something to capture a task.";
    }

    const formatted = tasks.map((t) => ({
      title: extractTaskTitle(t),
    }));

    return formatTaskList('📅 TOMORROW:', formatted);
  } catch (error) {
    console.error('[Query:tomorrow] Error:', error);
    return "📅 TOMORROW:\nCouldn't fetch tasks. Try again later.";
  }
}

/**
 * Handle query_actions intent
 */
export async function handleQueryActions(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "✅ ACTIONS:\nConnect Todoist first to see your tasks.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Get high priority tasks (priority 4 and 3)
    const tasks = await queryHighPriority(todoist);

    if (tasks.length === 0) {
      return "✅ ACTIONS:\nNo active actions.\n\nText something to capture a task.";
    }

    const formatted = tasks.slice(0, 10).map((t) => ({
      title: extractTaskTitle(t),
    }));

    const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
    return formatTaskList('✅ ACTIONS:', formatted) + suffix;
  } catch (error) {
    console.error('[Query:actions] Error:', error);
    return "✅ ACTIONS:\nCouldn't fetch tasks. Try again later.";
  }
}

/**
 * Handle query_projects intent
 * Note: In Todoist, "projects" are containers, not task types.
 * We'll show tasks labeled as 'project' type.
 */
export async function handleQueryProjects(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "📁 PROJECTS:\nConnect Todoist first to see your projects.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Query tasks with 'project' label (if we're using labels for types)
    // For now, show tasks due this week as a proxy
    const tasks = await queryDueThisWeek(todoist);

    if (tasks.length === 0) {
      return "📁 PROJECTS:\nNo active projects.\n\nCapture one by texting 'Project: [name]'";
    }

    const formatted = tasks.slice(0, 10).map((t) => ({
      title: extractTaskTitle(t),
    }));

    const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
    return formatTaskList('📁 THIS WEEK:', formatted) + suffix;
  } catch (error) {
    console.error('[Query:projects] Error:', error);
    return "📁 PROJECTS:\nCouldn't fetch projects. Try again later.";
  }
}

/**
 * Handle query_waiting intent
 */
export async function handleQueryWaiting(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "⏳ WAITING:\nConnect Todoist first to see your waiting items.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    const tasks = await queryWaiting(todoist);

    if (tasks.length === 0) {
      return "⏳ WAITING:\nNothing waiting on others.\n\nCapture with 'Waiting on [person] for [thing]'";
    }

    const formatted = tasks.map((t) => ({
      title: extractTaskTitle(t),
      detail: extractTaskDueDate(t) ? `due ${extractTaskDueDate(t)}` : undefined,
    }));

    return formatTaskList('⏳ WAITING:', formatted);
  } catch (error) {
    console.error('[Query:waiting] Error:', error);
    return "⏳ WAITING:\nCouldn't fetch tasks. Try again later.";
  }
}

/**
 * Handle query_someday intent
 * Note: Someday items should be in a "Someday" project or have a specific label
 */
export async function handleQuerySomeday(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "💭 SOMEDAY:\nConnect Todoist first to see your someday list.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Query tasks with 'someday' label
    const tasks = await queryByLabel(todoist, 'someday');

    if (tasks.length === 0) {
      return "💭 SOMEDAY:\nNo someday items yet.\n\nCapture ideas with 'Someday: [idea]'";
    }

    const formatted = tasks.slice(0, 10).map((t) => ({
      title: extractTaskTitle(t),
    }));

    const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
    return formatTaskList('💭 SOMEDAY:', formatted) + suffix;
  } catch (error) {
    console.error('[Query:someday] Error:', error);
    return "💭 SOMEDAY:\nCouldn't fetch tasks. Try again later.";
  }
}

/**
 * Handle query_context intent
 */
export async function handleQueryContext(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const context = entities.context;
  if (!context) {
    return "Which context? Try: @computer, @phone, @out";
  }

  if (!ctx.user.todoistAccessToken) {
    return `📍 @${context}:\nConnect Todoist first to see your tasks.`;
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Map context to label (home/outside -> out)
    const label = context === 'home' || context === 'outside' ? 'out' : context;
    const tasks = await queryByContext(todoist, label);

    if (tasks.length === 0) {
      return `📍 @${context}:\nNo tasks in this context.\n\nCapture one by adding @${context} to your message.`;
    }

    const formatted = tasks.slice(0, 10).map((t) => ({
      title: extractTaskTitle(t),
    }));

    const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
    return formatTaskList(`📍 @${context}:`, formatted) + suffix;
  } catch (error) {
    console.error(`[Query:context:${context}] Error:`, error);
    return `📍 @${context}:\nCouldn't fetch tasks. Try again later.`;
  }
}

/**
 * Handle query_people intent
 */
export async function handleQueryPeople(ctx: HandlerContext): Promise<string> {
  const userPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  if (userPeople.length === 0) {
    return "👥 PEOPLE:\nNo people added yet.\n\nAdd someone by texting 'track [name]' or 'add person [name]'.";
  }

  const lines = userPeople.map((p) => {
    const schedule = p.frequency && p.dayOfWeek
      ? ` (${p.frequency} on ${p.dayOfWeek})`
      : p.frequency
        ? ` (${p.frequency})`
        : '';
    return `• ${p.name}${schedule}`;
  });

  return `👥 PEOPLE:\n${lines.join('\n')}`;
}

/**
 * Handle query_person_agenda intent
 */
export async function handleQueryPersonAgenda(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;
  if (!personName) {
    return "Whose agenda? Text a person's name to see their items.";
  }

  // Find person in user's list
  const userPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  const person = userPeople.find(
    (p) =>
      p.name.toLowerCase() === personName.toLowerCase() ||
      p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
  );

  if (!person) {
    return `I don't have "${personName}" in your people list.\n\nAdd them with 'track ${personName}'`;
  }

  if (!ctx.user.todoistAccessToken) {
    return `👤 ${person.name}\n\nConnect Todoist first to see agenda items.`;
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Query by person's label (lowercase, underscores)
    const personLabel = person.name.toLowerCase().replace(/\s+/g, '_');
    const agendaItems = await queryByLabel(todoist, personLabel);

    if (agendaItems.length === 0) {
      return `👤 ${person.name}\n\nNo pending agenda items.\n\nAdd one by texting '@${person.name.split(' ')[0]} [topic]'`;
    }

    const formatted = agendaItems.map((t) => ({
      title: extractTaskTitle(t),
    }));

    return formatTaskList(`👤 ${person.name} (${agendaItems.length} pending):`, formatted, true);
  } catch (error) {
    console.error('[Query:person_agenda] Error:', error);
    return `👤 ${person.name}\n\nCouldn't fetch agenda items. Try again later.`;
  }
}

/**
 * Handle show_weekly_review intent
 * "review", "weekly review", "show me my review"
 */
export async function handleShowWeeklyReview(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.todoistAccessToken) {
    return "📋 WEEKLY REVIEW:\nConnect Todoist first to see your review.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);

    // Get week bounds
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]!;

    const [dueTodayTasks, dueThisWeekTasks, waitingTasks, overdueWaitingTasks] = await Promise.all([
      queryDueToday(todoist),
      queryDueThisWeek(todoist),
      queryWaiting(todoist),
      queryOverdueWaiting(todoist),
    ]);

    const lines: string[] = ['📋 WEEKLY REVIEW'];
    lines.push('');

    // TODAY
    lines.push(`🔥 DUE TODAY (${dueTodayTasks.length}):`);
    if (dueTodayTasks.length > 0) {
      for (const task of dueTodayTasks.slice(0, 5)) {
        lines.push(`  • ${extractTaskTitle(task)}`);
      }
      if (dueTodayTasks.length > 5) {
        lines.push(`  (+${dueTodayTasks.length - 5} more)`);
      }
    } else {
      lines.push('  (none)');
    }
    lines.push('');

    // THIS WEEK
    lines.push(`📅 DUE THIS WEEK (${dueThisWeekTasks.length}):`);
    if (dueThisWeekTasks.length > 0) {
      for (const task of dueThisWeekTasks.slice(0, 5)) {
        const dueDate = extractTaskDueDate(task);
        const dateSuffix = dueDate ? ` (${dueDate})` : '';
        lines.push(`  • ${extractTaskTitle(task)}${dateSuffix}`);
      }
      if (dueThisWeekTasks.length > 5) {
        lines.push(`  (+${dueThisWeekTasks.length - 5} more)`);
      }
    } else {
      lines.push('  (none)');
    }
    lines.push('');

    // WAITING
    const waitingHeader = overdueWaitingTasks.length > 0
      ? `⏳ WAITING (${waitingTasks.length}, ${overdueWaitingTasks.length} overdue!):`
      : `⏳ WAITING (${waitingTasks.length}):`;
    lines.push(waitingHeader);
    if (waitingTasks.length > 0) {
      for (const task of waitingTasks.slice(0, 3)) {
        const dueDate = extractTaskDueDate(task);
        const isOverdue = dueDate && dueDate < todayStr;
        const suffix = isOverdue ? ' ⚠️' : '';
        lines.push(`  • ${extractTaskTitle(task)}${suffix}`);
      }
      if (waitingTasks.length > 3) {
        lines.push(`  (+${waitingTasks.length - 3} more)`);
      }
    } else {
      lines.push('  (none)');
    }

    return lines.join('\n');
  } catch (error) {
    console.error('[Query:weekly_review] Error:', error);
    return "📋 WEEKLY REVIEW:\nCouldn't fetch data. Try again later.";
  }
}
