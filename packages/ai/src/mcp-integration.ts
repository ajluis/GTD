/**
 * MCP Integration for AI Agent
 *
 * This module bridges the MCP package with the agent loop,
 * allowing the agent to use Todoist MCP tools alongside internal tools.
 *
 * Key Design Decision:
 * Rather than replacing internal tools entirely, we support a hybrid model:
 * - MCP tools for Todoist operations (source of truth)
 * - Internal tools for database queries (people, messages, settings)
 *
 * This allows gradual migration while keeping the system functional.
 */

import type { Tool, ToolContext, ToolResult } from './tools/types.js';

// ============================================================================
// MCP Tool Types (avoiding circular dependency with @gtd/mcp)
// ============================================================================

/**
 * MCP Tool interface (compatible with @gtd/mcp MCPTool)
 */
export interface MCPToolLike {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, MCPSchemaPropertyLike>;
    required?: string[];
  };
}

export interface MCPSchemaPropertyLike {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: (string | number | boolean)[];
  default?: unknown;
}

/**
 * MCP Client interface (compatible with @gtd/mcp MCPClient)
 */
export interface MCPClientLike {
  listTools(): MCPToolLike[];
  callTool(name: string, args: Record<string, unknown>): Promise<MCPToolCallResultLike>;
}

export interface MCPToolCallResultLike {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

// ============================================================================
// Tool Adapter
// ============================================================================

/**
 * Options for creating MCP-backed tools
 */
export interface MCPToolsOptions {
  /** MCP client for tool execution */
  client: MCPClientLike;
  /** Prefix for tool names (to distinguish from internal tools) */
  namePrefix?: string;
}

/**
 * Convert MCP schema property to internal JSON schema format
 */
function convertSchemaProperty(prop: MCPSchemaPropertyLike): {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  default?: unknown;
} {
  return {
    type: prop.type === 'integer' ? 'number' : prop.type,
    description: prop.description,
    enum: prop.enum?.map(String),
    default: prop.default,
  };
}

/**
 * Convert an MCP tool to internal Tool format
 *
 * This adapter allows MCP tools to be used in the existing agent loop
 * without modifying the loop's core logic.
 */
export function createMCPToolAdapter(
  mcpTool: MCPToolLike,
  client: MCPClientLike,
  namePrefix = ''
): Tool {
  // Convert schema properties
  const properties: Tool['parameters']['properties'] = {};
  if (mcpTool.inputSchema.properties) {
    for (const [key, value] of Object.entries(mcpTool.inputSchema.properties)) {
      properties[key] = convertSchemaProperty(value);
    }
  }

  return {
    name: namePrefix + mcpTool.name,
    description: mcpTool.description,
    parameters: {
      type: 'object',
      properties,
      required: mcpTool.inputSchema.required,
    },
    execute: async (params: unknown, _context: ToolContext): Promise<ToolResult> => {
      try {
        const result = await client.callTool(
          mcpTool.name, // Use original name (without prefix)
          params as Record<string, unknown>
        );

        // Check for MCP errors
        if (result.isError) {
          const errorText = result.content
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text)
            .join('\n');

          return {
            success: false,
            error: errorText || 'MCP tool error',
          };
        }

        // Extract text content
        const textContent = result.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('\n');

        // Try to parse as JSON
        let data: unknown;
        try {
          data = JSON.parse(textContent);
        } catch {
          data = textContent;
        }

        // Track entities for conversation context
        const trackEntities = extractEntitiesFromResult(mcpTool.name, data);

        return {
          success: true,
          data,
          trackEntities,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Extract task/people entities from Todoist MCP tool results
 */
function extractEntitiesFromResult(
  toolName: string,
  data: unknown
): ToolResult['trackEntities'] | undefined {
  if (!data || typeof data !== 'object') return undefined;

  // Single task result (create_task, update_task, get_task)
  if ('id' in data && 'content' in data) {
    const task = data as { id: string; content: string };
    return {
      tasks: [{ id: task.id, title: task.content }],
      lastCreatedTaskId: toolName === 'create_task' ? task.id : undefined,
    };
  }

  // Task list result (get_tasks)
  if (Array.isArray(data) && data.length > 0 && 'content' in data[0]) {
    return {
      tasks: data.map((task: { id: string; content: string }) => ({
        id: task.id,
        title: task.content,
      })),
    };
  }

  return undefined;
}

/**
 * Create all MCP tools as internal Tool adapters
 */
export function createMCPTools(options: MCPToolsOptions): Tool[] {
  const { client, namePrefix = '' } = options;
  return client.listTools().map((tool) => createMCPToolAdapter(tool, client, namePrefix));
}

// ============================================================================
// Unified Tool Set
// ============================================================================

/**
 * Tool source types
 */
export type ToolSource = 'internal' | 'mcp';

/**
 * Combined tool set that can contain both internal and MCP tools
 */
export interface UnifiedToolSet {
  /** All tools (both internal and MCP) */
  all: Tool[];
  /** Internal tools only */
  internal: Tool[];
  /** MCP tools only */
  mcp: Tool[];
  /** Get tool by name */
  get(name: string): Tool | undefined;
  /** Check if tool exists */
  has(name: string): boolean;
  /** Get tool source */
  getSource(name: string): ToolSource | undefined;
}

/**
 * Create a unified tool set from internal and MCP tools
 *
 * @example
 * const toolSet = createUnifiedToolSet({
 *   internal: allTools,
 *   mcpClient: todoistClient.getMCPClient(),
 * });
 *
 * // Use in agent loop
 * const result = await runAgentLoop({
 *   tools: toolSet.all,
 *   ...
 * });
 */
export function createUnifiedToolSet(options: {
  internal?: Tool[];
  mcpClient?: MCPClientLike;
  mcpPrefix?: string;
}): UnifiedToolSet {
  const { internal = [], mcpClient, mcpPrefix = '' } = options;

  // Create MCP tool adapters
  const mcp = mcpClient ? createMCPTools({ client: mcpClient, namePrefix: mcpPrefix }) : [];

  // Combine all tools
  const all = [...internal, ...mcp];

  // Build lookup maps
  const toolMap = new Map(all.map((t) => [t.name, t]));
  const sourceMap = new Map<string, ToolSource>([
    ...internal.map((t): [string, ToolSource] => [t.name, 'internal']),
    ...mcp.map((t): [string, ToolSource] => [t.name, 'mcp']),
  ]);

  return {
    all,
    internal,
    mcp,
    get: (name: string) => toolMap.get(name),
    has: (name: string) => toolMap.has(name),
    getSource: (name: string) => sourceMap.get(name),
  };
}

// ============================================================================
// Tool Selection Helpers
// ============================================================================

/**
 * GTD-specific tool categories
 */
export const GTD_TOOL_CATEGORIES = {
  /** Tools for creating and modifying tasks (prefer MCP) */
  taskWrite: ['create_task', 'update_task', 'complete_task', 'reopen_task', 'delete_task'] as string[],
  /** Tools for reading tasks (prefer MCP) */
  taskRead: ['get_tasks', 'get_task'] as string[],
  /** Tools for project management (prefer MCP) */
  projects: ['get_projects', 'create_project'] as string[],
  /** Tools for label management (prefer MCP) */
  labels: ['get_labels', 'create_label'] as string[],
  /** Tools for comments (MCP only) */
  comments: ['add_comment'] as string[],
  /** Internal database lookups (internal only) */
  internalLookup: ['lookup_people', 'lookup_messages', 'get_user_settings', 'get_productivity_stats'] as string[],
  /** Internal people management (internal only) */
  internalPeople: ['create_person', 'update_person', 'remove_person'] as string[],
};

/**
 * Get recommended tools for a GTD operation
 *
 * This helps select the right mix of MCP and internal tools
 * based on what the operation needs.
 */
export function getToolsForOperation(
  toolSet: UnifiedToolSet,
  operation: 'capture' | 'query' | 'manage_people' | 'full'
): Tool[] {
  switch (operation) {
    case 'capture':
      // Task creation uses MCP, but may need people lookup
      return toolSet.all.filter(
        (t) =>
          GTD_TOOL_CATEGORIES.taskWrite.includes(t.name) ||
          GTD_TOOL_CATEGORIES.projects.includes(t.name) ||
          GTD_TOOL_CATEGORIES.labels.includes(t.name) ||
          t.name === 'lookup_people'
      );

    case 'query':
      // Task queries use MCP, but messages/settings are internal
      return toolSet.all.filter(
        (t) =>
          GTD_TOOL_CATEGORIES.taskRead.includes(t.name) ||
          GTD_TOOL_CATEGORIES.projects.includes(t.name) ||
          GTD_TOOL_CATEGORIES.labels.includes(t.name) ||
          GTD_TOOL_CATEGORIES.internalLookup.includes(t.name)
      );

    case 'manage_people':
      // People are internal-only
      return toolSet.all.filter((t) => GTD_TOOL_CATEGORIES.internalPeople.includes(t.name));

    case 'full':
    default:
      return toolSet.all;
  }
}
