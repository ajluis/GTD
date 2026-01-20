/**
 * MCP Protocol Types
 *
 * Type definitions for the Model Context Protocol, enabling standardized
 * communication between AI applications and external tools/data sources.
 *
 * MCP uses a JSON-RPC 2.0 based protocol with:
 * - Tools: Executable functions the LLM can invoke
 * - Resources: Data the LLM can read
 * - Prompts: Pre-defined prompt templates
 */

// ============================================================================
// Core Protocol Types
// ============================================================================

/**
 * JSON-RPC 2.0 request format
 */
export interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response format
 */
export interface JSONRPCResponse<T = unknown> {
  jsonrpc: '2.0';
  id: string | number;
  result?: T;
  error?: JSONRPCError;
}

/**
 * JSON-RPC 2.0 error format
 */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// ============================================================================
// MCP Server Types
// ============================================================================

/**
 * MCP Server information returned during initialization
 */
export interface MCPServerInfo {
  name: string;
  version: string;
  protocolVersion: string;
  capabilities: MCPCapabilities;
}

/**
 * Capabilities advertised by an MCP server
 */
export interface MCPCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
  logging?: Record<string, unknown>;
}

// ============================================================================
// Tool Types
// ============================================================================

/**
 * MCP Tool definition
 */
export interface MCPTool {
  /** Unique tool name */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON Schema for input parameters */
  inputSchema: MCPToolInputSchema;
}

/**
 * JSON Schema for tool input (simplified)
 */
export interface MCPToolInputSchema {
  type: 'object';
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * JSON Schema property definition
 */
export interface MCPSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number | boolean)[];
  default?: unknown;
  format?: string;
  items?: MCPSchemaProperty;
  properties?: Record<string, MCPSchemaProperty>;
  required?: string[];
}

/**
 * Tool call request
 */
export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool call result
 */
export interface MCPToolCallResult {
  content: MCPContent[];
  isError?: boolean;
}

/**
 * Content types returned from tools
 */
export type MCPContent =
  | MCPTextContent
  | MCPImageContent
  | MCPResourceContent;

export interface MCPTextContent {
  type: 'text';
  text: string;
}

export interface MCPImageContent {
  type: 'image';
  data: string; // base64
  mimeType: string;
}

export interface MCPResourceContent {
  type: 'resource';
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string; // base64
  };
}

// ============================================================================
// Resource Types
// ============================================================================

/**
 * MCP Resource definition
 */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

/**
 * Resource contents
 */
export interface MCPResourceContents {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string; // base64
}

// ============================================================================
// Prompt Types
// ============================================================================

/**
 * MCP Prompt definition
 */
export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: MCPPromptArgument[];
}

/**
 * Prompt argument definition
 */
export interface MCPPromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

/**
 * Prompt message content
 */
export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

// ============================================================================
// Todoist-Specific Types
// ============================================================================

/**
 * Todoist task as returned by the MCP server
 */
export interface TodoistTask {
  id: string;
  content: string;
  description: string;
  project_id: string;
  section_id: string | null;
  parent_id: string | null;
  order: number;
  priority: 1 | 2 | 3 | 4; // 4 = urgent, 1 = natural
  due: TodoistDue | null;
  labels: string[];
  assignee_id: string | null;
  assigner_id: string | null;
  comment_count: number;
  creator_id: string;
  created_at: string;
  url: string;
  is_completed: boolean;
}

/**
 * Todoist due date information
 */
export interface TodoistDue {
  date: string; // YYYY-MM-DD
  string: string; // Human readable
  datetime?: string; // ISO 8601
  timezone?: string;
  is_recurring: boolean;
}

/**
 * Todoist project
 */
export interface TodoistProject {
  id: string;
  name: string;
  color: string;
  parent_id: string | null;
  order: number;
  comment_count: number;
  is_shared: boolean;
  is_favorite: boolean;
  is_inbox_project: boolean;
  is_team_inbox: boolean;
  view_style: 'list' | 'board';
  url: string;
}

/**
 * Todoist label
 */
export interface TodoistLabel {
  id: string;
  name: string;
  color: string;
  order: number;
  is_favorite: boolean;
}

/**
 * Todoist section
 */
export interface TodoistSection {
  id: string;
  project_id: string;
  name: string;
  order: number;
}

/**
 * Todoist comment
 */
export interface TodoistComment {
  id: string;
  task_id: string;
  content: string;
  posted_at: string;
  attachment?: {
    file_name: string;
    file_type: string;
    file_url: string;
    resource_type: string;
  };
}

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * MCP Client configuration options
 */
export interface MCPClientConfig {
  /** Server URL or connection string */
  serverUrl: string;
  /** Authentication token (if required) */
  authToken?: string;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Connection state
 */
export type MCPConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * Events emitted by the MCP client
 */
export interface MCPClientEvents {
  connected: (serverInfo: MCPServerInfo) => void;
  disconnected: (reason?: string) => void;
  error: (error: Error) => void;
  toolsChanged: (tools: MCPTool[]) => void;
}
