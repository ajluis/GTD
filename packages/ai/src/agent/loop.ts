/**
 * Agent Loop
 * Executes the tool-enabled LLM conversation loop
 */

import { createGeminiClient, GeminiClient } from '../gemini-client.js';
import type {
  Tool,
  ToolContext,
  ToolResult,
  AgentResult,
  ConversationContext,
} from '../tools/types.js';
import { toolRegistry, formatToolsForPrompt } from '../tools/index.js';
import { executeTool } from '../tools/executor.js';
import { buildAgentSystemPrompt, buildToolResultsPrompt } from './prompts.js';

/**
 * Options for running the agent loop
 */
export interface AgentLoopOptions {
  /** User's message */
  message: string;
  /** Tools available to the agent */
  tools: Tool[];
  /** Tool execution context */
  context: ToolContext;
  /** Maximum iterations (tool call rounds) */
  maxIterations?: number;
}

/**
 * Message in the conversation
 */
interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Parsed tool call from LLM response
 */
interface ParsedToolCall {
  name: string;
  parameters: Record<string, unknown>;
}

/**
 * Run the agent loop
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentResult> {
  const { message, tools, context, maxIterations = 5 } = options;

  const client = createGeminiClient();
  const toolCalls: AgentResult['toolCalls'] = [];
  const updatedContext: Partial<ConversationContext> = {};

  // Build system prompt
  const systemPrompt = buildAgentSystemPrompt(
    tools,
    context.timezone,
    new Date(),
    context.conversationContext
  );

  // Initialize conversation
  const messages: Message[] = [{ role: 'user', content: message }];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // Build full prompt
    const fullPrompt = buildFullPrompt(systemPrompt, messages, tools);

    // Get LLM response
    let response: string;
    try {
      response = await client.generate(fullPrompt);
    } catch (error) {
      console.error('[AgentLoop] LLM error:', error);
      return {
        success: false,
        response: "I'm having trouble processing your request. Please try again.",
        toolCalls,
        updatedContext,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // Parse response for tool calls
    const parsed = parseResponse(response);

    if (parsed.type === 'text') {
      // Final response
      return {
        success: true,
        response: parsed.content,
        toolCalls,
        updatedContext,
      };
    }

    if (parsed.type === 'tool_calls') {
      // Execute tool calls
      const results: Array<{ name: string; result: ToolResult }> = [];

      for (const call of parsed.calls) {
        const tool = tools.find((t) => t.name === call.name);

        if (!tool) {
          results.push({
            name: call.name,
            result: { success: false, error: `Unknown tool: ${call.name}` },
          });
          continue;
        }

        const result = await executeTool(tool, call.parameters, context);
        results.push({ name: call.name, result });

        // Track tool calls
        toolCalls.push({
          tool: call.name,
          params: call.parameters,
          result,
        });

        // Update context from tool results
        if (result.trackEntities) {
          if (result.trackEntities.tasks) {
            updatedContext.lastTasks = result.trackEntities.tasks;
            context.conversationContext.lastTasks = result.trackEntities.tasks;
          }
          if (result.trackEntities.people) {
            updatedContext.lastPeople = result.trackEntities.people;
            context.conversationContext.lastPeople = result.trackEntities.people;
          }
          if (result.trackEntities.lastCreatedTaskId) {
            updatedContext.lastCreatedTaskId = result.trackEntities.lastCreatedTaskId;
            context.conversationContext.lastCreatedTaskId = result.trackEntities.lastCreatedTaskId;
          }
        }
      }

      // Add tool results to conversation
      messages.push({
        role: 'assistant',
        content: `Tool calls:\n${parsed.calls.map((c) => `${c.name}(${JSON.stringify(c.parameters)})`).join('\n')}`,
      });

      messages.push({
        role: 'tool',
        content: results
          .map(
            (r) =>
              `${r.name}: ${r.result.success ? JSON.stringify(r.result.data) : `Error: ${r.result.error}`}`
          )
          .join('\n\n'),
      });
    }
  }

  // Max iterations reached
  return {
    success: false,
    response: "I'm having trouble completing your request. Please try rephrasing.",
    toolCalls,
    updatedContext,
    error: 'Max iterations reached',
  };
}

/**
 * Build full prompt from system, messages, and tools
 */
