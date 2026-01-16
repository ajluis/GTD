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
      status: { name: 'To Do' },
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
        status: { name: 'Done' },
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
        status: { name: 'Discussed' },
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
          { property: 'Status', status: { does_not_equal: 'Done' } },
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
      { property: 'Status', status: { does_not_equal: 'Done' } },
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
      { property: 'Status', status: { equals: 'To Do' } },
      { property: 'Person', relation: { contains: personPageId } },
    ],
  });
}
