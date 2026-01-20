import { people, conversationStates } from '@gtd/database';
import { eq } from 'drizzle-orm';
import {
  createTodoistClient,
  queryDueToday,
  queryByContext,
  queryPersonAgenda,
  completeTask,
  type TodoistTaskResult,
} from '@gtd/todoist';
import { formatHelp } from '@gtd/gtd';
import type { IntentEntities, BatchConfirmationData, TaskContext } from '@gtd/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Extract title from Todoist task
 */
function extractTaskTitle(task: TodoistTaskResult): string {
  return task.content;
}

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

  if (!ctx.user.todoistAccessToken) {
    return "Connect Todoist first to manage agenda items.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Person label is lowercase with underscores
    const personLabel = person.name.toLowerCase().replace(/\s+/g, '_');
    const agendaItems = await queryPersonAgenda(todoist, personLabel);

    if (agendaItems.length === 0) {
      return `${person.name} has no pending agenda items.`;
    }

    // Single item - clear immediately
    if (agendaItems.length === 1) {
      await completeTask(todoist, agendaItems[0]!.id);
      return `✅ Cleared 1 agenda item for ${person.name}.`;
    }

    // Multiple items - ask for confirmation
    const taskIds = agendaItems.map((t) => t.id);
    const taskTitles = agendaItems.map((t) => extractTaskTitle(t));

    // Store conversation state
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minute expiry

    await ctx.db.insert(conversationStates).values({
      userId: ctx.user.id,
      stateType: 'batch_confirmation',
      step: 'awaiting_yes',
      data: {
        operation: 'clear_person_agenda',
        taskIds,
        taskTitles,
        personName: person.name,
      } satisfies BatchConfirmationData,
      expiresAt,
    });

    const taskNames = taskTitles.slice(0, 3).map((t) => `• ${t}`);
    const moreText = agendaItems.length > 3 ? `\n• (+${agendaItems.length - 3} more)` : '';

    return `Clear ${agendaItems.length} agenda items for ${person.name}?\n${taskNames.join('\n')}${moreText}\n\nReply 'yes' to confirm.`;
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
  if (!ctx.user.todoistAccessToken) {
    return "Connect Todoist first to complete tasks.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    const todayTasks = await queryDueToday(todoist);

    if (todayTasks.length === 0) {
      return "No tasks due today to complete!";
    }

    // Single task - complete immediately
    if (todayTasks.length === 1) {
      const task = todayTasks[0]!;
      await completeTask(todoist, task.id);
      return `✅ "${extractTaskTitle(task)}" — done!`;
    }

    // Multiple tasks - ask for confirmation
    const taskIds = todayTasks.map((t) => t.id);
    const taskTitles = todayTasks.map((t) => extractTaskTitle(t));

    // Store conversation state
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minute expiry

    await ctx.db.insert(conversationStates).values({
      userId: ctx.user.id,
      stateType: 'batch_confirmation',
      step: 'awaiting_yes',
      data: {
        operation: 'complete_all_today',
        taskIds,
        taskTitles,
      } satisfies BatchConfirmationData,
      expiresAt,
    });

    const taskNames = taskTitles.slice(0, 3).map((t) => `• ${t}`);
    const moreText = todayTasks.length > 3 ? `\n• (+${todayTasks.length - 3} more)` : '';

    return `Complete ${todayTasks.length} tasks due today?\n${taskNames.join('\n')}${moreText}\n\nReply 'yes' to confirm.`;
  } catch (error) {
    console.error('[Bulk:complete_all_today] Error:', error);
    return "Couldn't complete tasks. Try again later.";
  }
}

/**
 * Handle complete_all_context intent
 * "finished all @errands", "done with @computer tasks"
 */
export async function handleCompleteAllContext(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const context = entities.context;

  if (!context) {
    return "Which context? Try 'done with @computer', 'finished all @errands', etc.";
  }

  if (!ctx.user.todoistAccessToken) {
    return "Connect Todoist first to complete tasks.";
  }

  try {
    const todoist = createTodoistClient(ctx.user.todoistAccessToken);
    // Map context to label (home/outside -> out)
    const contextLabel = context === 'home' || context === 'outside' ? 'out' : context;
    const contextTasks = await queryByContext(todoist, contextLabel);

    if (contextTasks.length === 0) {
      return `No @${context} tasks to complete!`;
    }

    // Single task - complete immediately
    if (contextTasks.length === 1) {
      const task = contextTasks[0]!;
      await completeTask(todoist, task.id);
      return `✅ "${extractTaskTitle(task)}" — done!`;
    }

    // Multiple tasks - ask for confirmation
    const taskIds = contextTasks.map((t) => t.id);
    const taskTitles = contextTasks.map((t) => extractTaskTitle(t));

    // Store conversation state
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5); // 5 minute expiry

    await ctx.db.insert(conversationStates).values({
      userId: ctx.user.id,
      stateType: 'batch_confirmation',
      step: 'awaiting_yes',
      data: {
        operation: 'complete_all_context',
        taskIds,
        taskTitles,
        context,
      } satisfies BatchConfirmationData,
      expiresAt,
    });

    const taskNames = taskTitles.slice(0, 3).map((t) => `• ${t}`);
    const moreText = contextTasks.length > 3 ? `\n• (+${contextTasks.length - 3} more)` : '';

    return `Complete ${contextTasks.length} @${context} tasks?\n${taskNames.join('\n')}${moreText}\n\nReply 'yes' to confirm.`;
  } catch (error) {
    console.error('[Bulk:complete_all_context] Error:', error);
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
