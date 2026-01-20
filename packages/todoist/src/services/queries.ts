/**
 * Todoist Query Service
 *
 * Provides GTD query operations using Todoist's filter syntax.
 * These support common GTD workflows like:
 * - Context-based lists (@computer, @phone, etc.)
 * - Waiting-for tracking
 * - Today/upcoming views
 * - Person-specific agendas
 *
 * Reference: https://todoist.com/help/articles/introduction-to-filters
 */

import type { TodoistClient } from '../client.js';

/**
 * Task from Todoist API
 */
export interface TodoistTaskResult {
  id: string;
  content: string;
  description: string;
  labels: string[];
  priority: number;
  due?: {
    date: string;
    string: string;
    is_recurring: boolean;
  };
  project_id: string;
  created_at: string;
}

/**
 * Query tasks by GTD context (label)
 *
 * Excludes waiting items by default since those are delegated.
 *
 * @param client - Authenticated Todoist client
 * @param context - GTD context: 'computer', 'phone', 'out'
 * @returns Array of matching tasks
 */
export async function queryByContext(
  client: TodoistClient,
  context: string
): Promise<TodoistTaskResult[]> {
  // @context & !@waiting - tasks in this context that aren't delegated
  const filter = `@${context} & !@waiting`;
  return queryWithFilter(client, filter);
}

/**
 * Query all waiting/delegated tasks
 *
 * Tasks marked with @waiting label.
 *
 * @param client - Authenticated Todoist client
 * @returns Array of waiting tasks
 */
export async function queryWaiting(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, '@waiting');
}

/**
 * Query overdue waiting tasks
 *
 * Delegated tasks that are past their follow-up date.
 * Useful for "what do I need to follow up on?" queries.
 *
 * @param client - Authenticated Todoist client
 * @returns Array of overdue waiting tasks
 */
export async function queryOverdueWaiting(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, '@waiting & overdue');
}

/**
 * Query tasks for a specific person (agenda items)
 *
 * Uses the person's label (e.g., @john_smith) to find discussion topics.
 *
 * @param client - Authenticated Todoist client
 * @param personLabel - Person's label name (lowercase, underscores for spaces)
 * @returns Array of agenda items for this person
 */
export async function queryPersonAgenda(
  client: TodoistClient,
  personLabel: string
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, `@${personLabel}`);
}

/**
 * Query tasks by department/project
 *
 * Uses ## filter to search in project and all sub-projects.
 *
 * @param client - Authenticated Todoist client
 * @param projectName - Project name
 * @returns Array of tasks in this project hierarchy
 */
export async function queryByProject(
  client: TodoistClient,
  projectName: string
): Promise<TodoistTaskResult[]> {
  // ## searches in project AND all sub-projects
  return queryWithFilter(client, `##${projectName}`);
}

/**
 * Query tasks due today
 *
 * @param client - Authenticated Todoist client
 * @returns Array of tasks due today
 */
export async function queryDueToday(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, 'today');
}

/**
 * Query tasks due tomorrow
 *
 * @param client - Authenticated Todoist client
 * @returns Array of tasks due tomorrow
 */
export async function queryDueTomorrow(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, 'tomorrow');
}

/**
 * Query overdue tasks
 *
 * @param client - Authenticated Todoist client
 * @returns Array of overdue tasks
 */
export async function queryOverdue(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, 'overdue');
}

/**
 * Query tasks due this week
 *
 * @param client - Authenticated Todoist client
 * @returns Array of tasks due in the next 7 days
 */
export async function queryDueThisWeek(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, '7 days');
}

/**
 * Query high priority tasks (priority 4 = today, priority 3 = this_week)
 *
 * @param client - Authenticated Todoist client
 * @returns Array of high-priority tasks
 */
export async function queryHighPriority(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  // p1 is priority 4 (urgent), p2 is priority 3 (high)
  return queryWithFilter(client, 'p1 | p2');
}

/**
 * Query tasks with a specific label
 *
 * @param client - Authenticated Todoist client
 * @param label - Label name
 * @returns Array of tasks with this label
 */
export async function queryByLabel(
  client: TodoistClient,
  label: string
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, `@${label}`);
}

/**
 * Search tasks by content
 *
 * @param client - Authenticated Todoist client
 * @param searchText - Text to search for
 * @returns Array of matching tasks
 */
export async function searchTasks(
  client: TodoistClient,
  searchText: string
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, `search: ${searchText}`);
}

/**
 * Query tasks with no due date
 *
 * @param client - Authenticated Todoist client
 * @returns Array of tasks without due dates
 */
export async function queryNoDueDate(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return queryWithFilter(client, 'no date');
}

/**
 * Execute a raw filter query
 *
 * Use this for custom filter combinations.
 * Reference: https://todoist.com/help/articles/introduction-to-filters
 *
 * @param client - Authenticated Todoist client
 * @param filter - Todoist filter string
 * @returns Array of matching tasks
 */
export async function queryWithFilter(
  client: TodoistClient,
  filter: string
): Promise<TodoistTaskResult[]> {
  try {
    const tasks = await client.get<TodoistTaskResult[]>(
      `/tasks?filter=${encodeURIComponent(filter)}`
    );
    return tasks;
  } catch (error) {
    console.error(`[TodoistQuery] Filter query failed: ${filter}`, error);
    throw error;
  }
}

/**
 * Get all active tasks (no filter)
 *
 * @param client - Authenticated Todoist client
 * @returns Array of all active tasks
 */
export async function queryAllTasks(
  client: TodoistClient
): Promise<TodoistTaskResult[]> {
  return client.get<TodoistTaskResult[]>('/tasks');
}

/**
 * Get a single task by ID
 *
 * @param client - Authenticated Todoist client
 * @param taskId - Task ID
 * @returns Task or null if not found
 */
export async function getTaskById(
  client: TodoistClient,
  taskId: string
): Promise<TodoistTaskResult | null> {
  try {
    return await client.get<TodoistTaskResult>(`/tasks/${taskId}`);
  } catch (error) {
    // Task might be completed or deleted
    return null;
  }
}
