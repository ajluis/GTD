/**
 * Batch Operation Tools
 * Handle multiple tasks at once (brain dump, bulk complete, etc.)
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { tasks, users } from '@gtd/database';
import { eq, and, inArray } from 'drizzle-orm';

interface BatchTaskInput {
  title: string;
  type: string;
  context?: string;
  priority?: string;
  dueDate?: string;
  personName?: string;
  notes?: string;
}

/**
 * Create multiple tasks at once (brain dump)
 */
export const batchCreateTasks: Tool = {
  name: 'batch_create_tasks',
  description: 'Create multiple tasks at once from a brain dump or meeting notes. Each item is classified independently.',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        description: 'Array of tasks to create',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Task title' },
            type: {
              type: 'string',
              enum: ['action', 'project', 'waiting', 'someday', 'agenda'],
            },
            context: {
              type: 'string',
              enum: ['computer', 'phone', 'home', 'outside'],
            },
            priority: {
              type: 'string',
              enum: ['today', 'this_week', 'soon'],
            },
            dueDate: { type: 'string', format: 'date' },
            personName: { type: 'string' },
            notes: { type: 'string' },
          },
          required: ['title', 'type'],
        },
      },
    },
    required: ['tasks'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { tasks: taskInputs } = params as { tasks: BatchTaskInput[] };

    try {
      const createdTasks: Array<{
        id: string;
        title: string;
        type: string;
        personName?: string;
      }> = [];

      const errors: Array<{ title: string; error: string }> = [];

      // Process each task
      for (const input of taskInputs) {
        try {
          // Create task
          const [task] = await context.db
            .insert(tasks)
            .values({
              userId: context.userId,
              rawText: input.title,
              title: input.title,
              type: input.type as any,
              status: 'pending',
              context: (input.context as any) || null,
              priority: (input.priority as any) || null,
              dueDate: input.dueDate || null,
              personName: input.personName || null,
              notes: input.notes || null,
            })
            .returning();

          createdTasks.push({
            id: task!.id,
            title: task!.title,
            type: task!.type,
            personName: input.personName,
          });
        } catch (error) {
          errors.push({
            title: input.title,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      // Update user stats
      if (createdTasks.length > 0) {
        const user = await context.db.query.users.findFirst({
          where: eq(users.id, context.userId),
        });

        await context.db
          .update(users)
          .set({
            totalTasksCaptured: (user?.totalTasksCaptured ?? 0) + createdTasks.length,
            updatedAt: new Date(),
          })
          .where(eq(users.id, context.userId));
      }

      return {
        success: true,
        data: {
          created: createdTasks.length,
          failed: errors.length,
          tasks: createdTasks,
          errors: errors.length > 0 ? errors : undefined,
        },
        trackEntities: {
          tasks: createdTasks.map((t) => ({
            id: t.id,
            title: t.title,
            type: t.type as any,
          })),
          lastCreatedTaskId: createdTasks[createdTasks.length - 1]?.id,
        },
      };
    } catch (error) {
      console.error('[batch_create_tasks] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create tasks',
      };
    }
  },
};

/**
 * Complete multiple tasks at once
 */
export const batchCompleteTasks: Tool = {
  name: 'batch_complete_tasks',
  description: 'Complete multiple tasks at once. Useful for clearing all tasks in a context or for a person.',
  parameters: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        description: 'Array of task IDs to complete',
        items: { type: 'string' },
      },
    },
    required: ['taskIds'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { taskIds } = params as { taskIds: string[] };

    try {
      // Verify all tasks belong to user
      const userTasks = await context.db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, context.userId),
          inArray(tasks.id, taskIds)
        ),
      });

      if (userTasks.length !== taskIds.length) {
        return {
          success: false,
          error: 'Some tasks not found or not owned by user',
        };
      }

      // Complete all tasks
      const completedAt = new Date();
      await context.db
        .update(tasks)
        .set({
          status: 'completed',
          completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(eq(tasks.userId, context.userId), inArray(tasks.id, taskIds))
        );

      // Update user stats
      const user = await context.db.query.users.findFirst({
        where: eq(users.id, context.userId),
      });

      await context.db
        .update(users)
        .set({
          totalTasksCompleted: (user?.totalTasksCompleted ?? 0) + taskIds.length,
          updatedAt: new Date(),
        })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          completed: taskIds.length,
          taskIds,
          titles: userTasks.map((t: typeof userTasks[0]) => t.title),
        },
      };
    } catch (error) {
      console.error('[batch_complete_tasks] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete tasks',
      };
    }
  },
};

/**
 * Delete multiple tasks at once
 */
export const batchDeleteTasks: Tool = {
  name: 'batch_delete_tasks',
  description: 'Delete multiple tasks at once. Useful for cleaning up old items.',
  parameters: {
    type: 'object',
    properties: {
      taskIds: {
        type: 'array',
        description: 'Array of task IDs to delete',
        items: { type: 'string' },
      },
    },
    required: ['taskIds'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { taskIds } = params as { taskIds: string[] };

    try {
      // Get tasks before deletion for confirmation
      const userTasks = await context.db.query.tasks.findMany({
        where: and(
          eq(tasks.userId, context.userId),
          inArray(tasks.id, taskIds)
        ),
      });

      if (userTasks.length === 0) {
        return {
          success: false,
          error: 'No matching tasks found',
        };
      }

      // Delete tasks
      await context.db
        .delete(tasks)
        .where(
          and(eq(tasks.userId, context.userId), inArray(tasks.id, taskIds))
        );

      return {
        success: true,
        data: {
          deleted: userTasks.length,
          taskIds: userTasks.map((t: typeof userTasks[0]) => t.id),
          titles: userTasks.map((t: typeof userTasks[0]) => t.title),
        },
      };
    } catch (error) {
      console.error('[batch_delete_tasks] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete tasks',
      };
    }
  },
};
