/**
 * Todoist task creation data
 */
export interface CreateTaskData {
  content: string;
  description?: string;
  project_id?: string; // Todoist API uses snake_case
  labels?: string[];
  priority?: 1 | 2 | 3 | 4; // 4 = urgent, 1 = normal
  due_string?: string; // Natural language like "tomorrow"
  due_date?: string; // ISO date like "2024-01-15"
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
  /** Whether this is the user's Inbox project */
  isInboxProject?: boolean;
  is_inbox_project?: boolean; // API returns snake_case
  /** Parent project ID (for nested projects) */
  parent_id?: string | null;
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
