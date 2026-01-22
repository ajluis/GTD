/**
 * Unified Classification Processor
 *
 * Uses the new fully agentic architecture:
 * - Todoist as source of truth (via REST API)
 * - Rich context for intelligent inference
 * - Memory for long-term learning
 * - Inference engine for smart defaults
 *
 * This replaces classify-hybrid.ts when ready.
 */

import type { Job } from 'bullmq';
import type { ClassifyJobData, MessageJobData } from '@gtd/queue';
import { enqueueOutboundMessage } from '@gtd/queue';
import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users, messages } from '@gtd/database';
import { eq } from 'drizzle-orm';
import { TodoistClient } from '@gtd/todoist';

// New unified architecture imports
import { createUnifiedAgent, type UnifiedAgentConfig } from '@gtd/ai';

/**
 * Unified Classification Processor
 *
 * This processor uses the UnifiedAgent which:
 * 1. Loads rich context (preferences, patterns, memories)
 * 2. Applies inference (rule-based project/label suggestions)
 * 3. Runs the agent loop with MCP + internal tools
 * 4. Learns from corrections and stores memories
 */
export function createUnifiedClassifyProcessor(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
) {
  return async (job: Job<ClassifyJobData>) => {
    const { userId, messageId, content } = job.data;

    console.log(`[UnifiedClassify] Processing message ${messageId} for user ${userId}`);

    // 1. Get user
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const timezone = user.timezone ?? 'America/New_York';

    // 2. Create Todoist client if user has access token
    const todoistClient = user.todoistAccessToken
      ? new TodoistClient(user.todoistAccessToken)
      : undefined;

    if (!todoistClient) {
      console.warn(`[UnifiedClassify] User ${userId} has no Todoist access token`);
    }

    // 3. Create unified agent
    const agentConfig: UnifiedAgentConfig = {
      db,
      userId,
      timezone,
      todoistClient,
      enableInference: true,
      enableMemory: true,
      enableLearning: true,
      maxIterations: 5,
    };

    const agent = createUnifiedAgent(agentConfig);

    // 3. Handle the message
    let response: string;
    try {
      const result = await agent.handleMessage(content);

      response = sanitizeResponse(result.response);

      // Log what happened
      console.log(`[UnifiedClassify] Success:`, {
        messageId,
        toolCalls: result.toolCalls.length,
        memoryStored: result.memoryStored,
        learningApplied: result.learningApplied,
        inferenceConfidence: result.inference?.overallConfidence,
      });

      // Update message with classification result
      // Note: Using 'as any' since unified agent uses a custom structure
      await db
        .update(messages)
        .set({
          classification: {
            type: 'unified_agent',
            toolCalls: result.toolCalls.map((tc) => tc.tool),
            inference: result.inference
              ? {
                  project: result.inference.project?.value,
                  labels: result.inference.labels?.value,
                  confidence: result.inference.overallConfidence,
                }
              : null,
          } as any,
        })
        .where(eq(messages.id, messageId));

      // Update user stats if task was created
      const taskCreated = result.toolCalls.some(
        (tc) => tc.tool.includes('create') && tc.result.success
      );
      if (taskCreated) {
        await db
          .update(users)
          .set({
            totalTasksCaptured: (user.totalTasksCaptured ?? 0) + 1,
            lastMessageAt: new Date(),
          })
          .where(eq(users.id, userId));
      }
    } catch (error) {
      console.error(`[UnifiedClassify] Error:`, error);
      response = "Sorry, I had trouble processing that. Please try again.";
    }

    // 4. Send response
    await enqueueOutboundMessage(messageQueue, {
      userId,
      toNumber: user.phoneNumber,
      content: response,
      inReplyTo: messageId,
    });

    console.log(`[UnifiedClassify] Response queued for message ${messageId}`);
  };
}

/**
 * Sanitize response to ensure we never send raw JSON to users
 *
 * This is a safety check to catch any malformed LLM responses
 * that might contain raw JSON instead of human-readable text.
 */
function sanitizeResponse(response: string): string {
  const trimmed = response.trim();

  // Check if response looks like JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);

      // Handle array format tool calls: [{"tool": "...", "parameters": {...}}]
      // This is what Gemini sometimes returns instead of proper text
      if (Array.isArray(parsed)) {
        // Check if it looks like tool calls
        if (parsed.length > 0 && (parsed[0].tool || parsed[0].name || parsed[0].tool_calls)) {
          console.warn('[UnifiedClassify] Response contained raw array tool_calls JSON, returning fallback');
          return "I processed your request but couldn't format a response. Please try again.";
        }
        // It's some other array - shouldn't be sent to user
        console.warn('[UnifiedClassify] Response was an array, returning fallback');
        return "Done! Your request has been processed.";
      }

      // If it's a tool_calls structure (object format), something went wrong
      if (parsed.tool_calls) {
        console.warn('[UnifiedClassify] Response contained raw tool_calls JSON, returning fallback');
        return "I processed your request but couldn't format a response. Please try again.";
      }

      // Try to extract a message from common response structures
      const textFields = ['response', 'message', 'text', 'content', 'reply', 'data'];
      for (const field of textFields) {
        if (parsed[field] && typeof parsed[field] === 'string') {
          return parsed[field];
        }
        // Handle nested data.message
        if (parsed[field] && typeof parsed[field] === 'object' && parsed[field].message) {
          return parsed[field].message;
        }
      }

      // If it's a success response, try to extract useful info
      if (parsed.success === true && parsed.data?.message) {
        return parsed.data.message;
      }

      // Last resort for JSON that we can't parse meaningfully
      console.warn('[UnifiedClassify] Response was unparseable JSON:', Object.keys(parsed));
      return "Done! Your request has been processed.";
    } catch {
      // Malformed JSON - definitely shouldn't be sent to user
      // Check if it looks like it was trying to be tool calls
      if (trimmed.includes('"tool"') || trimmed.includes('"tool_calls"') || trimmed.includes('"parameters"')) {
        console.warn('[UnifiedClassify] Response contained malformed tool JSON, returning fallback');
        return "I processed your request but couldn't format a response. Please try again.";
      }
      // Might just start with { or [ by coincidence, fall through
    }
  }

  // Check for embedded JSON in the response (LLM sometimes wraps JSON in text)
  // Check for both object format {"tool_calls": ...} and array format [{"tool": ...}]
  const objectJsonMatch = trimmed.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  const arrayJsonMatch = trimmed.match(/\[\s*\{[\s\S]*"tool"[\s\S]*\}\s*\]/);

  if (objectJsonMatch || arrayJsonMatch) {
    const jsonMatch = objectJsonMatch || arrayJsonMatch;
    console.warn('[UnifiedClassify] Response contained embedded tool JSON, cleaning');
    // Remove the JSON part and return the rest
    const cleaned = trimmed.replace(jsonMatch![0], '').trim();
    if (cleaned.length > 10) {
      return cleaned;
    }
    return "I processed your request but couldn't format a response. Please try again.";
  }

  return trimmed;
}

/**
 * Migration Strategy
 *
 * To switch from hybrid to unified processing:
 *
 * 1. In apps/worker/src/index.ts, change:
 *    - from: createHybridClassifyProcessor(db, messageQueue)
 *    - to:   createUnifiedClassifyProcessor(db, messageQueue)
 *
 * 2. To enable MCP (optional, can be done later):
 *    - Uncomment the connectTodoist import
 *    - Uncomment the todoistMCP config
 *
 * 3. The hybrid processor can be kept as fallback:
 *    - Use feature flag to switch between them
 *    - Gradually roll out unified to users
 */
