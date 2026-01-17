import type { TodoistClient } from '../client.js';
import type { CreateTaskData, TodoistTask, TodoistProject, TodoistLabel } from '../types.js';
import type { TaskType, TaskContext, TaskPriority } from '@clarity/shared-types';

/**
 * Map GTD context to Todoist label name
 */
const CONTEXT_TO_LABEL: Record<TaskContext, string> = {
  work: 'work',
  home: 'home',
  errands: 'errands',
  calls: 'calls',
  computer: 'computer',
  anywhere: 'anywhere',
};

/**
 * Map GTD priority to Todoist priority (4=urgent, 1=normal)
 */
const PRIORITY_TO_TODOIST: Record<TaskPriority, 1 | 2 | 3 | 4> = {
  today: 4,      // Urgent (red)
  this_week: 3,  // High (orange)
  soon: 2,       // Medium (yellow)
};

/**
 * Map GTD type to Todoist label
 */
const TYPE_TO_LABEL: Record<TaskType, string> = {
  action: 'action',
  project: 'project',
  waiting: 'waiting',
  someday: 'someday',
  agenda: 'agenda',
};

/**
 * Create a task in Todoist
 */
export async function createTask(
  client: TodoistClient,
  data: {
    title: string;
    type: TaskType;
    context?: TaskContext | null;
    priority?: TaskPriority | null;
    dueDate?: string | null;
    personName?: string | null;
    notes?: string | null;
  }
): Promise<string> {
  // Build labels array
  const labels: string[] = [];

  // Add type as label
  labels.push(TYPE_TO_LABEL[data.type]);

  // Add context as label if provided
  if (data.context) {
    labels.push(CONTEXT_TO_LABEL[data.context]);
  }

  // Build task content
  let content = data.title;

  // Add person name for agenda items
  if (data.type === 'agenda' && data.personName) {
    content = `${data.title} [${data.personName}]`;
  }

  // Build description
  let description = '';
  if (data.notes) {
    description = data.notes;
  }
  if (data.personName && data.type === 'agenda') {
    description = description
      ? `${description}\n\nPerson: ${data.personName}`
      : `Person: ${data.personName}`;
  }

  const taskData: CreateTaskData = {
    content,
    labels,
    ...(description && { description }),
    ...(data.priority && { priority: PRIORITY_TO_TODOIST[data.priority] }),
    ...(data.dueDate && { dueDate: data.dueDate }),
  };

  const task = await client.post<TodoistTask>('/tasks', taskData);

  console.log(`[Todoist] Created task: ${task.id} - ${content}`);

  return task.id;
}

/**
 * Complete a task in Todoist
 */
export async function completeTask(
  client: TodoistClient,
  taskId: string
): Promise<void> {
  await client.post(`/tasks/${taskId}/close`, {});
  console.log(`[Todoist] Completed task: ${taskId}`);
}

/**
 * Get all projects
 */
export async function getProjects(
  client: TodoistClient
): Promise<TodoistProject[]> {
  return client.get<TodoistProject[]>('/projects');
}

/**
 * Get all labels
 */
export async function getLabels(
  client: TodoistClient
): Promise<TodoistLabel[]> {
  return client.get<TodoistLabel[]>('/labels');
}
