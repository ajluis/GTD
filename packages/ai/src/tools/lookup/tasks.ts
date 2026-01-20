/**
 * Tasks Lookup Tool
 * Query tasks from local DB (synced with Todoist)
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { tasks, people } from '@gtd/database';
import { eq, and, or, ilike, lte, gte, ne, desc, asc } from 'drizzle-orm';

export const lookupTasks: Tool = {
  name: 'lookup_tasks',
  description: 'Query tasks with filters. Searches the local database (synced with Todoist) for real-time results. Use this to find tasks by type, status, context, person, due date, or search text.',
  parameters: {
    type: 'object',
    properties: {
      search: {
        type: 'string',
        description: 'Text to search for in task titles',
      },
      type: {
        type: 'string',
        description: 'Filter by task type',
        enum: ['action', 'project', 'waiting', 'someday', 'agenda'],
      },
      status: {
        type: 'string',
        description: 'Filter by status (active = not completed, completed = done)',
        enum: ['active', 'completed', 'all'],
      },
      context: {
        type: 'string',
        description: 'Filter by GTD context',
        enum: ['computer', 'phone', 'home', 'outside'],
      },
      personId: {
        type: 'string',
        description: 'Filter by person ID (UUID from lookup_people). Use personName instead if you only have the name.',
      },
      personName: {
        type: 'string',
        description: 'Filter by person name (will search both linked tasks AND tasks with the name in title).',
      },
      dueBefore: {
        type: 'string',
        description: 'Tasks due before this date (ISO format YYYY-MM-DD)',
        format: 'date',
      },
      dueAfter: {
        type: 'string',
        description: 'Tasks due after this date (ISO format YYYY-MM-DD)',
        format: 'date',
      },
      dueToday: {
        type: 'boolean',
        description: 'Filter for tasks due today',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default 20)',
        default: 20,
      },
    },
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const {
      search,
      type,
      status = 'active',
      context: taskContext,
      personId,
      personName,
      dueBefore,
      dueAfter,
      dueToday,
      limit = 20,
    } = params as {
      search?: string;
      type?: string;
      status?: string;
      context?: string;
      personId?: string;
      personName?: string;
      dueBefore?: string;
      dueAfter?: string;
      dueToday?: boolean;
      limit?: number;
    };

    try {
      // Resolve personName to personId if provided
      let resolvedPersonId = personId;
      let personNameForTitleSearch: string | undefined;

      if (!resolvedPersonId && personName) {
        personNameForTitleSearch = personName;

        const userPeople = await context.db.query.people.findMany({
          where: eq(people.userId, context.userId),
        });
        const match = userPeople.find(
          (p: typeof userPeople[0]) =>
            p.name.toLowerCase() === personName.toLowerCase() ||
            p.aliases?.some((a: string) => a.toLowerCase() === personName.toLowerCase())
        );
        if (match) {
          resolvedPersonId = match.id;
        }
      }

      // Build filter conditions
      const conditions = [eq(tasks.userId, context.userId)];

      // Status filter
      if (status === 'active') {
        conditions.push(
          and(
            ne(tasks.status, 'completed'),
            ne(tasks.status, 'discussed')
          )!
        );
      } else if (status === 'completed') {
        conditions.push(
          or(
            eq(tasks.status, 'completed'),
            eq(tasks.status, 'discussed')
          )!
        );
      }

      // Type filter
      if (type) {
        conditions.push(eq(tasks.type, type as any));
      }

      // Context filter
      if (taskContext) {
        conditions.push(eq(tasks.context, taskContext as any));
      }

      // Person filter
      if (resolvedPersonId && personNameForTitleSearch) {
        conditions.push(
          or(
            eq(tasks.personId, resolvedPersonId),
            ilike(tasks.title, `%${personNameForTitleSearch}%`)
          )!
        );
      } else if (resolvedPersonId) {
        conditions.push(eq(tasks.personId, resolvedPersonId));
      } else if (personNameForTitleSearch) {
        conditions.push(ilike(tasks.title, `%${personNameForTitleSearch}%`));
      }

      // Search filter
      if (search) {
        conditions.push(ilike(tasks.title, `%${search}%`));
      }

      // Date filters
      if (dueToday) {
        const todayStr = new Date().toISOString().split('T')[0]!;
        conditions.push(eq(tasks.dueDate, todayStr));
      } else {
        if (dueBefore) {
          conditions.push(lte(tasks.dueDate, dueBefore));
        }
        if (dueAfter) {
          conditions.push(gte(tasks.dueDate, dueAfter));
        }
      }

      // Execute query
      const results = await context.db.query.tasks.findMany({
        where: and(...conditions),
        orderBy: [asc(tasks.dueDate), desc(tasks.createdAt)],
        limit: limit,
      });

      const formattedResults = results.map((t: typeof results[0], index: number) => ({
        id: t.id,
        index: index + 1,
        title: t.title,
        type: t.type,
        status: t.status,
        context: t.context,
        priority: t.priority,
        dueDate: t.dueDate,
        personId: t.personId,
        todoistTaskId: t.todoistTaskId,
        source: 'database',
      }));

      return {
        success: true,
        data: {
          count: formattedResults.length,
          tasks: formattedResults,
          source: 'database',
        },
        trackEntities: {
          tasks: formattedResults.map((t: typeof formattedResults[0]) => ({
            id: t.id,
            title: t.title,
            type: t.type as any,
          })),
        },
      };
    } catch (error) {
      console.error('[lookup_tasks] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to lookup tasks',
      };
    }
  },
};

/**
 * Get tasks due today or soon
 */
export const lookupTodayTasks: Tool = {
  name: 'lookup_today_tasks',
  description: 'Get all tasks due today or marked as high priority. Quick way to see what needs attention today.',
  parameters: {
    type: 'object',
    properties: {
      includeOverdue: {
        type: 'boolean',
        description: 'Include overdue tasks (default true)',
        default: true,
      },
    },
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { includeOverdue = true } = params as { includeOverdue?: boolean };

    try {
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0]!;

      // Query local DB
      const conditions = [
        eq(tasks.userId, context.userId),
        ne(tasks.status, 'completed'),
        ne(tasks.status, 'discussed'),
      ];

      const dueTodayOrOverdue = includeOverdue
        ? lte(tasks.dueDate, todayStr)
        : eq(tasks.dueDate, todayStr);

      const results = await context.db.query.tasks.findMany({
        where: and(
          ...conditions,
          or(
            dueTodayOrOverdue,
            eq(tasks.priority, 'today')
          )
        ),
        orderBy: [asc(tasks.dueDate), desc(tasks.priority)],
        limit: 50,
      });

      const formattedResults = results.map((t: typeof results[0], index: number) => ({
        id: t.id,
        index: index + 1,
        title: t.title,
        type: t.type,
        context: t.context,
        priority: t.priority,
        dueDate: t.dueDate,
        isOverdue: t.dueDate && todayStr ? t.dueDate < todayStr : false,
        todoistTaskId: t.todoistTaskId,
        source: 'database',
      }));

      return {
        success: true,
        data: {
          count: formattedResults.length,
          today: todayStr,
          tasks: formattedResults,
          source: 'database',
        },
        trackEntities: {
          tasks: formattedResults.map((t: typeof formattedResults[0]) => ({
            id: t.id,
            title: t.title,
            type: t.type as any,
          })),
        },
      };
    } catch (error) {
      console.error('[lookup_today_tasks] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to lookup today tasks',
      };
    }
  },
};
