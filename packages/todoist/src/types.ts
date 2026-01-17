/**
 * Todoist task creation data
 */
export interface CreateTaskData {
  content: string;
  description?: string;
  projectId?: string;
  labels?: string[];
  priority?: 1 | 2 | 3 | 4; // 4 = urgent, 1 = normal
  dueString?: string;
  dueDate?: string;
}

/**
 * Todoist task response
 */
export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  projectId: string;
  labels: string[];
  priority: number;
  due?: {
    date: string;
    string: string;
    isRecurring: boolean;
  };
  isCompleted: boolean;
  createdAt: string;
  url: string;
}

/**
 * Todoist project
 */
export interface TodoistProject {
  id: string;
  name: string;
  color: string;
  isInboxProject: boolean;
}

/**
 * Todoist label
 */
export interface TodoistLabel {
  id: string;
  name: string;
  color: string;
}

/**
 * Todoist API error response
 */
export interface TodoistErrorResponse {
  error: string;
  error_code?: number;
  http_code: number;
}