function buildFullPrompt(
  systemPrompt: string,
  messages: Message[],
  tools: Tool[]
): string {
  // Check if we already have tool results
  const hasToolResults = messages.some((m) => m.role === 'tool');

  const toolInstructions = hasToolResults
    ? `
═══════════════════════════════════════════════════════════════
CRITICAL: RESPOND WITH PLAIN TEXT ONLY - NO JSON
═══════════════════════════════════════════════════════════════

Tool results are above. Now write a SHORT, PLAIN TEXT response for SMS.

RULES:
- DO NOT use JSON format
- DO NOT wrap response in quotes or braces
- DO NOT include field names like "response:" or "message:"
- Just write plain text like a human would text back
- Keep it under 320 characters
- Use emojis sparingly: ✅ ⏳ 👤

GOOD: "✅ Added: Buy groceries"
BAD: {"response": "Added: Buy groceries"}
BAD: "response": "Added: Buy groceries"
`
    : `
═══════════════════════════════════════════════════════════════
TOOL USAGE INSTRUCTIONS
═══════════════════════════════════════════════════════════════

To use a tool, respond with JSON in this exact format:
{
  "tool_calls": [
    { "name": "tool_name", "parameters": { "param1": "value1" } }
  ]
}

You can call multiple tools in one response.
After tool results, provide a final text response to the user.

If you have all the information needed, respond with plain text (no JSON).
`;

  const conversationStr = messages
    .map((m) => {
      switch (m.role) {
        case 'user':
          return `USER: ${m.content}`;
        case 'assistant':
          return `ASSISTANT: ${m.content}`;
        case 'tool':
          return `TOOL RESULTS:\n${m.content}`;
      }
    })
    .join('\n\n');

  return `${systemPrompt}

${toolInstructions}

═══════════════════════════════════════════════════════════════
CONVERSATION
═══════════════════════════════════════════════════════════════

${conversationStr}

ASSISTANT:`;
}

/**
 * Parse LLM response for tool calls or final text
 */
function parseResponse(
  response: string
): { type: 'text'; content: string } | { type: 'tool_calls'; calls: ParsedToolCall[] } {
  const trimmed = response.trim();

  // Try to parse as JSON with tool_calls
  try {
    // Remove markdown code blocks if present
    let jsonStr = trimmed;
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7);
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3);
    }
    jsonStr = jsonStr.trim();

    // Only try to parse if it looks like JSON (object or array)
    if (jsonStr.startsWith('{') || jsonStr.startsWith('[')) {
      const parsed = JSON.parse(jsonStr);

      // Handle array format: [{"tool": "...", "parameters": {...}}]
      // This is what Gemini sometimes returns
      if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0].tool || parsed[0].name)) {
        return {
          type: 'tool_calls',
          calls: parsed.map((call: any) => ({
            name: call.name || call.tool, // Handle both "name" and "tool" keys
            parameters: call.parameters || call.params || {},
          })),
        };
      }

      // Handle object format: {"tool_calls": [{"name": "...", "parameters": {...}}]}
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return {
          type: 'tool_calls',
          calls: parsed.tool_calls.map((call: any) => ({
            name: call.name || call.tool,
            parameters: call.parameters || call.params || {},
          })),
        };
      }

      // Handle various text response formats from LLM
      // Try common field names for text responses
      const textFields = ['response', 'message', 'text', 'content', 'reply', 'answer'];
      for (const field of textFields) {
        if (parsed[field] && typeof parsed[field] === 'string') {
          return { type: 'text', content: parsed[field] };
        }
      }

      // If it's a JSON object but not tool_calls and no text field found,
      // it might be structured data the LLM returned incorrectly.
      // Try to extract a meaningful summary or return as formatted text
      if (typeof parsed === 'object' && parsed !== null) {
        // Check if it looks like task data being returned raw
        if (parsed.title || parsed.task || parsed.name) {
          const taskName = parsed.title || parsed.task || parsed.name;
          return { type: 'text', content: `Added: ${taskName}` };
        }

        // Last resort: don't return raw JSON, ask for clarification
        console.warn('[AgentLoop] LLM returned unexpected JSON structure:', Object.keys(parsed));
      }
    }
  } catch {
    // Not JSON, treat as text
  }

  // Return as plain text response
  return { type: 'text', content: trimmed };
}

/**
 * Create agent runner with default configuration
 */
export function createAgentRunner(context: ToolContext, tools?: Tool[]) {
  const defaultTools = tools ?? Array.from(toolRegistry.values());

  return {
    run: (message: string) =>
      runAgentLoop({
        message,
        tools: defaultTools,
        context,
      }),
  };
}
