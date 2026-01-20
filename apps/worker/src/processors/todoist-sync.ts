import type { Job } from 'bullmq';
import type { TodoistSyncJobData } from '@gtd/queue';
import type { DbClient } from '@gtd/database';
import { users, tasks, people } from '@gtd/database';
import { eq } from 'drizzle-orm';
import {
  createTodoistClient,
  createTaskWithRouting,
  discoverTodoistStructure,
  ensureGTDLabels,
} from '@gtd/todoist';

/**
 * Todoist Sync Processor
 *
 * Syncs local tasks to Todoist with dynamic project routing:
 * 1. Get user's Todoist credentials
 * 2. Discover current Todoist structure (projects, labels)
 * 3. Ensure GTD labels exist
 * 4. Create task with appropriate project routing
 * 5. Update local task with Todoist task ID
 *
 * KEY DESIGN: Todoist is source of truth - we query structure each time
 * to adapt to user reorganizations without stale cache issues.
 */
export function createTodoistSyncProcessor(db: DbClient) {
  return async (job: Job<TodoistSyncJobData>) => {
    const { userId, taskId, classification } = job.data;

    console.log(`[TodoistSync] Syncing task ${taskId} for user ${userId}`);

    // 1. Get user with Todoist credentials
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (!user.todoistAccessToken) {
      console.log(`[TodoistSync] User ${userId} not connected to Todoist, skipping sync`);
      return { success: false, reason: 'not_connected' };
    }

    // 2. Get the local task
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 3. Get person details if applicable
    let personName: string | null = null;
    if (task.personId) {
      const person = await db.query.people.findFirst({
        where: eq(people.id, task.personId),
      });
      personName = person?.name ?? null;
    }

    // 4. Create in Todoist with dynamic routing
    try {
      const todoist = createTodoistClient(user.todoistAccessToken);

      // Discover current Todoist structure
      const structure = await discoverTodoistStructure(todoist);
      console.log(`[TodoistSync] Discovered ${structure.allProjects.length} projects, ${structure.labels.length} labels`);

      // Ensure GTD labels exist (idempotent)
      await ensureGTDLabels(todoist);

      // Create task with routing
      const todoistTaskId = await createTaskWithRouting(todoist, structure, {
        title: task.title,
        type: task.type,
        context: task.context,
        priority: task.priority,
        dueDate: task.dueDate,
        personName,
        notes: task.notes,
        targetProject: classification.targetProject ?? null,
      });

      console.log(`[TodoistSync] Created Todoist task: ${todoistTaskId}`);

      // 5. Update local task with Todoist reference
      await db
        .update(tasks)
        .set({
          todoistTaskId,
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
