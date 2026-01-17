import type { Job } from 'bullmq';
import type { NotionSyncJobData } from '@gtd/queue';
import type { DbClient } from '@gtd/database';
import { users, tasks, people } from '@gtd/database';
import { eq } from 'drizzle-orm';
import { createNotionClient, createTask as createNotionTask } from '@gtd/notion';

/**
 * Notion Sync Processor
 *
 * Syncs local tasks to Notion:
 * 1. Get user's Notion credentials
 * 2. Create task in Notion
 * 3. Update local task with Notion page ID
 */
export function createNotionSyncProcessor(db: DbClient) {
  return async (job: Job<NotionSyncJobData>) => {
    const { userId, taskId, classification } = job.data;

    console.log(`[NotionSync] Syncing task ${taskId} for user ${userId}`);

    // 1. Get user with Notion credentials
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
      console.log(`[NotionSync] User ${userId} not connected to Notion, skipping sync`);
      return { success: false, reason: 'not_connected' };
    }

    // 2. Get the local task
    const task = await db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
    });

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // 3. Get person's Notion page ID if applicable
    let personNotionPageId: string | null = null;
    if (task.personId) {
      const person = await db.query.people.findFirst({
        where: eq(people.id, task.personId),
      });
      personNotionPageId = person?.notionPageId ?? null;
    }

    // 4. Create in Notion
    try {
      const notion = createNotionClient(user.notionAccessToken);

      const notionPageId = await createNotionTask(
        notion,
        user.notionTasksDatabaseId,
        {
          title: task.title,
          type: task.type,
          context: task.context,
          priority: task.priority,
          dueDate: task.dueDate,
          personPageId: personNotionPageId,
          notes: task.notes,
        }
      );

      console.log(`[NotionSync] Created Notion page: ${notionPageId}`);

      // 5. Update local task with Notion reference
      await db
        .update(tasks)
        .set({
          notionPageId,
          status: 'synced',
          syncedAt: new Date(),
          lastSyncError: null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));

      return { success: true, notionPageId };
    } catch (error) {
      // Log error and mark task as failed
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      console.error(`[NotionSync] Failed to sync task ${taskId}:`, error);

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
