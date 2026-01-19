/**
 * Task Action Tools
 * Create, update, complete, and delete tasks
 */

import type { Tool, ToolContext, ToolResult, StoredTaskData } from '../types.js';
import { tasks, users, people } from '@gtd/database';
import { eq, and, ilike } from 'drizzle-orm';

/**
 * Create a new task
 */
export const createTask: Tool = {
  name: 'create_task',
  description: 'Create a new task. Use this when capturing a new action, project, waiting item, someday item, or agenda topic.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Clean task title (start with verb for actions)',
      },
      type: {
        type: 'string',
        description: 'GTD task type',
        enum: ['action', 'project', 'waiting', 'someday', 'agenda'],
      },
      context: {
        type: 'string',
        description: 'GTD context for actions',
        enum: ['computer', 'phone', 'home', 'outside'],
      },
      priority: {
        type: 'string',
        description: 'Priority level',
        enum: ['today', 'this_week', 'soon'],
      },
      dueDate: {
        type: 'string',
        description: 'Due date in ISO format (YYYY-MM-DD)',
        format: 'date',
      },
      personId: {
        type: 'string',
        description: 'Person ID for agenda/waiting items (from lookup_people)',
      },
      personName: {
        type: 'string',
        description: 'Person name if ID not known (will be resolved or created)',
      },
      notes: {
        type: 'string',
        description: 'Additional notes or context',
      },
    },
    required: ['title', 'type'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const {
      title,
      type,
      context: taskContext,
      priority,
      dueDate,
      personId,
      personName,
      notes,
    } = params as {
      title: string;
      type: string;
      context?: string;
      priority?: string;
      dueDate?: string;
      personId?: string;
      personName?: string;
      notes?: string;
    };

    try {
      // Resolve person if name provided but not ID
      let resolvedPersonId = personId || null;
      let resolvedPersonName = personName;

      if (!resolvedPersonId && personName) {
        // Try to find existing person
        const existingPeople = await context.db.query.people.findMany({
          where: eq(people.userId, context.userId),
        });

        const match = existingPeople.find(
          (p) =>
            p.name.toLowerCase() === personName.toLowerCase() ||
            p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
        );

        if (match) {
          resolvedPersonId = match.id;
          resolvedPersonName = match.name;
        } else if (type === 'agenda' || type === 'waiting') {
          // Auto-create person for agenda/waiting items
          const [newPerson] = await context.db
            .insert(people)
            .values({
              userId: context.userId,
              name: personName,
              active: true,
            })
            .returning();

          if (newPerson) {
            resolvedPersonId = newPerson.id;
            resolvedPersonName = newPerson.name;
          }
        }
      }

      // Create the task
      const [task] = await context.db
        .insert(tasks)
        .values({
          userId: context.userId,
          rawText: title,
          title,
          type: type as any,
          status: 'pending',
          context: taskContext as any || null,
          priority: priority as any || null,
          dueDate: dueDate || null,
          personId: resolvedPersonId,
          notes: notes || null,
        })
        .returning();

      // Update user stats
      await context.db
        .update(users)
        .set({
          totalTasksCaptured: await context.db.query.users
            .findFirst({ where: eq(users.id, context.userId) })
            .then((u) => (u?.totalTasksCaptured ?? 0) + 1),
          updatedAt: new Date(),
        })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          taskId: task!.id,
          title: task!.title,
          type: task!.type,
          context: task!.context,
          priority: task!.priority,
          dueDate: task!.dueDate,
          personId: resolvedPersonId,
          personName: resolvedPersonName,
        },
        undoAction: {
          type: 'delete_created_task',
          taskId: task!.id,
        },
        trackEntities: {
          lastCreatedTaskId: task!.id,
          tasks: [{ id: task!.id, title: task!.title, type: task!.type as any }],
        },
      };
    } catch (error) {
      console.error('[create_task] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create task',
      };
    }
  },
};

/**
 * Update an existing task
 */
export const updateTask: Tool = {
  name: 'update_task',
  description: 'Update an existing task. Use this to change title, type, context, priority, due date, or person.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID (from lookup_tasks)',
      },
      title: {
        type: 'string',
        description: 'New title',
      },
      type: {
        type: 'string',
        description: 'New task type',
        enum: ['action', 'project', 'waiting', 'someday', 'agenda'],
      },
      context: {
        type: 'string',
        description: 'New context',
        enum: ['computer', 'phone', 'home', 'outside'],
      },
      priority: {
        type: 'string',
        description: 'New priority',
        enum: ['today', 'this_week', 'soon'],
      },
      dueDate: {
        type: 'string',
        description: 'New due date (YYYY-MM-DD)',
        format: 'date',
      },
      personId: {
        type: 'string',
        description: 'New person ID',
      },
      notes: {
        type: 'string',
        description: 'Notes to add or replace',
      },
    },
    required: ['taskId'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { taskId, ...updates } = params as {
      taskId: string;
      title?: string;
      type?: string;
      context?: string;
      priority?: string;
      dueDate?: string;
      personId?: string;
      notes?: string;
    };

    try {
      // Get current task for undo
      const currentTask = await context.db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, context.userId)),
      });

      if (!currentTask) {
        return {
          success: false,
          error: 'Task not found',
        };
      }

      // Build update object
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      const previousData: Partial<StoredTaskData> = {};

      if (updates.title !== undefined) {
        previousData.title = currentTask.title;
        updateData.title = updates.title;
      }
      if (updates.type !== undefined) {
        previousData.type = currentTask.type as any;
        updateData.type = updates.type;
      }
      if (updates.context !== undefined) {
        previousData.context = currentTask.context;
        updateData.context = updates.context;
      }
      if (updates.priority !== undefined) {
        previousData.priority = currentTask.priority;
        updateData.priority = updates.priority;
      }
      if (updates.dueDate !== undefined) {
        previousData.dueDate = currentTask.dueDate;
        updateData.dueDate = updates.dueDate;
      }
      if (updates.personId !== undefined) {
        previousData.personId = currentTask.personId;
        updateData.personId = updates.personId;
      }
      if (updates.notes !== undefined) {
        previousData.notes = currentTask.notes;
        updateData.notes = updates.notes;
      }

      // Update the task
      const [updated] = await context.db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, taskId))
        .returning();

      return {
        success: true,
        data: {
          taskId: updated!.id,
          title: updated!.title,
          type: updated!.type,
          context: updated!.context,
          priority: updated!.priority,
          dueDate: updated!.dueDate,
          changes: Object.keys(updates).filter((k) => k !== 'taskId'),
        },
        undoAction: {
          type: 'revert_task_update',
          taskId: taskId,
          previousData,
        },
      };
    } catch (error) {
      console.error('[update_task] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update task',
      };
    }
  },
};

