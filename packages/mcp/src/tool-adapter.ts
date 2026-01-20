/**
 * MCP Tool Adapter
 *
 * Adapts MCP tools to the internal Tool interface used by the agent loop.
 * This enables seamless integration of MCP tools with the existing tool system.
 *
 * Key insight: MCP tools use a different schema format than internal tools.
 * This adapter bridges the gap, allowing the agent to use both types uniformly.
 */

import type { MCPTool, MCPToolCallResult, MCPSchemaProperty, MCPContent } from './types.js';
import type { MCPClient } from './client.js';

// Import the internal Tool interface
// Note: This creates a dependency on @gtd/ai, but it's necessary for integration
// We use a compatible type definition to avoid circular dependencies

/**
 * Internal tool interface (compatible with @gtd/ai Tool type)
 */
interface InternalTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, InternalSchemaProperty>;
    required?: string[];
  };
  execute: (params: unknown, context: InternalToolContext) => Promise<InternalToolResult>;
}

interface InternalSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  default?: unknown;
  format?: string;
  items?: InternalSchemaProperty;
  properties?: Record<string, InternalSchemaProperty>;
  required?: string[];
}

interface InternalToolContext {
  userId: string;
  [key: string]: unknown;
}

interface InternalToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  trackEntities?: {
    tasks?: Array<{ id: string; title: string }>;
    people?: Array<{ id: string; name: string }>;
    lastCreatedTaskId?: string;
  };
}

/**
 * Options for creating an MCP tool adapter
 */
export interface MCPToolAdapterOptions {
  /** MCP client to use for tool execution */
  client: MCPClient;
  /** Prefix to add to tool names (to avoid conflicts) */
  namePrefix?: string;
  /** Function to extract entities from tool results */
  entityExtractor?: (toolName: string, result: MCPToolCallResult) => InternalToolResult['trackEntities'];
}

/**
 * Convert an MCP schema property to internal format
 */
function convertSchemaProperty(prop: MCPSchemaProperty): InternalSchemaProperty {
  const result: InternalSchemaProperty = {
    type: prop.type === 'integer' ? 'number' : prop.type,
    description: prop.description,
  };

  if (prop.enum) {
    result.enum = prop.enum.map(String);
  }

  if (prop.default !== undefined) {
    result.default = prop.default;
  }

  if (prop.format) {
    result.format = prop.format;
  }

  if (prop.items) {
    result.items = convertSchemaProperty(prop.items);
  }

  if (prop.properties) {
    result.properties = Object.fromEntries(
      Object.entries(prop.properties).map(([key, value]) => [
        key,
        convertSchemaProperty(value),
      ])
    );
  }

  if (prop.required) {
    result.required = prop.required;
  }

  return result;
}

/**
 * Convert an MCP tool to internal tool format
 */
function convertMCPToolToInternal(
  mcpTool: MCPTool,
  options: MCPToolAdapterOptions
): InternalTool {
  const { client, namePrefix = '', entityExtractor } = options;

  // Convert schema
  const properties: Record<string, InternalSchemaProperty> = {};
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
    execute: async (params: unknown, _context: InternalToolContext): Promise<InternalToolResult> => {
      try {
        const result = await client.callTool(
          mcpTool.name,
          params as Record<string, unknown>
        );

        // Check for errors
        if (result.isError) {
          const errorText = result.content
            .filter((c: MCPContent): c is { type: 'text'; text: string } => c.type === 'text')
            .map((c: { type: 'text'; text: string }) => c.text)
            .join('\n');

          return {
            success: false,
            error: errorText || 'Unknown MCP tool error',
          };
        }

        // Extract text content
        const textContent = result.content
          .filter((c: MCPContent): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c: { type: 'text'; text: string }) => c.text)
          .join('\n');

        // Try to parse as JSON for structured data
        let data: unknown;
        try {
          data = JSON.parse(textContent);
        } catch {
          data = textContent;
        }

        // Extract entities if extractor is provided
        const trackEntities = entityExtractor?.(mcpTool.name, result);

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
 * Create internal tools from all MCP tools
 */
export function createMCPToolAdapters(options: MCPToolAdapterOptions): InternalTool[] {
  const mcpTools = options.client.listTools();
  return mcpTools.map((tool) => convertMCPToolToInternal(tool, options));
}

/**
 * Default entity extractor for Todoist MCP tools
 *
 * Extracts task and project references from Todoist tool results
 * to enable conversation context tracking.
 */
export function todoistEntityExtractor(
  toolName: string,
  result: MCPToolCallResult
): InternalToolResult['trackEntities'] | undefined {
  const textContent = result.content
    .filter((c: MCPContent): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c: { type: 'text'; text: string }) => c.text)
    .join('\n');

  try {
    const data = JSON.parse(textContent);

    // Handle single task results
    if (toolName === 'create_task' && data.id && data.content) {
      return {
        tasks: [{ id: data.id, title: data.content }],
        lastCreatedTaskId: data.id,
      };
    }

    // Handle task list results
    if (toolName === 'get_tasks' && Array.isArray(data)) {
      return {
        tasks: data.map((task: { id: string; content: string }) => ({
          id: task.id,
          title: task.content,
        })),
      };
    }

    // Handle task updates
    if (toolName === 'update_task' && data.id && data.content) {
      return {
        tasks: [{ id: data.id, title: data.content }],
      };
    }
  } catch {
    // Not JSON, can't extract entities
  }

  return undefined;
}

/**
 * MCP Tool Set - a collection of MCP tools with helpers
 */
export class MCPToolSet {
  private tools: InternalTool[];
  private toolMap: Map<string, InternalTool>;

  constructor(options: MCPToolAdapterOptions) {
    this.tools = createMCPToolAdapters(options);
    this.toolMap = new Map(this.tools.map((t: InternalTool): [string, InternalTool] => [t.name, t]));
  }

  /**
   * Get all tools
   */
  all(): InternalTool[] {
    return [...this.tools];
  }

  /**
   * Get a tool by name
   */
  get(name: string): InternalTool | undefined {
    return this.toolMap.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.toolMap.has(name);
  }

  /**
   * Get tool names
   */
  names(): string[] {
    return this.tools.map((t) => t.name);
  }

  /**
   * Filter tools by name pattern
   */
  filter(pattern: RegExp): InternalTool[] {
    return this.tools.filter((t) => pattern.test(t.name));
  }
}
