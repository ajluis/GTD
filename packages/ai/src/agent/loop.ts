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

  console.log('[AgentLoop] ═══════════════════════════════════════════════════════════');
  console.log('[AgentLoop] 🚀 STARTING AGENT LOOP');
  console.log('[AgentLoop] User message:', message);
  console.log('[AgentLoop] Available tools:', tools.map(t => t.name).join(', '));
  console.log('[AgentLoop] Max iterations:', maxIterations);
  console.log('[AgentLoop] ═══════════════════════════════════════════════════════════');

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
    console.log(`[AgentLoop] ────────────────────────────────────────────────────`);
    console.log(`[AgentLoop] 🔄 ITERATION ${iteration + 1}/${maxIterations}`);

    // Build full prompt
    const fullPrompt = buildFullPrompt(systemPrompt, messages, tools);
    console.log(`[AgentLoop] 📤 Sending prompt to LLM...`);

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

    console.log(`[AgentLoop] 📥 LLM raw response (first 500 chars):`);
    console.log(response.substring(0, 500));
    console.log(`[AgentLoop] Response length: ${response.length} chars`);

    // Parse response for tool calls
    console.log(`[AgentLoop] 🔍 Parsing response...`);
    const hasExistingToolResults = messages.some((m) => m.role === 'tool');
    const parsed = parseResponse(response, hasExistingToolResults, toolCalls);

    if (parsed.type === 'text') {
      // Final response
      console.log(`[AgentLoop] 💬 FINAL RESPONSE:`);
      console.log(`[AgentLoop] ${parsed.content}`);
      console.log('[AgentLoop] ═══════════════════════════════════════════════════════════');
      console.log('[AgentLoop] ✨ AGENT LOOP COMPLETE');
      console.log('[AgentLoop] Total tool calls:', toolCalls.length);
      console.log('[AgentLoop] Success: true');
      console.log('[AgentLoop] ═══════════════════════════════════════════════════════════');
      return {
        success: true,
        response: parsed.content,
        toolCalls,
        updatedContext,
      };
    }

    if (parsed.type === 'tool_calls') {
      // Execute tool calls - allow multi-step tool execution
      // The LLM may need to call lookup_tasks first, then complete_task with the found ID
      console.log(`[AgentLoop] 🛠️ Tool calls detected: ${parsed.calls.length}`);
      parsed.calls.forEach((call, i) => {
        console.log(`[AgentLoop]   ${i + 1}. ${call.name}(${JSON.stringify(call.parameters)})`);
      });

      const results: Array<{ name: string; result: ToolResult }> = [];

      for (const call of parsed.calls) {
        const tool = tools.find((t) => t.name === call.name);

        if (!tool) {
          console.log(`[AgentLoop] ❌ Unknown tool: ${call.name}`);
          results.push({
            name: call.name,
            result: { success: false, error: `Unknown tool: ${call.name}` },
          });
          continue;
        }

        console.log(`[AgentLoop] ⚙️ Executing tool: ${call.name}`);
        const result = await executeTool(tool, call.parameters, context);
        console.log(`[AgentLoop] ✅ Tool result:`, JSON.stringify(result).substring(0, 300));
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
  console.log('[AgentLoop] ═══════════════════════════════════════════════════════════');
  console.log('[AgentLoop] ⚠️ MAX ITERATIONS REACHED');
  console.log('[AgentLoop] Total tool calls:', toolCalls.length);
  console.log('[AgentLoop] Success: false');
  console.log('[AgentLoop] ═══════════════════════════════════════════════════════════');
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
⚠️ CRITICAL: RESPOND WITH PLAIN TEXT ONLY - ABSOLUTELY NO JSON ⚠️
═══════════════════════════════════════════════════════════════

Tool execution is COMPLETE. Now provide your FINAL response as plain text.

STRICT RULES:
- NEVER output JSON, arrays like [...], or objects like {...}
- NEVER wrap your response in quotes or braces
- NEVER include field names like "response:", "message:", or "text:"
- NEVER return tool call syntax - tools have already been executed
- NEVER return array indices like [0] or ["0"] or [1, 2, 3]
- Just write plain, natural text like a human texting back
- Keep it under 320 characters
- Use emojis sparingly: ✅ ⏳ 👤 📋

✓ CORRECT: ✅ Added: Buy groceries
✓ CORRECT: Here's your agenda for tomorrow:
1. Team standup at 9am
2. Review proposal
✗ WRONG: {"response": "Added: Buy groceries"}
✗ WRONG: [{"tool": "update_task", ...}]
✗ WRONG: ["0"]
✗ WRONG: [0, 1, 2]
✗ WRONG: "message": "Done"

Summarize what happened based on the tool results above.
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
 * @param response - Raw LLM response
 * @param hasToolResults - Whether we already have tool results in the conversation
 * @param existingToolCalls - Previous tool calls and their results (for synthesizing responses)
 */
function parseResponse(
  response: string,
  hasToolResults: boolean = false,
  existingToolCalls: AgentResult['toolCalls'] = []
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

      // Handle arrays of primitives (e.g., ['0'], [0], ['text'])
      // LLM sometimes returns indices or simple values in array format when confused
      // IMPORTANT: This must be handled BEFORE the final JSON safety check
      if (Array.isArray(parsed)) {
        // Check if it's an array with objects containing text fields (e.g., [{text: "..."}])
        // Gemini sometimes wraps text responses in this format
        if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
          const firstItem = parsed[0] as Record<string, unknown>;
          const textFields = ['text', 'response', 'message', 'content', 'reply', 'answer'];
          for (const field of textFields) {
            if (firstItem[field] && typeof firstItem[field] === 'string') {
              console.log('[AgentLoop] Extracted text from array object:', (firstItem[field] as string).substring(0, 100));
              return { type: 'text', content: firstItem[field] as string };
            }
          }
        }

        // Check if it's an array of primitives (strings or numbers)
        if (parsed.every(item => typeof item === 'string' || typeof item === 'number')) {
          // If it looks like just indices (all numbers or numeric strings), this is likely an error
          // Gemini sometimes returns task indices instead of formatting a proper response
          if (parsed.every(item => typeof item === 'number' || /^\d+$/.test(String(item)))) {
            console.warn('[AgentLoop] LLM returned array of indices, likely confused:', parsed);
            // Return a helpful message instead of the fallback error
            return {
              type: 'text',
              content: "I found what you asked for but need to format the response. Let me try again - please repeat your question."
            };
          }
          // If it's an array of text strings, join them as the response
          const joined = parsed.join(', ');
          console.log('[AgentLoop] Converted primitive array to text:', joined.substring(0, 100));
          return { type: 'text', content: joined };
        }
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

        // Check if it looks like a tasks list (common for lookups)
        if (parsed.tasks && Array.isArray(parsed.tasks)) {
          const tasks = parsed.tasks as Array<{ title?: string; content?: string; name?: string }>;
          if (tasks.length === 0) {
            return { type: 'text', content: '✅ No tasks found.' };
          }
          const taskList = tasks
            .slice(0, 10) // Limit to 10 for SMS
            .map((t, i) => `${i + 1}. ${t.title || t.content || t.name || 'Task'}`)
            .join('\n');
          const suffix = tasks.length > 10 ? `\n...and ${tasks.length - 10} more` : '';
          return { type: 'text', content: `📋 Tasks:\n${taskList}${suffix}` };
        }

        // Check for count-style responses
        if (typeof parsed.count === 'number') {
          return { type: 'text', content: `Found ${parsed.count} item(s).` };
        }

        // Check for success/error responses
        if (parsed.success === true) {
          return { type: 'text', content: '✅ Done!' };
        }
        if (parsed.success === false && parsed.error) {
          return { type: 'text', content: `❌ Error: ${parsed.error}` };
        }

        // Last resort: don't return raw JSON, ask for clarification
        console.warn('[AgentLoop] LLM returned unexpected JSON structure:', {
          keys: Object.keys(parsed),
          parsedType: typeof parsed,
          isArray: Array.isArray(parsed),
          preview: JSON.stringify(parsed).substring(0, 200),
        });
        return { type: 'text', content: "I processed your request but couldn't format the response. Please try again." };
      }
    }
  } catch {
    // JSON parsing failed - check if it looks like malformed JSON/tool calls
    // This catches cases where Gemini returns truncated or malformed JSON
    if (trimmed.includes('"tool"') || trimmed.includes('"tool_calls"') || trimmed.includes('"parameters"')) {
      console.warn('[AgentLoop] LLM returned malformed JSON that looks like tool calls');

      // Try to repair truncated JSON and extract tool call
      const repaired = tryRepairToolCallJson(trimmed);
      if (repaired) {
        console.log('[AgentLoop] Successfully repaired truncated tool call');
        return {
          type: 'tool_calls',
          calls: [repaired],
        };
      }

      // If repair failed but we have existing tool results, synthesize from them
      if (hasToolResults && existingToolCalls.length > 0) {
        console.log('[AgentLoop] Synthesizing response from existing tool results');
        const lastCall = existingToolCalls[existingToolCalls.length - 1]!;
        if (lastCall.result.success && lastCall.result.data) {
          const data = lastCall.result.data as any;
          if (data.tasks && Array.isArray(data.tasks)) {
            if (data.tasks.length === 0) {
              return { type: 'text', content: "📋 No tasks found." };
            }
            const taskList = data.tasks.slice(0, 5).map((t: any, i: number) =>
              `${i + 1}. ${t.title}${t.dueString ? ` (${t.dueString})` : ''}`
            ).join('\n');
            return { type: 'text', content: `📋 Tasks:\n${taskList}` };
          }
          if (data.people && Array.isArray(data.people)) {
            if (data.people.length === 0) {
              return { type: 'text', content: "👤 No people found." };
            }
            return { type: 'text', content: `Found ${data.people.length} person(s).` };
          }
        }
        return { type: 'text', content: "✅ Found what you asked for. Please try asking again for details." };
      }

      return { type: 'text', content: "I processed your request but couldn't format the response. Please try again." };
    }
  }

  // Final safety check: never return text that looks like JSON to users
  // This catches any edge cases where JSON slipped through
  // NOTE: This runs AFTER successful JSON parsing, so it only catches unparseable JSON-like strings
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    console.warn('[AgentLoop] Response looks like JSON but was not parsed, returning fallback');
    return { type: 'text', content: "I processed your request but couldn't format the response. Please try again." };
  }

  // Return as plain text response
  return { type: 'text', content: trimmed };
}

