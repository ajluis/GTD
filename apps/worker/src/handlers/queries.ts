import { people } from '@gtd/database';
import { eq } from 'drizzle-orm';
import {
  createNotionClient,
  queryTasksDueToday,
  queryActiveActions,
  queryActiveProjects,
  queryWaitingTasks,
  querySomedayTasks,
  queryTasksByContext,
  queryAgendaForPerson,
  extractTaskTitle,
  extractTaskDueDate,
} from '@gtd/notion';
import { formatTaskList, formatHelp } from '@gtd/gtd';
import type { IntentEntities } from '@gtd/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Handle query_today intent
 */
export async function handleQueryToday(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "🔥 TODAY:\nConnect Notion first to see your tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const tasks = await queryTasksDueToday(notion, ctx.user.notionTasksDatabaseId);

    if (tasks.length === 0) {
      return "🔥 TODAY:\nNo tasks due today! 🎉\n\nText something to capture a task.";
    }

    const formatted = tasks.map((t) => ({
      title: extractTaskTitle(t),
      detail: extractTaskDueDate(t) === new Date().toISOString().split('T')[0] ? undefined : 'due soon',
    }));

    return formatTaskList('🔥 TODAY:', formatted);
  } catch (error) {
    console.error('[Query:today] Error:', error);
    return "🔥 TODAY:\nCouldn't fetch tasks. Try again later.";
  }
}

/**
 * Handle query_actions intent
 */
export async function handleQueryActions(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "✅ ACTIONS:\nConnect Notion first to see your tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const tasks = await queryActiveActions(notion, ctx.user.notionTasksDatabaseId);

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
 */
export async function handleQueryProjects(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "📁 PROJECTS:\nConnect Notion first to see your projects.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const tasks = await queryActiveProjects(notion, ctx.user.notionTasksDatabaseId);

    if (tasks.length === 0) {
      return "📁 PROJECTS:\nNo active projects.\n\nCapture one by texting 'Project: [name]'";
    }

    const formatted = tasks.map((t) => ({
      title: extractTaskTitle(t),
    }));

    return formatTaskList('📁 PROJECTS:', formatted);
  } catch (error) {
    console.error('[Query:projects] Error:', error);
    return "📁 PROJECTS:\nCouldn't fetch projects. Try again later.";
  }
}

/**
 * Handle query_waiting intent
 */
export async function handleQueryWaiting(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "⏳ WAITING:\nConnect Notion first to see your waiting items.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const tasks = await queryWaitingTasks(notion, ctx.user.notionTasksDatabaseId);

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
 */
export async function handleQuerySomeday(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "💭 SOMEDAY:\nConnect Notion first to see your someday list.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const tasks = await querySomedayTasks(notion, ctx.user.notionTasksDatabaseId);

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
    return "Which context? Try: @work, @home, @errands, @calls, @computer";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return `📍 @${context}:\nConnect Notion first to see your tasks.`;
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const tasks = await queryTasksByContext(notion, ctx.user.notionTasksDatabaseId, context);

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

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId || !person.notionPageId) {
    return `👤 ${person.name}\n\nConnect Notion first to see agenda items.`;
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const agendaItems = await queryAgendaForPerson(notion, ctx.user.notionTasksDatabaseId, person.notionPageId);

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
