import type { Client } from '@notionhq/client';
import {
  TASK_TYPE_TO_NOTION,
  CONTEXT_TO_NOTION,
  PRIORITY_TO_NOTION,
} from '@clarity/shared-types';
import type { TaskType, TaskContext, TaskPriority } from '@clarity/shared-types';

/**
 * Task data for creating in Notion
 */
export interface CreateTaskData {
  title: string;
  type: TaskType;
  context?: TaskContext | null;
  priority?: TaskPriority | null;
  dueDate?: string | null;
  personPageId?: string | null;
  notes?: string | null;
}

/**
 * Create a task in Notion
 *
 * @param notion - Authenticated Notion client
 * @param databaseId - Tasks database ID
 * @param data - Task data
 * @returns Notion page ID
 */
export async function createTask(
  notion: Client,
  databaseId: string,
  data: CreateTaskData
): Promise<string> {
  const properties: Record<string, any> = {
    Task: {
      title: [{ text: { content: data.title } }],
    },
    Type: {
      select: { name: TASK_TYPE_TO_NOTION[data.type] ?? 'Action' },
    },
    Status: {
      select: { name: 'To Do' },
    },
    Created: {
      date: { start: new Date().toISOString().split('T')[0] },
    },
  };

  // Add optional properties
  if (data.context) {
    properties['Context'] = {
      select: { name: CONTEXT_TO_NOTION[data.context] },
    };
  }

  if (data.priority) {
    properties['Priority'] = {
      select: { name: PRIORITY_TO_NOTION[data.priority] },
    };
  }

  if (data.dueDate) {
    properties['Due'] = {
      date: { start: data.dueDate },
    };
  }

  if (data.personPageId) {
    properties['Person'] = {
      relation: [{ id: data.personPageId }],
    };
  }

  if (data.notes) {
    properties['Notes'] = {
      rich_text: [{ text: { content: data.notes } }],
    };
  }

  const page = await notion.pages.create({
    parent: { database_id: databaseId },
    properties,
  });

  return page.id;
}

/**
 * Mark a task as complete
 *
 * @param notion - Authenticated Notion client
 * @param pageId - Task's Notion page ID
 */
export async function completeTask(
  notion: Client,
  pageId: string
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        select: { name: 'Done' },
      },
      Completed: {
        date: { start: new Date().toISOString().split('T')[0] },
      },
    } as any,
  });
}

/**
 * Mark an agenda item as discussed
 *
 * @param notion - Authenticated Notion client
 * @param pageId - Task's Notion page ID
 */
export async function markDiscussed(
  notion: Client,
  pageId: string
): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      Status: {
        select: { name: 'Discussed' },
      },
    } as any,
  });
}

/**
 * Query tasks from Notion
 *
 * @param notion - Authenticated Notion client
 * @param databaseId - Tasks database ID
 * @param filter - Optional Notion filter
 * @returns Array of task pages
 */
export async function queryTasks(
  notion: Client,
  databaseId: string,
  filter?: any
): Promise<any[]> {
  const response = await notion.databases.query({
    database_id: databaseId,
    ...(filter && { filter }),
    sorts: [{ property: 'Due', direction: 'ascending' }],
  });

  return response.results;
}

/**
 * Query tasks due today
 */
export async function queryTasksDueToday(
  notion: Client,
  databaseId: string
): Promise<any[]> {
  const today = new Date().toISOString().split('T')[0];

  return queryTasks(notion, databaseId, {
    or: [
      {
        property: 'Priority',
        select: { equals: '🔥 Today' },
      },
      {
        and: [
          { property: 'Due', date: { on_or_before: today } },
          { property: 'Status', select: { does_not_equal: 'Done' } },
        ],
      },
    ],
  });
}

/**
 * Query active actions (not done)
 */
export async function queryActiveActions(
  notion: Client,
  databaseId: string
): Promise<any[]> {
  return queryTasks(notion, databaseId, {
    and: [
      { property: 'Type', select: { equals: 'Action' } },
      { property: 'Status', select: { does_not_equal: 'Done' } },
    ],
  });
}

/**
 * Query pending agenda items for a person
 */
export async function queryAgendaForPerson(
  notion: Client,
  databaseId: string,
  personPageId: string
): Promise<any[]> {
  return queryTasks(notion, databaseId, {
    and: [
      { property: 'Type', select: { equals: 'Agenda' } },
      { property: 'Status', select: { equals: 'To Do' } },
      { property: 'Person', relation: { contains: personPageId } },
    ],
  });
}

/**
 * Query active projects (not done)
 */
export async function queryActiveProjects(
  notion: Client,
  databaseId: string
): Promise<any[]> {
  return queryTasks(notion, databaseId, {
    and: [
      { property: 'Type', select: { equals: 'Project' } },
      { property: 'Status', select: { does_not_equal: 'Done' } },
    ],
  });
}

/**
 * Query waiting tasks (not done)
 */
export async function queryWaitingTasks(
  notion: Client,
  databaseId: string
): Promise<any[]> {
  return queryTasks(notion, databaseId, {
    and: [
      { property: 'Type', select: { equals: 'Waiting' } },
      { property: 'Status', select: { does_not_equal: 'Done' } },
    ],
  });
}

/**
 * Query someday tasks
 */
export async function querySomedayTasks(
  notion: Client,
  databaseId: string
): Promise<any[]> {
  return queryTasks(notion, databaseId, {
    property: 'Type',
    select: { equals: 'Someday' },
  });
}

/**
 * Query tasks by context
 */
export async function queryTasksByContext(
  notion: Client,
  databaseId: string,
  context: string
): Promise<any[]> {
  // Map internal context to Notion format
  const notionContext = `@${context}`;

  return queryTasks(notion, databaseId, {
    and: [
      { property: 'Context', select: { equals: notionContext } },
      { property: 'Status', select: { does_not_equal: 'Done' } },
    ],
  });
}

/**
 * Find tasks by text search (for "done [text]" command)
 * Searches title for matching text
 */
export async function findTaskByText(
  notion: Client,
  databaseId: string,
  searchText: string
): Promise<any[]> {
  // Query all non-done tasks and filter locally
  // Notion API doesn't support full-text search on title
  const tasks = await queryTasks(notion, databaseId, {
    property: 'Status',
    select: { does_not_equal: 'Done' },
  });

  // Filter by text match (case-insensitive)
  const searchLower = searchText.toLowerCase();
  return tasks.filter((task) => {
    const title = extractTaskTitle(task);
    return title.toLowerCase().includes(searchLower);
  });
}

/**
 * Extract title from a Notion task page
 */
export function extractTaskTitle(page: any): string {
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
 * Extract due date from a Notion task page
 */
export function extractTaskDueDate(page: any): string | null {
  try {
    return page.properties?.Due?.date?.start ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract context from a Notion task page
 */
export function extractTaskContext(page: any): string | null {
  try {
    const context = page.properties?.Context?.select?.name;
    return context ? context.replace('@', '') : null;
  } catch {
    return null;
  }
}

/**
 * Extract priority from a Notion task page
 */
export function extractTaskPriority(page: any): string | null {
  try {
    return page.properties?.Priority?.select?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a task was due today
 */
export function isTaskDueToday(page: any): boolean {
  const dueDate = extractTaskDueDate(page);
  if (!dueDate) return false;

  const today = new Date().toISOString().split('T')[0];
  return dueDate === today;
}
