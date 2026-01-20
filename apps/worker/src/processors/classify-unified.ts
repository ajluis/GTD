/**
 * Unified Classification Processor
 *
 * Uses the new fully agentic architecture:
 * - MCP tools for Todoist operations (source of truth)
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
import { eq, desc } from 'drizzle-orm';

// New unified architecture imports
import { createUnifiedAgent, type UnifiedAgentConfig } from '@gtd/ai';

// MCP imports (optional - for MCP-based Todoist operations)
// import { connectTodoist } from '@gtd/mcp';

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

    // 2. Create unified agent
    const agentConfig: UnifiedAgentConfig = {
      db,
      userId,
      timezone,
      // MCP client for Todoist (uncomment when ready to use MCP)
      // todoistMCP: user.todoistAccessToken
      //   ? await connectTodoist(user.todoistAccessToken)
      //   : undefined,
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

      response = result.response;

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
