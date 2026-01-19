/**
 * Tasks Lookup Tool
 * Query tasks from Notion (primary) or local DB (fallback)
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { tasks, people } from '@gtd/database';
import { eq, and, or, ilike, lte, gte, ne, desc, asc } from 'drizzle-orm';
import {
  TASK_TYPE_TO_NOTION,
  CONTEXT_TO_NOTION,
} from '@gtd/shared-types';

/**
 * Extract title from Notion page
 */
function extractTitle(page: any): string {
  try {
    const titleProperty = page.properties?.Task?.title;
    if (Array.isArray(titleProperty) && titleProperty.length > 0) {
      return titleProperty[0]?.plain_text ?? '';
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Extract type from Notion page
 */
function extractType(page: any): string {
  try {
    const type = page.properties?.Type?.select?.name;
    // Convert from Notion format to internal format
    const typeMap: Record<string, string> = {
      'Action': 'action',
      'Project': 'project',
      'Waiting': 'waiting',
      'Someday': 'someday',
      'Agenda': 'agenda',
    };
    return typeMap[type] ?? 'action';
  } catch {
    return 'action';
  }
}

/**
 * Extract status from Notion page
 */
function extractStatus(page: any): string {
  try {
    const status = page.properties?.Status?.select?.name ??
                   page.properties?.Status?.status?.name;
    const statusMap: Record<string, string> = {
      'To Do': 'pending',
      'In Progress': 'pending',
      'Done': 'completed',
      'Discussed': 'discussed',
    };
    return statusMap[status] ?? 'pending';
  } catch {
    return 'pending';
  }
}

/**
 * Extract due date from Notion page
 */
function extractDueDate(page: any): string | null {
  try {
    return page.properties?.Due?.date?.start ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract context from Notion page
 */
function extractContext(page: any): string | null {
  try {
    const context = page.properties?.Context?.select?.name;
    return context ? context.replace('@', '') : null;
  } catch {
    return null;
  }
}

/**
 * Extract priority from Notion page
 */
function extractPriority(page: any): string | null {
  try {
    const priority = page.properties?.Priority?.select?.name;
    const priorityMap: Record<string, string> = {
      '🔥 Today': 'today',
      '⚡ This week': 'this_week',
      '📋 Soon': 'soon',
    };
    return priorityMap[priority] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract person relation from Notion page
 */
function extractPersonId(page: any): string | null {
  try {
    const relation = page.properties?.Person?.relation;
    if (Array.isArray(relation) && relation.length > 0) {
      return relation[0]?.id ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export const lookupTasks: Tool = {
  name: 'lookup_tasks',
  description: 'Query tasks with filters. Searches Notion directly for real-time results. Use this to find tasks by type, status, context, person, due date, or search text.',
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
      // If Notion is configured, query Notion directly
      if (context.notionClient && context.notionTasksDatabaseId) {
        return await queryNotion(
          context,
          { search, type, status, context: taskContext, personId, personName, dueBefore, dueAfter, dueToday, limit }
        );
      }

      // Fall back to local DB
      return await queryLocalDB(
        context,
        { search, type, status, context: taskContext, personId, personName, dueBefore, dueAfter, dueToday, limit }
      );
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
 * Query tasks from Notion
 */
async function queryNotion(
  context: ToolContext,
  params: {
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
  }
): Promise<ToolResult> {
  const { search, type, status, context: taskContext, personId, personName, dueBefore, dueAfter, dueToday, limit = 20 } = params;

  // Build Notion filter
  const filterConditions: any[] = [];

  // Status filter
  if (status === 'active') {
    filterConditions.push({
      and: [
        { property: 'Status', select: { does_not_equal: 'Done' } },
        { property: 'Status', select: { does_not_equal: 'Discussed' } },
      ],
    });
  } else if (status === 'completed') {
    filterConditions.push({
      or: [
        { property: 'Status', select: { equals: 'Done' } },
        { property: 'Status', select: { equals: 'Discussed' } },
      ],
    });
  }

  // Type filter
  if (type) {
    const notionType = TASK_TYPE_TO_NOTION[type];
    if (notionType) {
      filterConditions.push({ property: 'Type', select: { equals: notionType } });
    }
  }

  // Context filter
  if (taskContext) {
    const notionContext = CONTEXT_TO_NOTION[taskContext];
    if (notionContext) {
      filterConditions.push({ property: 'Context', select: { equals: notionContext } });
    }
  }

  // Date filters
  if (dueToday) {
    const today = new Date().toISOString().split('T')[0]!;
    filterConditions.push({ property: 'Due', date: { equals: today } });
  } else {
    if (dueBefore) {
      filterConditions.push({ property: 'Due', date: { on_or_before: dueBefore } });
    }
    if (dueAfter) {
      filterConditions.push({ property: 'Due', date: { on_or_after: dueAfter } });
    }
  }

  // Person filter by ID (Notion page ID)
  if (personId && !personName) {
    // Look up person's Notion page ID from local DB
    const person = await context.db.query.people.findFirst({
      where: eq(people.id, personId),
    });
    if (person?.notionPageId) {
      filterConditions.push({ property: 'Person', relation: { contains: person.notionPageId } });
    }
  }

  // Build final filter
  const filter = filterConditions.length > 0
    ? filterConditions.length === 1
      ? filterConditions[0]
      : { and: filterConditions }
    : undefined;

  // Query Notion
  const response = await context.notionClient!.databases.query({
    database_id: context.notionTasksDatabaseId!,
    ...(filter && { filter }),
    sorts: [{ property: 'Due', direction: 'ascending' }],
    page_size: Math.min(limit * 2, 100), // Fetch more for client-side filtering
  });

  let results = response.results;

  // Client-side filtering for search and personName (Notion doesn't support full-text title search)
  if (search || personName) {
    const searchLower = search?.toLowerCase();
    const personNameLower = personName?.toLowerCase();

    results = results.filter((page: any) => {
      const title = extractTitle(page).toLowerCase();

      // If search specified, title must contain search term
      if (searchLower && !title.includes(searchLower)) {
        return false;
      }

      // If personName specified, title must contain person name
      if (personNameLower && !title.includes(personNameLower)) {
        return false;
      }

      return true;
    });
  }

  // Apply limit
  results = results.slice(0, limit);

  // Format results
  const formattedResults = results.map((page: any, index: number) => ({
    id: page.id,
    index: index + 1,
    title: extractTitle(page),
    type: extractType(page),
    status: extractStatus(page),
    context: extractContext(page),
    priority: extractPriority(page),
    dueDate: extractDueDate(page),
    personNotionId: extractPersonId(page),
    notionPageId: page.id,
    source: 'notion',
  }));

  return {
    success: true,
    data: {
      count: formattedResults.length,
      tasks: formattedResults,
      source: 'notion',
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
 * Query tasks from local DB (fallback)
 */
async function queryLocalDB(
  context: ToolContext,
  params: {
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
  }
): Promise<ToolResult> {
  const { search, type, status, context: taskContext, personId, personName, dueBefore, dueAfter, dueToday, limit = 20 } = params;

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
    notionPageId: t.notionPageId,
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
}

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

      // If Notion is configured, query Notion
      if (context.notionClient && context.notionTasksDatabaseId) {
        const filter = {
          and: [
            {
              or: [
                { property: 'Status', select: { does_not_equal: 'Done' } },
              ],
            },
            {
              or: [
                { property: 'Priority', select: { equals: '🔥 Today' } },
                includeOverdue
                  ? { property: 'Due', date: { on_or_before: todayStr } }
                  : { property: 'Due', date: { equals: todayStr } },
              ],
            },
          ],
        };

        const response = await context.notionClient.databases.query({
          database_id: context.notionTasksDatabaseId,
          filter,
          sorts: [{ property: 'Due', direction: 'ascending' }],
          page_size: 50,
        });

        const formattedResults = response.results.map((page: any, index: number) => ({
          id: page.id,
          index: index + 1,
          title: extractTitle(page),
          type: extractType(page),
          context: extractContext(page),
          priority: extractPriority(page),
          dueDate: extractDueDate(page),
          isOverdue: extractDueDate(page) ? extractDueDate(page)! < todayStr : false,
          source: 'notion',
        }));

        return {
          success: true,
          data: {
            count: formattedResults.length,
            today: todayStr,
            tasks: formattedResults,
            source: 'notion',
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

      // Fall back to local DB
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
