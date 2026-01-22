import type { TodoistClient } from '../client.js';
import type { CreateTaskData, TodoistTask, TodoistProject, TodoistLabel } from '../types.js';
import type { TaskType, TaskContext, TaskPriority } from '@gtd/shared-types';
import { buildTaskLabels, getPersonLabel } from './labels.js';
import type { TodoistStructure } from './discovery.js';
import { findProjectIdByName } from './discovery.js';

/**
 * Map GTD context to Todoist label name
 *
 * Updated per spec: home and outside map to 'out'
 */
const CONTEXT_TO_LABEL: Record<TaskContext, string> = {
  computer: 'computer',
  phone: 'phone',
  home: 'out',      // Consolidated to @out
  outside: 'out',   // Consolidated to @out
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
 *
 * Updated per spec: most types don't need labels
 */
const TYPE_TO_LABEL: Record<TaskType, string | null> = {
  action: null,     // No label needed
  project: null,    // No label needed
  waiting: 'waiting', // @waiting for delegation tracking
  someday: null,    // Goes to Someday project, no label
  agenda: 'people', // @people for discussion items
};

/**
 * Input data for creating a task with routing
 */
export interface CreateTaskWithRoutingInput {
  title: string;
  type: TaskType;
  context?: TaskContext | null;
  priority?: TaskPriority | null;
  dueDate?: string | null;
  personName?: string | null;
  notes?: string | null;
  /** Target project name from AI classification */
  targetProject?: string | null;
}

/**
 * Create a task in Todoist with dynamic project routing
 *
 * This is the primary task creation function that:
 * 1. Routes to the appropriate project based on AI classification
 * 2. Formats waiting tasks as "PersonName — Task"
 * 3. Applies appropriate GTD labels
 *
 * @param client - Authenticated Todoist client
 * @param structure - Current Todoist structure (from discovery)
 * @param data - Task creation input
 * @returns Todoist task ID
 */
export async function createTaskWithRouting(
  client: TodoistClient,
  structure: TodoistStructure,
  data: CreateTaskWithRoutingInput
): Promise<string> {
  // 1. Determine project ID
  let projectId: string | null = null;

  if (data.targetProject) {
    projectId = findProjectIdByName(structure, data.targetProject);
    if (!projectId) {
      console.log(`[Todoist] Target project "${data.targetProject}" not found, using Inbox`);
    }
  }

  // Fallback to inbox
  if (!projectId) {
    projectId = structure.inbox.id;
  }

  // 2. Build labels array using the labels service
  const labels = buildTaskLabels(data.type, data.context);

  // Add person label for agenda items
  if (data.personName && (data.type === 'agenda' || data.type === 'waiting')) {
    labels.push(getPersonLabel(data.personName));
  }

  // Add context label if not already added by buildTaskLabels
  if (data.context) {
    const contextLabel = CONTEXT_TO_LABEL[data.context];
    if (contextLabel && !labels.includes(contextLabel)) {
      labels.push(contextLabel);
    }
  }

  // 3. Format task title
  let content = data.title;

  // Format waiting tasks as "PersonName — Task"
  // But avoid duplication if title already starts with the person's name
  if (data.type === 'waiting' && data.personName) {
    const titleLower = data.title.toLowerCase();
    const personLower = data.personName.toLowerCase();

    // Check if title already starts with the person's name
    // This handles cases like "Stan response to message" where AI kept the name
    if (!titleLower.startsWith(personLower)) {
      content = `${data.personName} — ${data.title}`;
    }
    // If it already starts with the name, use as-is (or add the "—" separator)
    else if (!data.title.includes('—')) {
      // Title starts with name but no separator, add it: "Stan response" → "Stan — response"
      const afterName = data.title.substring(data.personName.length).trim();
      content = `${data.personName} — ${afterName}`;
    }
  }

  // 4. Build description
  let description = '';
  if (data.notes) {
    description = data.notes;
  }

  // 5. Create the task
  const taskData: CreateTaskData = {
    content,
    labels,
    project_id: projectId,
    ...(description && { description }),
    ...(data.priority && { priority: PRIORITY_TO_TODOIST[data.priority] }),
    ...(data.dueDate && { due_date: data.dueDate }),
  };

  const task = await client.post<TodoistTask>('/tasks', taskData);

  const projectName = structure.allProjects.find(p => p.id === projectId)?.name ?? 'Unknown';
  console.log(`[Todoist] Created task: ${task.id} - "${content}" in ${projectName} [${labels.join(', ')}]`);

  return task.id;
}

/**
 * Create a task in Todoist (legacy - no routing)
 *
 * @deprecated Use createTaskWithRouting instead for dynamic project routing
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

  // Add type as label (updated to handle null)
  const typeLabel = TYPE_TO_LABEL[data.type];
  if (typeLabel) {
    labels.push(typeLabel);
  }

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

/**
 * Update task data type
 */
export interface UpdateTaskData {
  content?: string;
  description?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4;
  due_date?: string;
  due_string?: string;
}

/**
 * Update a task in Todoist
 */
export async function updateTask(
  client: TodoistClient,
  taskId: string,
  data: UpdateTaskData
): Promise<TodoistTask> {
  const task = await client.update<TodoistTask>(`/tasks/${taskId}`, data);
  console.log(`[Todoist] Updated task: ${taskId}`);
  return task;
}

/**
 * Delete (archive) a task in Todoist
 */
export async function deleteTask(
  client: TodoistClient,
  taskId: string
): Promise<void> {
  await client.delete(`/tasks/${taskId}`);
  console.log(`[Todoist] Deleted task: ${taskId}`);
}
