import type { IntentEntities } from '@clarity/shared-types';
import { PRIORITY_TO_NOTION, CONTEXT_TO_NOTION } from '@clarity/shared-types';
import type { HandlerContext } from './intents.js';
import {
  createNotionClient,
  findTaskByText,
  extractTaskTitle,
} from '@clarity/notion';

/**
 * Handle reschedule_task intent
 * "move dentist to Friday", "change proposal to next week"
 */
export async function handleRescheduleTask(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;
  const dueDate = entities.dueDate;

  if (!taskText) {
    return "Which task? Try 'move [task] to [date]'";
  }

  if (!dueDate) {
    return "What date? Try 'move [task] to Friday' or 'move [task] to next week'";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to edit tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, taskText);

    if (matchingTasks.length === 0) {
      return `No task found matching "${taskText}".`;
    }

    const task = matchingTasks[0]!;
    const title = extractTaskTitle(task);

    // Update the task in Notion
    await notion.pages.update({
      page_id: task.id,
      properties: {
        Due: {
          date: { start: dueDate },
        },
      } as any,
    });

    // Format date for display
    const displayDate = formatDateForDisplay(dueDate);

    return `✅ "${title}" rescheduled to ${displayDate}.`;
  } catch (error) {
    console.error('[Editing:reschedule] Error:', error);
    return "Couldn't reschedule task. Try again later.";
  }
}

/**
 * Handle set_task_priority intent
 * "make proposal urgent", "dentist is high priority"
 */
export async function handleSetTaskPriority(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;
  const priority = entities.priority;

  if (!taskText) {
    return "Which task? Try 'make [task] urgent'";
  }

  if (!priority) {
    return "What priority? Try 'make [task] urgent' or 'mark [task] as today'";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to edit tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, taskText);

    if (matchingTasks.length === 0) {
      return `No task found matching "${taskText}".`;
    }

    const task = matchingTasks[0]!;
    const title = extractTaskTitle(task);
    const notionPriority = PRIORITY_TO_NOTION[priority];

    await notion.pages.update({
      page_id: task.id,
      properties: {
        Priority: {
          select: { name: notionPriority },
        },
      } as any,
    });

    return `✅ "${title}" is now ${notionPriority}.`;
  } catch (error) {
    console.error('[Editing:priority] Error:', error);
    return "Couldn't update priority. Try again later.";
  }
}

/**
 * Handle set_task_context intent
 * "change groceries to errands", "dentist is a call"
 */
export async function handleSetTaskContext(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;
  const context = entities.context;

  if (!taskText) {
    return "Which task? Try '[task] is an errand' or 'change [task] to @home'";
  }

  if (!context) {
    return "What context? Options: @work, @home, @errands, @calls, @computer";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to edit tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, taskText);

    if (matchingTasks.length === 0) {
      return `No task found matching "${taskText}".`;
    }

    const task = matchingTasks[0]!;
    const title = extractTaskTitle(task);
    const notionContext = CONTEXT_TO_NOTION[context];

    await notion.pages.update({
      page_id: task.id,
      properties: {
        Context: {
          select: { name: notionContext },
        },
      } as any,
    });

    return `✅ "${title}" is now ${notionContext}.`;
  } catch (error) {
    console.error('[Editing:context] Error:', error);
    return "Couldn't update context. Try again later.";
  }
}

/**
 * Handle add_task_note intent
 * "add note to dentist: bring insurance card"
 */
export async function handleAddTaskNote(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;
  const noteContent = entities.noteContent;

  if (!taskText) {
    return "Which task? Try 'add note to [task]: [your note]'";
  }

  if (!noteContent) {
    return "What note? Try 'add note to [task]: [your note]'";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to edit tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, taskText);

    if (matchingTasks.length === 0) {
      return `No task found matching "${taskText}".`;
    }

    const task = matchingTasks[0]!;
    const title = extractTaskTitle(task);

    // Get existing notes
    const existingNotes = task.properties?.Notes?.rich_text?.[0]?.plain_text ?? '';
    const newNotes = existingNotes
      ? `${existingNotes}\n---\n${noteContent}`
      : noteContent;

    await notion.pages.update({
      page_id: task.id,
      properties: {
        Notes: {
          rich_text: [{ text: { content: newNotes } }],
        },
      } as any,
    });

    return `✅ Note added to "${title}".`;
  } catch (error) {
    console.error('[Editing:note] Error:', error);
    return "Couldn't add note. Try again later.";
  }
}

/**
 * Handle rename_task intent
 * "rename dentist to 'Call Dr. Smith'"
 */
export async function handleRenameTask(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;
  const newValue = entities.newValue;

  if (!taskText) {
    return "Which task? Try 'rename [task] to [new name]'";
  }

  if (!newValue) {
    return "What's the new name? Try 'rename [task] to [new name]'";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to edit tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, taskText);

    if (matchingTasks.length === 0) {
      return `No task found matching "${taskText}".`;
    }

    const task = matchingTasks[0]!;
    const oldTitle = extractTaskTitle(task);

    await notion.pages.update({
      page_id: task.id,
      properties: {
        Task: {
          title: [{ text: { content: newValue } }],
        },
      } as any,
    });

    return `✅ Renamed "${oldTitle}" → "${newValue}"`;
  } catch (error) {
    console.error('[Editing:rename] Error:', error);
    return "Couldn't rename task. Try again later.";
  }
}

/**
 * Handle delete_task intent
 * "delete the gym task", "remove groceries", "cancel dentist"
 */
export async function handleDeleteTask(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;

  if (!taskText) {
    return "Which task? Try 'delete [task]' or 'cancel [task]'";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to delete tasks.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, taskText);

    if (matchingTasks.length === 0) {
      return `No task found matching "${taskText}".`;
    }

    const task = matchingTasks[0]!;
    const title = extractTaskTitle(task);

    // Archive the page (Notion's soft delete)
    await notion.pages.update({
      page_id: task.id,
      archived: true,
    });

    return `🗑️ Deleted "${title}".`;
  } catch (error) {
    console.error('[Editing:delete] Error:', error);
    return "Couldn't delete task. Try again later.";
  }
}

/**
 * Handle assign_task_person intent
 * "assign proposal to Sarah", "this is for John"
 */
export async function handleAssignTaskPerson(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskText = entities.taskText;
  const personName = entities.personName;

  if (!taskText) {
    return "Which task? Try 'assign [task] to [person]'";
  }

  if (!personName) {
    return "Who should it be assigned to? Try 'assign [task] to [person]'";
  }

  // For now, return not implemented
  // Full implementation would require finding the person's Notion page ID
  // and updating the task's Person relation
  return `Task assignment coming soon! For now, you can mention the person when capturing: "ask ${personName} about [topic]"`;
}

/**
 * Format date for display
 */
function formatDateForDisplay(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) {
    return 'Today';
  }

  if (date.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  }

  // Check if this week
  const daysUntil = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil > 0 && daysUntil <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
