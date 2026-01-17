import { users, people, tasks } from '@clarity/database';
import { eq, desc } from 'drizzle-orm';
import {
  createNotionClient,
  findTaskByText,
  completeTask,
  queryAgendaForPerson,
  markDiscussed,
  extractTaskTitle,
  isTaskDueToday,
} from '@clarity/notion';
import { formatTaskComplete } from '@clarity/gtd';
import type { IntentEntities } from '@clarity/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Handle complete_task intent
 * "finished the dentist call", "done with groceries"
 */
export async function handleCompleteTask(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const searchText = entities.taskText;
  if (!searchText) {
    return "What did you complete? Try 'finished [task]' or 'done [task]'";
  }

  if (!ctx.user.notionAccessToken || !ctx.user.notionTasksDatabaseId) {
    return "Connect Notion first to mark tasks complete.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const matchingTasks = await findTaskByText(notion, ctx.user.notionTasksDatabaseId, searchText);

    if (matchingTasks.length === 0) {
      return `No matching task found for "${searchText}".\n\nTry a different search term.`;
    }

    if (matchingTasks.length === 1) {
      // Exact match - complete it
      const task = matchingTasks[0]!;
      const title = extractTaskTitle(task);
      const wasDueToday = isTaskDueToday(task);

      await completeTask(notion, task.id);

      // Update local DB stats
      const newCompletedCount = (ctx.user.totalTasksCompleted ?? 0) + 1;
      await ctx.db
        .update(users)
        .set({
          totalTasksCompleted: newCompletedCount,
          updatedAt: new Date(),
        })
        .where(eq(users.id, ctx.user.id));

      // Get today's completion count for streak message
      // For simplicity, we just increment from current count
      return formatTaskComplete(title, wasDueToday, {
        totalCount: newCompletedCount,
      });
    }

    // Multiple matches - ask user to be more specific
    const options = matchingTasks.slice(0, 3).map((t, i) => `${i + 1}. ${extractTaskTitle(t)}`);
    return `Found ${matchingTasks.length} matching tasks:\n${options.join('\n')}\n\nBe more specific or try the exact task name.`;
  } catch (error) {
    console.error('[Complete:task] Error:', error);
    return "Couldn't complete task. Try again later.";
  }
}

/**
 * Handle complete_recent intent
 * "done", "that's done", "finished"
 */
export async function handleCompleteRecent(ctx: HandlerContext): Promise<string> {
  // Find the most recently created/synced task
  const recentTasks = await ctx.db.query.tasks.findMany({
    where: eq(tasks.userId, ctx.user.id),
    orderBy: [desc(tasks.createdAt)],
    limit: 1,
  });

  if (recentTasks.length === 0) {
    return "No recent tasks to complete. Capture a task first!";
  }

  const recentTask = recentTasks[0]!;

  if (recentTask.status === 'completed') {
    return `"${recentTask.title}" is already done!`;
  }

  if (!ctx.user.notionAccessToken || !recentTask.notionPageId) {
    return "Connect Notion first to mark tasks complete.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    await completeTask(notion, recentTask.notionPageId);

    // Update local task
    await ctx.db
      .update(tasks)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(tasks.id, recentTask.id));

    // Update user stats
    const newCompletedCount = (ctx.user.totalTasksCompleted ?? 0) + 1;
    await ctx.db
      .update(users)
      .set({
        totalTasksCompleted: newCompletedCount,
        updatedAt: new Date(),
      })
      .where(eq(users.id, ctx.user.id));

    return formatTaskComplete(recentTask.title, false, {
      totalCount: newCompletedCount,
    });
  } catch (error) {
    console.error('[Complete:recent] Error:', error);
    return "Couldn't complete task. Try again later.";
  }
}

/**
 * Handle complete_person_agenda intent
 * "done with Sarah", "met with John", "all caught up with David"
 */
export async function handleCompletePersonAgenda(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;
  if (!personName) {
    return "Who did you meet with? Try 'done with [name]'";
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
    return "Connect Notion first to process agenda items.";
  }

  try {
    const notion = createNotionClient(ctx.user.notionAccessToken);
    const agendaItems = await queryAgendaForPerson(notion, ctx.user.notionTasksDatabaseId, person.notionPageId);

    if (agendaItems.length === 0) {
      return `✅ No pending agenda items for ${person.name}.\n\nGreat meeting! 🎉`;
    }

    // Mark all items as discussed
    const itemTitles = agendaItems.map((item, i) => `${i + 1}. ${extractTaskTitle(item)}`);

    for (const item of agendaItems) {
      await markDiscussed(notion, item.id);
    }

    return `👥 ${person.name} - ${agendaItems.length} items discussed:\n${itemTitles.join('\n')}\n\n✅ All marked as discussed!`;
  } catch (error) {
    console.error('[Complete:person_agenda] Error:', error);
    return "Couldn't process agenda items. Try again later.";
  }
}
