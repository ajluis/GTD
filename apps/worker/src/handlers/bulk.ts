import { people } from '@clarity/database';
import { eq } from 'drizzle-orm';
import {
  createNotionClient,
  queryTasksDueToday,
  queryAgendaForPerson,
  completeTask,
  markDiscussed,
  extractTaskTitle,
} from '@clarity/notion';
import { formatHelp } from '@clarity/gtd';
import type { IntentEntities } from '@clarity/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Handle clear_person_agenda intent
 * "clear Sarah's agenda", "remove all items for John"
 */
export async function handleClearPersonAgenda(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;

  if (!personName) {
    return "Whose agenda? Try 'clear [name]'s agenda'";
  }

  // Find person
  const userPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  const person = userPeople.find(
    (p) =>
      p.name.toLowerCase() === personName.toLowerCase() ||
      p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
  );

  if (!person) {
    return `I don't have "${personName}" in your people list.`;
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId || !person.notionPageId) {
    return "Connect Notion first to manage agenda items.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const agendaItems = await queryAgendaForPerson(
      notion,
      ctx.user.notionTasksDatabaseId,
      person.notionPageId
    );

    if (agendaItems.length === 0) {
      return `${person.name} has no pending agenda items.`;
    }

    // Mark all as discussed (soft clear)
    for (const item of agendaItems) {
      await markDiscussed(notion, item.id);
    }

    return `✅ Cleared ${agendaItems.length} agenda items for ${person.name}.`;
  } catch (error) {
    console.error('[Bulk:clear_agenda] Error:', error);
    return "Couldn't clear agenda. Try again later.";
  }
}

/**
 * Handle complete_all_today intent
 * "mark everything today as done", "all done for today"
 */
export async function handleCompleteAllToday(ctx: HandlerContext): Promise<string> {
  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to complete tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const todayTasks = await queryTasksDueToday(notion, ctx.user.notionTasksDatabaseId);

    if (todayTasks.length === 0) {
      return "No tasks due today to complete!";
    }

    // Confirm before bulk complete
    if (todayTasks.length > 1) {
      const taskNames = todayTasks.slice(0, 3).map((t) => `• ${extractTaskTitle(t)}`);
      const moreText = todayTasks.length > 3 ? `\n• (+${todayTasks.length - 3} more)` : '';

      return `Are you sure? This will complete ${todayTasks.length} tasks:\n${taskNames.join('\n')}${moreText}\n\nReply 'yes' to confirm.`;
    }

    // Single task - just complete it
    const task = todayTasks[0]!;
    await completeTask(notion, task.id);

    return `✅ "${extractTaskTitle(task)}" — done!`;
  } catch (error) {
    console.error('[Bulk:complete_all] Error:', error);
    return "Couldn't complete tasks. Try again later.";
  }
}

/**
 * Handle show_stats intent
 * "how am I doing", "my stats", "show statistics"
 */
export async function handleShowStats(ctx: HandlerContext): Promise<string> {
  const captured = ctx.user.totalTasksCaptured ?? 0;
  const completed = ctx.user.totalTasksCompleted ?? 0;
  const completionRate = captured > 0
    ? Math.round((completed / captured) * 100)
    : 0;

  const lines = [
    '📊 YOUR STATS:',
    '',
    `📥 Tasks captured: ${captured}`,
    `✅ Tasks completed: ${completed}`,
    `📈 Completion rate: ${completionRate}%`,
  ];

  // Add motivational message based on stats
  if (completed >= 100) {
    lines.push('', '🏆 GTD Master! Over 100 tasks completed!');
  } else if (completed >= 50) {
    lines.push('', '🌟 Great progress! Halfway to 100!');
  } else if (completed >= 10) {
    lines.push('', '💪 Building momentum!');
  } else if (captured > 0) {
    lines.push('', '🚀 Just getting started!');
  }

  return lines.join('\n');
}

/**
 * Handle show_help intent
 * "help", "what can you do", "commands"
 */
export async function handleShowHelp(): Promise<string> {
  return formatHelp();
}
