/**
 * Todoist MCP Client
 *
 * Todoist-specific wrapper around the generic MCP client.
 * Provides type-safe methods for all Todoist operations via MCP.
 *
 * The Todoist MCP server (ai.todoist.net/mcp) exposes these tools:
 * - create_task: Create a new task with natural language dates
 * - get_tasks: Query tasks with filters
 * - update_task: Modify task fields
 * - complete_task: Mark task as done
 * - reopen_task: Reopen a completed task
 * - delete_task: Remove a task
 * - get_projects: List all projects
 * - create_project: Create a new project
 * - get_labels: List all labels
 * - create_label: Create a new label
 * - add_comment: Add comment to a task
 */

import { MCPClient, createMCPClient } from './client.js';
import type {
  MCPClientConfig,
  MCPTool,
  TodoistTask,
  TodoistProject,
  TodoistLabel,
  TodoistComment,
} from './types.js';

// ============================================================================
// Todoist MCP Configuration
// ============================================================================

/** Official Todoist MCP server URL */
export const TODOIST_MCP_URL = 'https://ai.todoist.net/mcp';

/**
 * Todoist MCP client configuration
 */
export interface TodoistMCPConfig {
  /** Todoist API token (from user OAuth) */
  apiToken: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Request timeout in milliseconds */
  timeout?: number;
}

// ============================================================================
// Todoist-Specific Types
// ============================================================================

/**
 * Parameters for creating a task
 */
export interface CreateTaskParams {
  /** Task content (title) */
  content: string;
  /** Task description (optional) */
  description?: string;
  /** Project name or ID */
  project?: string;
  /** Due date in natural language (e.g., "tomorrow", "next Monday") */
  due?: string;
  /** Priority (1=natural, 4=urgent) */
  priority?: 1 | 2 | 3 | 4;
  /** Label names to apply */
  labels?: string[];
  /** Parent task ID for subtasks */
  parent_id?: string;
  /** Section ID within project */
  section_id?: string;
}

/**
 * Parameters for querying tasks
 */
export interface GetTasksParams {
  /** Filter string (Todoist filter syntax) */
  filter?: string;
  /** Project ID to filter by */
  project_id?: string;
  /** Label name to filter by */
  label?: string;
}

/**
 * Parameters for updating a task
 */
export interface UpdateTaskParams {
  /** Task ID to update */
  task_id: string;
  /** New content */
  content?: string;
  /** New description */
  description?: string;
  /** New due date */
  due?: string;
  /** New priority */
  priority?: 1 | 2 | 3 | 4;
  /** New labels (replaces existing) */
  labels?: string[];
}

// ============================================================================
// Todoist MCP Client
// ============================================================================

/**
 * Todoist MCP Client
 *
 * Provides a type-safe interface to Todoist operations via MCP.
 * This replaces direct SDK calls with MCP tool invocations.
 */
export class TodoistMCPClient {
  private client: MCPClient;
  private connected = false;

  constructor(config: TodoistMCPConfig) {
    const mcpConfig: MCPClientConfig = {
      serverUrl: TODOIST_MCP_URL,
      authToken: config.apiToken,
      debug: config.debug ?? false,
      timeout: config.timeout ?? 30000,
    };

    this.client = createMCPClient(mcpConfig);
  }

  /**
   * Connect to the Todoist MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    await this.client.connect();
    this.connected = true;
  }

  /**
   * Ensure connection is established
   */
  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    if (this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }

  /**
   * Get available MCP tools
   */
  async listTools(): Promise<MCPTool[]> {
    await this.ensureConnected();
    return this.client.listTools();
  }

  // ==========================================================================
  // Task Operations
  // ==========================================================================

  /**
   * Create a new task
   *
   * @example
   * await client.createTask({
   *   content: "Buy groceries",
   *   project: "Personal",
   *   due: "tomorrow",
   *   priority: 2,
   *   labels: ["@errands"]
   * });
   */
  async createTask(params: CreateTaskParams): Promise<TodoistTask> {
    await this.ensureConnected();

    // Map our params to what the MCP tool expects
    const args: Record<string, unknown> = {
      content: params.content,
    };

    if (params.description) args.description = params.description;
    if (params.project) args.project = params.project;
    if (params.due) args.due_string = params.due;
    if (params.priority) args.priority = params.priority;
    if (params.labels) args.labels = params.labels;
    if (params.parent_id) args.parent_id = params.parent_id;
    if (params.section_id) args.section_id = params.section_id;

    return this.client.callToolForJSON<TodoistTask>('create_task', args);
  }

  /**
   * Get tasks matching filters
   *
   * @example
   * // Get all tasks due today
   * await client.getTasks({ filter: "today" });
   *
   * // Get tasks in a project
   * await client.getTasks({ project_id: "12345" });
   */
  async getTasks(params?: GetTasksParams): Promise<TodoistTask[]> {
    await this.ensureConnected();

    const args: Record<string, unknown> = {};
    if (params?.filter) args.filter = params.filter;
    if (params?.project_id) args.project_id = params.project_id;
    if (params?.label) args.label = params.label;

    return this.client.callToolForJSON<TodoistTask[]>('get_tasks', args);
  }

  /**
   * Get a single task by ID
   */
  async getTask(taskId: string): Promise<TodoistTask> {
    await this.ensureConnected();
    return this.client.callToolForJSON<TodoistTask>('get_task', { task_id: taskId });
  }

  /**
   * Update an existing task
   */
  async updateTask(params: UpdateTaskParams): Promise<TodoistTask> {
    await this.ensureConnected();

    const args: Record<string, unknown> = {
      task_id: params.task_id,
    };

    if (params.content) args.content = params.content;
    if (params.description) args.description = params.description;
    if (params.due) args.due_string = params.due;
    if (params.priority) args.priority = params.priority;
    if (params.labels) args.labels = params.labels;

    return this.client.callToolForJSON<TodoistTask>('update_task', args);
  }

