import type { TodoistClient } from '../client.js';
import type { CreateTaskData, TodoistTask, TodoistProject, TodoistLabel } from '../types.js';
import type { TaskType, TaskContext, TaskPriority } from '@gtd/shared-types';

/**
 * Map GTD context to Todoist label name
 */
const CONTEXT_TO_LABEL: Record<TaskContext, string> = {
  computer: 'computer',
  phone: 'phone',
  home: 'home',
  outside: 'outside',
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
    personLabel?: string | null;
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

  // Add person label for agenda items
  if (data.personLabel) {
    // Convert to lowercase, replace spaces with underscores for valid label
    labels.push(data.personLabel.toLowerCase().replace(/\s+/g, '_'));
  }

  // Build task content
  const content = data.title;

  // Build description
  let description = '';
  if (data.notes) {
    description = data.notes;
  }

  const taskData: CreateTaskData = {
    content,
    labels,
    ...(description && { description }),
    ...(data.priority && { priority: PRIORITY_TO_TODOIST[data.priority] }),
    ...(data.dueDate && { due_date: data.dueDate }),
  };

  const task = await client.post<TodoistTask>('/tasks', taskData);

  console.log(`[Todoist] Created task: ${task.id} - ${content} [${labels.join(', ')}]`);

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

/**
 * Create a new project
 */
export async function createProject(
  client: TodoistClient,
  name: string,
  color?: string
): Promise<TodoistProject> {
  const project = await client.post<TodoistProject>('/projects', {
    name,
    ...(color && { color }),
  });

  console.log(`[Todoist] Created project: ${project.id} - ${name}`);

  return project;
}

/**
 * Delete a project
 */
export async function deleteProject(
  client: TodoistClient,
  projectId: string
): Promise<void> {
  await client.delete(`/projects/${projectId}`);
  console.log(`[Todoist] Deleted project: ${projectId}`);
}
