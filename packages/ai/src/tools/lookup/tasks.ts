/**
 * Tasks Lookup Tool
 * Query tasks from Todoist (source of truth) or fallback to local DB
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { tasks } from '@gtd/database';
import { eq, and, or, ilike, lte, gte, ne, desc, asc } from 'drizzle-orm';

/**
 * Todoist task from REST API
 */
interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;
  labels: string[];
  priority: number;
  due?: {
    date: string;
    datetime?: string;
    string?: string;
    timezone?: string;
    is_recurring: boolean;
  };
  is_completed: boolean;
  created_at: string;
}

export const lookupTasks: Tool = {
  name: 'lookup_tasks',
  description: 'Query tasks from Todoist. Use this to find tasks by search text, due date filters, or labels.',
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
      personName,
      dueBefore,
      dueAfter,
      dueToday,
      limit = 20,
    } = params as {
      search?: string;
      personName?: string;
      dueBefore?: string;
      dueAfter?: string;
      dueToday?: boolean;
      limit?: number;
    };

    try {
      // If we have a Todoist client, query Todoist directly (source of truth)
      if (context.todoistClient) {
        return await queryTodoist(context.todoistClient, {
          search,
          personName,
          dueBefore,
          dueAfter,
          dueToday,
          limit,
        });
      }

      // Fallback to local DB (should not happen in production)
      console.warn('[lookup_tasks] No Todoist client, falling back to local DB');
      return await queryLocalDb(context, {
        search,
        personName,
        dueBefore,
        dueAfter,
        dueToday,
        limit,
      });
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
 * Query Todoist REST API directly
 */
async function queryTodoist(
  client: NonNullable<ToolContext['todoistClient']>,
  params: {
    search?: string;
    personName?: string;
    dueBefore?: string;
    dueAfter?: string;
    dueToday?: boolean;
    limit?: number;
  }
): Promise<ToolResult> {
  const { search, personName, dueBefore, dueAfter, dueToday, limit = 20 } = params;

  // Build Todoist filter query
  // Todoist filter syntax: https://todoist.com/help/articles/introduction-to-filters-V98wIH
  const filterParts: string[] = [];

  if (dueToday) {
    filterParts.push('today');
  } else if (dueBefore || dueAfter) {
    if (dueBefore) {
      filterParts.push(`due before: ${dueBefore}`);
    }
    if (dueAfter) {
      filterParts.push(`due after: ${dueAfter}`);
    }
  }

  // Search text - Todoist uses 'search:' filter
  if (search) {
    filterParts.push(`search: ${search}`);
  }

  // Person name in content
  if (personName) {
    filterParts.push(`search: ${personName}`);
  }

  // Query Todoist
  let todoistTasks: TodoistTask[];

  if (filterParts.length > 0) {
    // Use filter endpoint
    const filter = filterParts.join(' & ');
    todoistTasks = await client.get<TodoistTask[]>(`/tasks?filter=${encodeURIComponent(filter)}`);
  } else {
    // Get all active tasks
    todoistTasks = await client.get<TodoistTask[]>('/tasks');
  }

  // Limit results
  const limitedTasks = todoistTasks.slice(0, limit);

  // Format results
  const formattedResults = limitedTasks.map((t, index) => ({
    id: t.id,
    index: index + 1,
    title: t.content,
    labels: t.labels,
    priority: t.priority,
    dueDate: t.due?.date,
    dueString: t.due?.string,
    isCompleted: t.is_completed,
    projectId: t.project_id,
    source: 'todoist' as const,
  }));

  return {
    success: true,
    data: {
      count: formattedResults.length,
      tasks: formattedResults,
      source: 'todoist',
    },
    trackEntities: {
      tasks: formattedResults.map((t) => ({
        id: t.id,
        title: t.title,
        type: 'action' as const,
      })),
    },
  };
}

/**
 * Fallback: Query local database
 */
async function queryLocalDb(
  context: ToolContext,
  params: {
    search?: string;
    personName?: string;
    dueBefore?: string;
    dueAfter?: string;
    dueToday?: boolean;
    limit?: number;
  }
): Promise<ToolResult> {
  const { search, personName, dueBefore, dueAfter, dueToday, limit = 20 } = params;

  // Build filter conditions
  const conditions = [
    eq(tasks.userId, context.userId),
    ne(tasks.status, 'completed'),
  ];

  // Search filter
  if (search) {
    conditions.push(ilike(tasks.title, `%${search}%`));
  }

  // Person name in title
  if (personName) {
    conditions.push(ilike(tasks.title, `%${personName}%`));
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
    priority: t.priority,
    dueDate: t.dueDate,
    source: 'database' as const,
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
}

/**
 * Get tasks due today or soon
 */
export const lookupTodayTasks: Tool = {
  name: 'lookup_today_tasks',
  description: 'Get all tasks due today. Quick way to see what needs attention today.',
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
      // If we have a Todoist client, query Todoist directly
      if (context.todoistClient) {
        const filter = includeOverdue ? '(today | overdue)' : 'today';
        const todoistTasks = await context.todoistClient.get<TodoistTask[]>(
          `/tasks?filter=${encodeURIComponent(filter)}`
        );

        const todayStr = new Date().toISOString().split('T')[0]!;

        const formattedResults = todoistTasks.map((t, index) => ({
          id: t.id,
          index: index + 1,
          title: t.content,
          labels: t.labels,
          priority: t.priority,
          dueDate: t.due?.date,
          dueString: t.due?.string,
          isOverdue: t.due?.date ? t.due.date < todayStr : false,
          source: 'todoist' as const,
        }));

        return {
          success: true,
          data: {
            count: formattedResults.length,
            today: todayStr,
            tasks: formattedResults,
            source: 'todoist',
          },
          trackEntities: {
            tasks: formattedResults.map((t) => ({
              id: t.id,
              title: t.title,
              type: 'action' as const,
            })),
          },
        };
      }

      // Fallback to local DB
      console.warn('[lookup_today_tasks] No Todoist client, falling back to local DB');
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0]!;

      const conditions = [
        eq(tasks.userId, context.userId),
        ne(tasks.status, 'completed'),
      ];

      const dueTodayOrOverdue = includeOverdue
        ? lte(tasks.dueDate, todayStr)
        : eq(tasks.dueDate, todayStr);

      const results = await context.db.query.tasks.findMany({
        where: and(...conditions, dueTodayOrOverdue),
        orderBy: [asc(tasks.dueDate)],
        limit: 50,
      });

      const formattedResults = results.map((t: typeof results[0], index: number) => ({
        id: t.id,
        index: index + 1,
        title: t.title,
        priority: t.priority,
        dueDate: t.dueDate,
        isOverdue: t.dueDate && todayStr ? t.dueDate < todayStr : false,
        source: 'database' as const,
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
            type: 'action' as any,
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