/**
 * Complete a task
 */
export const completeTask: Tool = {
  name: 'complete_task',
  description: 'Mark a task as complete. For agenda items, marks as "discussed".',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID to complete (from lookup_tasks)',
      },
    },
    required: ['taskId'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { taskId } = params as { taskId: string };

    try {
      // Get task
      const task = await context.db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, context.userId)),
      });

      if (!task) {
        return {
          success: false,
          error: 'Task not found',
        };
      }

      // Determine new status
      const newStatus = task.type === 'agenda' ? 'discussed' : 'completed';

      // Update task
      const [updated] = await context.db
        .update(tasks)
        .set({
          status: newStatus,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId))
        .returning();

      // Update user stats
      await context.db
        .update(users)
        .set({
          totalTasksCompleted: await context.db.query.users
            .findFirst({ where: eq(users.id, context.userId) })
            .then((u) => (u?.totalTasksCompleted ?? 0) + 1),
          updatedAt: new Date(),
        })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          taskId: updated!.id,
          title: updated!.title,
          type: updated!.type,
          status: updated!.status,
          completedAt: updated!.completedAt?.toISOString(),
        },
        undoAction: {
          type: 'uncomplete_task',
          taskId: taskId,
          notionPageId: task.notionPageId || undefined,
        },
      };
    } catch (error) {
      console.error('[complete_task] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete task',
      };
    }
  },
};

/**
 * Delete a task
 */
export const deleteTask: Tool = {
  name: 'delete_task',
  description: 'Delete a task permanently.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID to delete (from lookup_tasks)',
      },
    },
    required: ['taskId'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { taskId } = params as { taskId: string };

    try {
      // Get task for undo
      const task = await context.db.query.tasks.findFirst({
        where: and(eq(tasks.id, taskId), eq(tasks.userId, context.userId)),
      });

      if (!task) {
        return {
          success: false,
          error: 'Task not found',
        };
      }

      // Store task data for undo
      const taskData: StoredTaskData = {
        id: task.id,
        title: task.title,
        type: task.type as any,
        rawText: task.rawText,
        context: task.context,
        priority: task.priority,
        dueDate: task.dueDate,
        personId: task.personId,
        notes: task.notes,
        notionPageId: task.notionPageId,
      };

      // Delete task
      await context.db.delete(tasks).where(eq(tasks.id, taskId));

      return {
        success: true,
        data: {
          taskId: task.id,
          title: task.title,
          deleted: true,
        },
        undoAction: {
          type: 'restore_deleted_task',
          taskData,
        },
      };
    } catch (error) {
      console.error('[delete_task] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete task',
      };
    }
  },
};

/**
 * Undo the last action
 */
export const undoLastAction: Tool = {
  name: 'undo_last_action',
  description: 'Undo the most recent action (create, update, complete, or delete).',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    try {
      const undoStack = context.conversationContext.undoStack;

      if (undoStack.length === 0) {
        return {
          success: false,
          error: 'Nothing to undo',
        };
      }

      const action = undoStack[0]!;

      switch (action.type) {
        case 'delete_created_task': {
          // Delete the task that was just created
          await context.db.delete(tasks).where(eq(tasks.id, action.taskId));
          return {
            success: true,
            data: { undone: 'task_creation', taskId: action.taskId },
          };
        }

        case 'restore_deleted_task': {
          // Restore the deleted task
          const [restored] = await context.db
            .insert(tasks)
            .values({
              id: action.taskData.id,
              userId: context.userId,
              rawText: action.taskData.rawText,
              title: action.taskData.title,
              type: action.taskData.type as any,
              status: 'pending',
              context: action.taskData.context as any,
              priority: action.taskData.priority as any,
              dueDate: action.taskData.dueDate,
              personId: action.taskData.personId,
              notes: action.taskData.notes,
              notionPageId: action.taskData.notionPageId,
            })
            .returning();
          return {
            success: true,
            data: { undone: 'task_deletion', task: restored },
          };
        }

        case 'revert_task_update': {
          // Revert the task to previous state
          await context.db
            .update(tasks)
            .set({ ...action.previousData, updatedAt: new Date() })
            .where(eq(tasks.id, action.taskId));
          return {
            success: true,
            data: { undone: 'task_update', taskId: action.taskId },
          };
        }

        case 'uncomplete_task': {
          // Mark task as not complete
          await context.db
            .update(tasks)
            .set({
              status: 'pending',
              completedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, action.taskId));
          return {
            success: true,
            data: { undone: 'task_completion', taskId: action.taskId },
          };
        }

        default:
          return {
            success: false,
            error: 'Unknown undo action type',
          };
      }
    } catch (error) {
      console.error('[undo_last_action] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to undo',
      };
    }
  },
};
