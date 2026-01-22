/**
 * Tool Executor
 * Safely executes tools with validation and error handling
 */

import type { Tool, ToolContext, ToolResult, ToolCall } from './types.js';

/**
 * Validate parameters against a tool's JSON schema
 */
function validateParams(
  params: unknown,
  tool: Tool
): { valid: boolean; error?: string } {
  if (typeof params !== 'object' || params === null) {
    return { valid: false, error: 'Parameters must be an object' };
  }

  const schema = tool.parameters;
  const paramsObj = params as Record<string, unknown>;

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in paramsObj) || paramsObj[field] === undefined) {
        return { valid: false, error: `Missing required parameter: ${field}` };
      }
    }
  }

  // Basic type validation for provided fields
  for (const [key, value] of Object.entries(paramsObj)) {
    const propSchema = schema.properties[key];
    if (!propSchema) {
      // Allow extra properties (LLM might add reasoning, etc.)
      continue;
    }

    if (value === null || value === undefined) {
      continue; // Allow null/undefined for optional fields
    }

    const valueType = Array.isArray(value) ? 'array' : typeof value;
    if (propSchema.type !== valueType) {
      // Allow string numbers
      if (propSchema.type === 'number' && typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num)) continue;
      }
      return {
        valid: false,
        error: `Parameter '${key}' should be ${propSchema.type}, got ${valueType}`,
      };
    }

    // Enum validation
    if (propSchema.enum && !propSchema.enum.includes(value as string)) {
      return {
        valid: false,
        error: `Parameter '${key}' must be one of: ${propSchema.enum.join(', ')}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Execute a single tool call
 */
export async function executeTool(
  tool: Tool,
  params: unknown,
  context: ToolContext
): Promise<ToolResult> {
  // Validate parameters
  const validation = validateParams(params, tool);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  try {
    // Execute the tool
    const result = await tool.execute(params, context);

    // Track entities in conversation context if provided
    if (result.success && result.trackEntities) {
      if (result.trackEntities.tasks) {
        context.conversationContext.lastTasks = result.trackEntities.tasks;
      }
      if (result.trackEntities.lastCreatedTaskId) {
        context.conversationContext.lastCreatedTaskId = result.trackEntities.lastCreatedTaskId;
      }
    }

    // Push undo action if provided
    if (result.success && result.undoAction) {
      context.conversationContext.undoStack = [
        result.undoAction,
        ...context.conversationContext.undoStack.slice(0, 4), // Keep last 5
      ];
    }

    return result;
  } catch (error) {
    console.error(`[ToolExecutor] Error executing ${tool.name}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Execute multiple tool calls in sequence
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  tools: Map<string, Tool>,
  context: ToolContext
): Promise<Array<{ call: ToolCall; result: ToolResult }>> {
  const results: Array<{ call: ToolCall; result: ToolResult }> = [];

  for (const call of toolCalls) {
    const tool = tools.get(call.name);

    if (!tool) {
      results.push({
        call,
        result: {
          success: false,
          error: `Unknown tool: ${call.name}`,
        },
      });
      continue;
    }

    const result = await executeTool(tool, call.parameters, context);
    results.push({ call, result });
  }

  return results;
}

/**
 * Format tool results for LLM consumption
 */
export function formatToolResults(
  results: Array<{ call: ToolCall; result: ToolResult }>
): string {
  return results
    .map(({ call, result }) => {
      if (result.success) {
        return `Tool: ${call.name}\nResult: ${JSON.stringify(result.data, null, 2)}`;
      } else {
        return `Tool: ${call.name}\nError: ${result.error}`;
      }
    })
    .join('\n\n');
}