  /**
   * Mark a task as complete
   */
  async completeTask(taskId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.callTool('complete_task', { task_id: taskId });
  }

  /**
   * Reopen a completed task
   */
  async reopenTask(taskId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.callTool('reopen_task', { task_id: taskId });
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    await this.ensureConnected();
    await this.client.callTool('delete_task', { task_id: taskId });
  }

  // ==========================================================================
  // Project Operations
  // ==========================================================================

  /**
   * Get all projects
   */
  async getProjects(): Promise<TodoistProject[]> {
    await this.ensureConnected();
    return this.client.callToolForJSON<TodoistProject[]>('get_projects', {});
  }

  /**
   * Create a new project
   */
  async createProject(
    name: string,
    options?: {
      parent_id?: string;
      color?: string;
      is_favorite?: boolean;
    }
  ): Promise<TodoistProject> {
    await this.ensureConnected();

    const args: Record<string, unknown> = { name };
    if (options?.parent_id) args.parent_id = options.parent_id;
    if (options?.color) args.color = options.color;
    if (options?.is_favorite) args.is_favorite = options.is_favorite;

    return this.client.callToolForJSON<TodoistProject>('create_project', args);
  }

  /**
   * Find a project by name (case-insensitive)
   */
  async findProject(name: string): Promise<TodoistProject | null> {
    const projects = await this.getProjects();
    const lowerName = name.toLowerCase();
    return projects.find((p) => p.name.toLowerCase() === lowerName) ?? null;
  }

  // ==========================================================================
  // Label Operations
  // ==========================================================================

  /**
   * Get all labels
   */
  async getLabels(): Promise<TodoistLabel[]> {
    await this.ensureConnected();
    return this.client.callToolForJSON<TodoistLabel[]>('get_labels', {});
  }

  /**
   * Create a new label
   */
  async createLabel(
    name: string,
    options?: {
      color?: string;
      is_favorite?: boolean;
    }
  ): Promise<TodoistLabel> {
    await this.ensureConnected();

    const args: Record<string, unknown> = { name };
    if (options?.color) args.color = options.color;
    if (options?.is_favorite) args.is_favorite = options.is_favorite;

    return this.client.callToolForJSON<TodoistLabel>('create_label', args);
  }

  /**
   * Find a label by name (case-insensitive)
   */
  async findLabel(name: string): Promise<TodoistLabel | null> {
    const labels = await this.getLabels();
    const lowerName = name.toLowerCase().replace(/^@/, '');
    return (
      labels.find((l) => l.name.toLowerCase() === lowerName) ?? null
    );
  }

  /**
   * Ensure a label exists, creating it if necessary
   */
  async ensureLabel(name: string): Promise<TodoistLabel> {
    const cleanName = name.replace(/^@/, '');
    const existing = await this.findLabel(cleanName);
    if (existing) return existing;
    return this.createLabel(cleanName);
  }

  // ==========================================================================
  // Comment Operations
  // ==========================================================================

  /**
   * Add a comment to a task
   */
  async addComment(taskId: string, content: string): Promise<TodoistComment> {
    await this.ensureConnected();
    return this.client.callToolForJSON<TodoistComment>('add_comment', {
      task_id: taskId,
      content,
    });
  }

  // ==========================================================================
  // Convenience Methods for GTD
  // ==========================================================================

  /**
   * Get tasks due today
   */
  async getTasksDueToday(): Promise<TodoistTask[]> {
    return this.getTasks({ filter: 'today' });
  }

  /**
   * Get tasks due this week
   */
  async getTasksDueThisWeek(): Promise<TodoistTask[]> {
    return this.getTasks({ filter: '7 days' });
  }

  /**
   * Get overdue tasks
   */
  async getOverdueTasks(): Promise<TodoistTask[]> {
    return this.getTasks({ filter: 'overdue' });
  }

  /**
   * Get high priority tasks (priority 3 or 4)
   */
  async getHighPriorityTasks(): Promise<TodoistTask[]> {
    return this.getTasks({ filter: 'p1 | p2' });
  }

  /**
   * Get tasks by label (for GTD contexts like @phone, @computer)
   */
  async getTasksByLabel(label: string): Promise<TodoistTask[]> {
    const cleanLabel = label.replace(/^@/, '');
    return this.getTasks({ filter: `@${cleanLabel}` });
  }

  /**
   * Search tasks by content
   */
  async searchTasks(query: string): Promise<TodoistTask[]> {
    return this.getTasks({ filter: `search: ${query}` });
  }

  /**
   * Get the underlying MCP client for advanced operations
   */
  getMCPClient(): MCPClient {
    return this.client;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a Todoist MCP client from an API token
 *
 * @example
 * const todoist = await connectTodoist(user.todoistAccessToken);
 * const tasks = await todoist.getTasksDueToday();
 */
export async function connectTodoist(
  apiToken: string,
  options?: Omit<TodoistMCPConfig, 'apiToken'>
): Promise<TodoistMCPClient> {
  const client = new TodoistMCPClient({
    apiToken,
    ...options,
  });

  await client.connect();
  return client;
}

/**
 * Create a Todoist MCP client without auto-connecting
 * (useful when you want to control connection timing)
 */
export function createTodoistMCPClient(
  apiToken: string,
  options?: Omit<TodoistMCPConfig, 'apiToken'>
): TodoistMCPClient {
  return new TodoistMCPClient({
    apiToken,
    ...options,
  });
}