/**
 * Attempt to repair truncated JSON tool call
 * Extracts tool name and parameters using regex when JSON.parse fails
 */
function tryRepairToolCallJson(json: string): ParsedToolCall | null {
  try {
    // Extract tool name
    const toolNameMatch = json.match(/"(?:tool|name)"\s*:\s*"([^"]+)"/);
    if (!toolNameMatch) return null;

    const toolName = toolNameMatch[1];
    const parameters: Record<string, unknown> = {};

    // Extract common parameters using regex
    // Title (for task creation) - handle truncated strings
    const titleMatch = json.match(/"title"\s*:\s*"([^"]*)/);
    if (titleMatch) {
      parameters['title'] = titleMatch[1];
    }

    // PersonName
    const personMatch = json.match(/"personName"\s*:\s*"([^"]+)"/);
    if (personMatch) {
      parameters['personName'] = personMatch[1];
    }

    // Due date
    const dueMatch = json.match(/"dueDate"\s*:\s*"([^"]+)"/);
    if (dueMatch) {
      parameters['dueDate'] = dueMatch[1];
    }

    // Context
    const contextMatch = json.match(/"context"\s*:\s*"([^"]+)"/);
    if (contextMatch) {
      parameters['context'] = contextMatch[1];
    }

    // Type
    const typeMatch = json.match(/"type"\s*:\s*"([^"]+)"/);
    if (typeMatch) {
      parameters['type'] = typeMatch[1];
    }

    // Validate we have minimum required data
    if (toolName && Object.keys(parameters).length > 0) {
      console.log('[AgentLoop] Repaired truncated tool call:', { toolName, parameters });
      return { name: toolName, parameters };
    }

    return null;
  } catch {
    return null;
  }
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
