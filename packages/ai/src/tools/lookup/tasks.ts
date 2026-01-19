/**
 * Tasks Lookup Tool
 * Query tasks with various filters
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { tasks } from '@gtd/database';
import { eq, and, or, ilike, lte, gte, ne, desc, asc, isNull, isNotNull } from 'drizzle-orm';

export const lookupTasks: Tool = {
  name: 'lookup_tasks',
  description: 'Query tasks with filters. Use this to find tasks by type, status, context, person, due date, or search text. Returns task details including IDs needed for other operations.',
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
        description: 'Filter by person ID (from lookup_people)',
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
      createdAfter: {
        type: 'string',
        description: 'Tasks created after this date (ISO format)',
        format: 'date',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default 20)',
        default: 20,
      },
      orderBy: {
        type: 'string',
        description: 'Sort order',
        enum: ['due_date', 'created_at', 'title'],
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
      dueBefore,
      dueAfter,
      dueToday,
      createdAfter,
      limit = 20,
      orderBy = 'due_date',
    } = params as {
      search?: string;
      type?: string;
      status?: string;
      context?: string;
      personId?: string;
      dueBefore?: string;
      dueAfter?: string;
      dueToday?: boolean;
      createdAfter?: string;
      limit?: number;
      orderBy?: string;
    };

    try {
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
      if (personId) {
        conditions.push(eq(tasks.personId, personId));
      }

      // Search filter
      if (search) {
        conditions.push(ilike(tasks.title, `%${search}%`));
      }

      // Date filters
      if (dueToday) {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        conditions.push(eq(tasks.dueDate, todayStr));
      } else {
        if (dueBefore) {
          conditions.push(lte(tasks.dueDate, dueBefore));
        }
        if (dueAfter) {
          conditions.push(gte(tasks.dueDate, dueAfter));
        }
      }

      if (createdAfter) {
        conditions.push(gte(tasks.createdAt, new Date(createdAfter)));
      }

      // Determine sort order
      let orderClause;
      switch (orderBy) {
        case 'due_date':
          orderClause = [asc(tasks.dueDate), desc(tasks.createdAt)];
          break;
        case 'title':
          orderClause = [asc(tasks.title)];
          break;
        case 'created_at':
        default:
          orderClause = [desc(tasks.createdAt)];
      }

      // Execute query
      const results = await context.db.query.tasks.findMany({
        where: and(...conditions),
        orderBy: orderClause,
        limit: limit,
        with: {
          // Include person info if available
        },
      });

      const formattedResults = results.map((t, index) => ({
        id: t.id,
        index: index + 1, // 1-based for "the first one"
        title: t.title,
        type: t.type,
        status: t.status,
        context: t.context,
        priority: t.priority,
        dueDate: t.dueDate,
        personId: t.personId,
        notionPageId: t.notionPageId,
        createdAt: t.createdAt.toISOString(),
      }));

      return {
        success: true,
        data: {
          count: formattedResults.length,
          tasks: formattedResults,
        },
        trackEntities: {
          tasks: formattedResults.map((t) => ({
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
      const todayStr = today.toISOString().split('T')[0];

      const conditions = [
        eq(tasks.userId, context.userId),
        ne(tasks.status, 'completed'),
        ne(tasks.status, 'discussed'),
      ];

      // Due today, or overdue, or priority=today
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

      const formattedResults = results.map((t, index) => ({
        id: t.id,
        index: index + 1,
        title: t.title,
        type: t.type,
        context: t.context,
        priority: t.priority,
        dueDate: t.dueDate,
        isOverdue: t.dueDate ? t.dueDate < todayStr : false,
      }));

      return {
        success: true,
        data: {
          count: formattedResults.length,
          today: todayStr,
          tasks: formattedResults,
        },
        trackEntities: {
          tasks: formattedResults.map((t) => ({
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
