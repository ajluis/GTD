import type { Job } from 'bullmq';
import type { NotionSyncJobData } from '@gtd/queue';
import type { DbClient } from '@gtd/database';
import { users, tasks, people } from '@gtd/database';
import { eq } from 'drizzle-orm';
import { createTodoistClient, createTask as createTodoistTask } from '@gtd/todoist';

/**
 * Todoist Sync Processor
 *
 * Syncs local tasks to Todoist:
 * 1. Get Todoist API token from env
 * 2. Create task in Todoist
 * 3. Update local task with Todoist task ID
 */
export function createTodoistSyncProcessor(db: DbClient) {
  return async (job: Job<NotionSyncJobData>) => {
    const { userId, taskId } = job.data;

    console.log(`[TodoistSync] Syncing task ${taskId} for user ${userId}`);

    // 1. Get the local task
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 2. Get person details if applicable
    let personName: string | null = null;
    let personLabel: string | null = null;
    if (task.personId) {
      const person = await db.query.people.findFirst({
        where: eq(people.id, task.personId),
      });
      personName = person?.name ?? null;
      personLabel = person?.todoistLabel ?? person?.name ?? null;
    }

    // 3. Create in Todoist
    try {
      const todoist = createTodoistClient();

      const todoistTaskId = await createTodoistTask(todoist, {
        title: task.title,
        type: task.type,
        context: task.context,
        priority: task.priority,
        dueDate: task.dueDate,
        personName,
        notes: task.notes,
        personLabel,
      });

      console.log(`[TodoistSync] Created Todoist task: ${todoistTaskId}`);

      // 4. Update local task with Todoist reference
      // Using notionPageId field to store Todoist task ID for now
      await db
        .update(tasks)
        .set({
          notionPageId: todoistTaskId,
          status: 'synced',
          syncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));

      return { success: true, todoistTaskId };
    } catch (error) {
      // Log error and mark task as failed
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(`[TodoistSync] Failed to sync task ${taskId}:`, error);

      await db
        .update(tasks)
        .set({
          status: 'failed',
          lastSyncError: errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));

      // Re-throw to trigger BullMQ retry
      throw error;
    }
  };
}
