/**
 * Tool System Types
 * Defines the interface for LLM tools in the hybrid architecture
 */

import type { DbClient } from '@gtd/database';
import type {
  TaskType,
  TaskContext,
  TaskPriority,
  DayOfWeek,
  MeetingFrequency,
} from '@gtd/shared-types';

/**
 * JSON Schema subset for tool parameter definitions
 */
export interface JSONSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  default?: unknown;
  format?: string;
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
  required?: string[];
}

export interface JSONSchema {
  type: 'object';
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * Tool definition interface
 */
export interface Tool {
  /** Unique tool name (snake_case) */
  name: string;
  /** Human-readable description for the LLM */
  description: string;
  /** JSON Schema defining the parameters */
  parameters: JSONSchema;
  /** Execute the tool with validated parameters */
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Context passed to tool execution
 */
export interface ToolContext {
  /** User ID for scoping queries */
  userId: string;
  /** Database client */
  db: DbClient;
  /** Todoist client (if user has connected Todoist) */
  todoistClient: TodoistClientLike | null;
  /** User's timezone */
  timezone: string;
  /** Conversation context for follow-ups */
  conversationContext: ConversationContext;
}

/**
 * Todoist client interface (subset of what we need)
 * Using Record<string, any> to allow the actual Todoist client type
 */
export interface TodoistClientLike {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data: unknown) => Promise<T>;
  update: <T>(endpoint: string, data: unknown) => Promise<T>;
  delete: (endpoint: string) => Promise<void>;
  [key: string]: any;
}

/**
 * Result from tool execution
 */
export interface ToolResult {
  /** Whether the tool executed successfully */
  success: boolean;
  /** Result data (tool-specific) */
  data?: unknown;
  /** Error message if failed */
  error?: string;
  /** Action for undo support */
  undoAction?: UndoAction;
  /** Entities to track in conversation context */
  trackEntities?: {
    tasks?: TaskReference[];
    people?: PersonReference[];
    lastCreatedTaskId?: string;
  };
}

/**
 * Reference to a task for conversation context
 */
export interface TaskReference {
  id: string;
  title: string;
  type?: TaskType;
}

/**
 * Reference to a person for conversation context
 */
export interface PersonReference {
  id: string;
  name: string;
}

/**
 * Conversation context for multi-turn interactions
 */
export interface ConversationContext {
  userId: string;

  /** Last tasks shown/created (for "the first one", "that task") */
  lastTasks: TaskReference[];

  /** Last people referenced (for "their agenda", "them") */
  lastPeople: PersonReference[];

  /** Last created task ID (for immediate edits) */
  lastCreatedTaskId?: string;

  /** Undo stack (last 5 reversible actions) */
  undoStack: UndoAction[];

  /** Active multi-turn flow */
  activeFlow?: 'weekly_review' | 'bulk_confirm' | 'clarification' | 'brain_dump';

  /** Flow-specific state */
  flowState?: unknown;

  /** When the context was last updated */
  updatedAt: Date;

  /** When the context expires (for cleanup) */
  expiresAt: Date;
}

/**
 * Undo action types
 */
export type UndoAction =
  | { type: 'delete_created_task'; taskId: string; todoistTaskId?: string }
  | { type: 'restore_deleted_task'; taskData: StoredTaskData }
  | { type: 'revert_task_update'; taskId: string; previousData: Partial<StoredTaskData> }
  | { type: 'uncomplete_task'; taskId: string; todoistTaskId?: string }
  | { type: 'restore_person'; personData: StoredPersonData };

/**
 * Stored task data for undo operations
 */
export interface StoredTaskData {
  id: string;
  title: string;
  type: TaskType;
  rawText: string;
  context: TaskContext | null;
  priority: TaskPriority | null;
  dueDate: string | null;
  personId: string | null;
  notes: string | null;
  todoistTaskId: string | null;
}

/**
 * Stored person data for undo operations
 */
export interface StoredPersonData {
  id: string;
  name: string;
  aliases: string[] | null;
  frequency: MeetingFrequency | null;
  dayOfWeek: DayOfWeek | null;
  todoistLabel: string | null;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

/**
 * Fast classification result (lightweight, no people list)
 */
export interface FastClassifyResult {
  /** Classification type */
  type: 'intent' | 'task' | 'multi_item' | 'needs_clarification' | 'unknown';

  /** Whether this needs dynamic data lookup via tools */
  needsDataLookup: boolean;

  /** Confidence score (0-1) */
  confidence: number;

  /** For intent type */
  intent?: {
    type: string;
    entities: Record<string, unknown>;
  };

  /** For single task capture (when needsDataLookup is false) */
  taskCapture?: {
    title: string;
    type: TaskType;
    context?: TaskContext;
    priority?: TaskPriority;
    dueDate?: string;
    personName?: string; // Raw name, will be resolved later
    /** Target Todoist project (AI-selected from available projects) */
    targetProject?: string;
  };

  /** For multi-item messages */
  items?: Array<{
    title: string;
    type: TaskType;
    context?: TaskContext;
    priority?: TaskPriority;
    dueDate?: string;
    personName?: string;
    /** Target Todoist project (AI-selected from available projects) */
    targetProject?: string;
    needsClarification?: boolean;
    clarificationQuestion?: string;
  }>;

  /** Required lookups if needsDataLookup is true */
  requiredLookups?: Array<{
    type: 'people' | 'tasks' | 'person_agenda' | 'settings';
    query?: string;
    filter?: Record<string, unknown>;
  }>;

  /** Clarification question if type is needs_clarification */
  clarificationQuestion?: string;

  /** Reasoning for the classification */
  reasoning?: string;
}

/**
 * Agent loop result
 */
export interface AgentResult {
  /** Final response text to send to user */
  response: string;

  /** Tool calls that were executed */
  toolCalls: Array<{
    tool: string;
    params: Record<string, unknown>;
    result: ToolResult;
  }>;

  /** Updated conversation context */
  updatedContext: Partial<ConversationContext>;

  /** Whether the agent completed successfully */
  success: boolean;

  /** Error message if failed */
  error?: string;
}
