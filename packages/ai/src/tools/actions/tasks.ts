/**
 * Task Action Tools
 * Create, update, complete, and delete tasks
 *
 * Tasks are stored locally AND synced to Todoist (if connected).
 * Todoist is the source of truth for task display.
 */

import type { Tool, ToolContext, ToolResult, StoredTaskData, TodoistClientLike } from '../types.js';
import { tasks, users } from '@gtd/database';
import { eq, and, ilike } from 'drizzle-orm';
import type { TodoistClient } from '@gtd/todoist';
import { discoverTodoistStructure, type TodoistStructure } from '@gtd/todoist';
import { createTaskWithRouting, updateTask as updateTodoistTask, completeTask as completeTodoistTask, deleteTask as deleteTodoistTask } from '@gtd/todoist';
import type { TaskType, TaskContext as GTDContext, TaskPriority } from '@gtd/shared-types';

/**
 * Generate search variations for fuzzy matching
 * "shopping" -> ["shopping", "shop"]
 * "running" -> ["running", "run"]
 * "clothes" -> ["clothes", "cloth"]
 */
function generateSearchVariations(searchText: string): string[] {
  const variations = [searchText];
  const words = searchText.split(/\s+/);

  for (const word of words) {
    // Strip common suffixes
    const suffixes = ['ing', 'ed', 'es', 's', 'er', 'ly', 'tion', 'ment'];
    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 2) {
        const root = word.slice(0, -suffix.length);
        if (!variations.includes(root)) {
          variations.push(root);
        }
        // Handle doubling (shopping -> shop, running -> run)
        if (root.length > 2 && root[root.length - 1] === root[root.length - 2]) {
          const shortened = root.slice(0, -1);
          if (!variations.includes(shortened)) {
            variations.push(shortened);
          }
        }
        break;
      }
    }
  }

  return variations;
}

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
      personName: {
        type: 'string',
        description: 'Person name for agenda/waiting items (extracted from message)',
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
      personName,
      notes,
    } = params as {
      title: string;
      type: string;
      context?: string;
      priority?: string;
      dueDate?: string;
      personName?: string;
      notes?: string;
    };

    try {
      // Sync to Todoist first (if connected)
      let todoistTaskId: string | null = null;
      if (context.todoistClient) {
        try {
          console.log('[create_task] Syncing to Todoist...');
          const structure = await discoverTodoistStructure(context.todoistClient as TodoistClient);
          todoistTaskId = await createTaskWithRouting(
            context.todoistClient as TodoistClient,
            structure,
            {
              title,
              type: type as TaskType,
              context: taskContext as GTDContext | undefined,
              priority: priority as TaskPriority | undefined,
              dueDate: dueDate || undefined,
              personName: personName || undefined,
              notes: notes || undefined,
            }
          );
          console.log('[create_task] Created in Todoist:', todoistTaskId);
        } catch (todoistError) {
          console.error('[create_task] Todoist sync failed:', todoistError);
          // Continue with local creation even if Todoist fails
        }
      }

      // Create the task locally
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
          personName: personName || null,
          notes: notes || null,
          todoistTaskId: todoistTaskId,
        })
        .returning();

      // Update user stats
      const currentUser = await context.db.query.users.findFirst({ where: eq(users.id, context.userId) });
      await context.db
        .update(users)
        .set({
          totalTasksCaptured: (currentUser?.totalTasksCaptured ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          taskId: task!.id,
          todoistTaskId,
          title: task!.title,
          type: task!.type,
          context: task!.context,
          priority: task!.priority,
          dueDate: task!.dueDate,
          personName: personName,
        },
        undoAction: {
          type: 'delete_created_task',
          taskId: task!.id,
          todoistTaskId: todoistTaskId || undefined,
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
  description: 'Update an existing task. Provide either taskId OR searchText to find the task. Use this to change title, type, context, priority, due date, or person.',
  parameters: {
    type: 'object',
    properties: {
      taskId: {
        type: 'string',
        description: 'Task ID (from lookup_tasks). If not provided, use searchText to find the task.',
      },
      searchText: {
        type: 'string',
        description: 'Text to search for in task titles (e.g., "shopping" will find "Go shopping"). Use this if you don\'t have the taskId.',
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
      personName: {
        type: 'string',
        description: 'New person name',
      },
      notes: {
        type: 'string',
        description: 'Notes to add or replace',
      },
    },
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { taskId, searchText, ...updates } = params as {
      taskId?: string;
      searchText?: string;
      title?: string;
      type?: string;
      context?: string;
      priority?: string;
      dueDate?: string;
      personName?: string;
      notes?: string;
    };

    try {
      let resolvedTaskId = taskId;

      // If no taskId but searchText provided, search for the task
      if (!resolvedTaskId && searchText) {
        // Generate search variations (e.g., "shopping" -> ["shopping", "shop"])
        const searchVariations = generateSearchVariations(searchText.toLowerCase());

        // Search local DB - try each variation
        for (const term of searchVariations) {
          const localTasks = await context.db.query.tasks.findMany({
            where: and(
              eq(tasks.userId, context.userId),
              ilike(tasks.title, `%${term}%`)
            ),
            limit: 1,
          });

          if (localTasks.length > 0) {
            resolvedTaskId = localTasks[0]!.id;
            break;
          }
        }
      }

      if (!resolvedTaskId) {
        return {
          success: false,
          error: searchText
            ? `No task found matching "${searchText}". Try being more specific or check your task list.`
            : 'Please provide either taskId or searchText to find the task.',
        };
      }

      // Get current task for undo
      const currentTask = await context.db.query.tasks.findFirst({
        where: and(eq(tasks.id, resolvedTaskId), eq(tasks.userId, context.userId)),
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

      if (updates['title'] !== undefined) {
        previousData.title = currentTask.title;
        updateData['title'] = updates['title'];
      }
      if (updates['type'] !== undefined) {
        previousData.type = currentTask.type as any;
        updateData['type'] = updates['type'];
      }
      if (updates['context'] !== undefined) {
        previousData.context = currentTask.context;
        updateData['context'] = updates['context'];
      }
      if (updates['priority'] !== undefined) {
        previousData.priority = currentTask.priority;
        updateData['priority'] = updates['priority'];
      }
      if (updates['dueDate'] !== undefined) {
        previousData.dueDate = currentTask.dueDate;
        updateData['dueDate'] = updates['dueDate'];
      }
      if (updates['personName'] !== undefined) {
        previousData.personName = currentTask.personName;
        updateData['personName'] = updates['personName'];
      }
      if (updates['notes'] !== undefined) {
        previousData.notes = currentTask.notes;
        updateData['notes'] = updates['notes'];
      }

      // Update the task locally
      const [updated] = await context.db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, resolvedTaskId))
        .returning();

      // Sync to Todoist if connected and task has a Todoist ID
      if (context.todoistClient && currentTask.todoistTaskId) {
        try {
          console.log('[update_task] Syncing to Todoist:', currentTask.todoistTaskId);
          const todoistUpdates: { content?: string; due_date?: string; priority?: 1 | 2 | 3 | 4 } = {};

          if (updates['title']) {
            todoistUpdates['content'] = updates['title'];
          }
          if (updates['dueDate']) {
            todoistUpdates['due_date'] = updates['dueDate'];
          }
          if (updates['priority']) {
            const priorityMap: Record<string, 1 | 2 | 3 | 4> = { today: 4, this_week: 3, soon: 2 };
            todoistUpdates['priority'] = priorityMap[updates['priority']] || 1;
          }

          if (Object.keys(todoistUpdates).length > 0) {
            await updateTodoistTask(
              context.todoistClient as TodoistClient,
              currentTask.todoistTaskId,
              todoistUpdates
            );
            console.log('[update_task] Synced to Todoist');
          }
        } catch (todoistError) {
          console.error('[update_task] Todoist sync failed:', todoistError);
          // Continue even if Todoist sync fails
        }
      }

      return {
        success: true,
        data: {
          taskId: updated!.id,
          todoistTaskId: currentTask.todoistTaskId,
          title: updated!.title,
          type: updated!.type,
          context: updated!.context,
          priority: updated!.priority,
          dueDate: updated!.dueDate,
          changes: Object.keys(updates).filter((k) => k !== 'taskId' && k !== 'searchText'),
        },
        undoAction: {
          type: 'revert_task_update',
          taskId: resolvedTaskId,
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

      // Sync to Todoist first (if connected and has Todoist ID)
      if (context.todoistClient && task.todoistTaskId) {
        try {
          console.log('[complete_task] Completing in Todoist:', task.todoistTaskId);
          await completeTodoistTask(context.todoistClient as TodoistClient, task.todoistTaskId);
          console.log('[complete_task] Completed in Todoist');
        } catch (todoistError) {
          console.error('[complete_task] Todoist sync failed:', todoistError);
          // Continue even if Todoist sync fails
        }
      }

      // Update task locally
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
      const userForStats = await context.db.query.users.findFirst({ where: eq(users.id, context.userId) });
      await context.db
        .update(users)
        .set({
          totalTasksCompleted: (userForStats?.totalTasksCompleted ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          taskId: updated!.id,
          todoistTaskId: task.todoistTaskId,
          title: updated!.title,
          type: updated!.type,
          status: updated!.status,
          completedAt: updated!.completedAt?.toISOString(),
        },
        undoAction: {
          type: 'uncomplete_task',
          taskId: taskId,
          todoistTaskId: task.todoistTaskId || undefined,
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
        personName: task.personName,
        notes: task.notes,
        todoistTaskId: task.todoistTaskId,
      };

      // Delete from Todoist first (if connected and has Todoist ID)
      if (context.todoistClient && task.todoistTaskId) {
        try {
          console.log('[delete_task] Deleting from Todoist:', task.todoistTaskId);
          await deleteTodoistTask(context.todoistClient as TodoistClient, task.todoistTaskId);
          console.log('[delete_task] Deleted from Todoist');
        } catch (todoistError) {
          console.error('[delete_task] Todoist sync failed:', todoistError);
          // Continue even if Todoist sync fails
        }
      }

      // Delete task locally
      await context.db.delete(tasks).where(eq(tasks.id, taskId));

      return {
        success: true,
        data: {
          taskId: task.id,
          todoistTaskId: task.todoistTaskId,
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
              personName: action.taskData.personName,
              notes: action.taskData.notes,
              todoistTaskId: action.taskData.todoistTaskId,
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
