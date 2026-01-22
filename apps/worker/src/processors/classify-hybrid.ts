/**
 * Hybrid Classification Processor
 *
 * Uses the new hybrid architecture:
 * - Fast classification without full people list
 * - Tool-enabled agent loop for complex queries
 * - Direct execution for simple operations
 */

import type { Job } from 'bullmq';
import type { ClassifyJobData, MessageJobData } from '@gtd/queue';
import { enqueueTodoistSync, enqueueOutboundMessage } from '@gtd/queue';
import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users, messages, tasks } from '@gtd/database';
import { eq, desc } from 'drizzle-orm';

// New hybrid architecture imports
import {
  createFastClassifier,
  type FastClassifyOptions,
  runAgentLoop,
  createContextManager,
  toolSets,
  createTask as createTaskTool,
  batchCreateTasks as batchCreateTasksTool,
  type ToolContext,
  type FastClassifyResult,
} from '@gtd/ai';

// Legacy imports for direct execution
import { formatTaskCapture, formatHelp } from '@gtd/gtd';

// Todoist imports for dynamic project routing
import {
  createTodoistClient,
  discoverTodoistStructure,
  getProjectNames,
} from '@gtd/todoist';

/**
 * Hybrid Classification Processor
 */
export function createHybridClassifyProcessor(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
) {
  const fastClassifier = createFastClassifier();
  const contextManager = createContextManager(db);

  return async (job: Job<ClassifyJobData>) => {
    const { userId, messageId, content } = job.data;

    console.log(`[HybridClassify] Processing message ${messageId} for user ${userId}`);

    // 1. Get user
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // 2. Get minimal recent context (last 3 messages)
    const recentMessages = await db.query.messages.findMany({
      where: eq(messages.userId, userId),
      orderBy: [desc(messages.createdAt)],
      limit: 3,
    });

    const recentContext = recentMessages.reverse().map((m) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    }));

    // 2.5. Get Todoist project names for AI routing (if user connected)
    let availableProjects: string[] = [];
    if (user.todoistAccessToken) {
      try {
        const todoist = createTodoistClient(user.todoistAccessToken);
        const structure = await discoverTodoistStructure(todoist);
        availableProjects = getProjectNames(structure);
        console.log(`[HybridClassify] Discovered ${availableProjects.length} Todoist projects for routing`);
      } catch (error) {
        console.warn('[HybridClassify] Could not fetch Todoist projects:', error);
        // Continue without project routing - tasks will go to Inbox
      }
    }

    // 3. Fast classification with available projects
    const classification = await fastClassifier.classify({
      message: content,
      timezone: user.timezone,
      currentTime: new Date(),
      recentMessages: recentContext,
      availableProjects,
    });

    console.log(`[HybridClassify] Result: ${classification.type} (needsDataLookup: ${classification.needsDataLookup})`);

    // 4. Store classification
    await db
      .update(messages)
      .set({ classification: classification as any })
      .where(eq(messages.id, messageId));

    // 5. Route based on classification
    let response: string;

    try {
      if (classification.type === 'multi_item' && classification.items) {
        // Multi-item brain dump
        response = await handleMultiItem(classification, user, db, messageQueue);
      } else if (!classification.needsDataLookup) {
        // Fast path: Direct execution
        response = await handleDirectExecution(classification, user, db, messageQueue, content);
      } else {
        // Slow path: Tool-enabled agent
        response = await handleWithTools(content, classification, user, db, contextManager);
      }
    } catch (error) {
      console.error('[HybridClassify] Processing error:', error);
      response = "I had trouble processing your message. Please try again or text 'help' for options.";
    }

    // 6. Send response
    await enqueueOutboundMessage(messageQueue, {
      userId,
      toNumber: user.phoneNumber,
      content: response,
      inReplyTo: messageId,
    });

    return {
      success: true,
      type: classification.type,
      needsDataLookup: classification.needsDataLookup,
      confidence: classification.confidence,
    };
  };
}

/**
 * Handle multi-item brain dump
 * Simplified: stores personName directly instead of resolving to people table
 */
async function handleMultiItem(
  classification: FastClassifyResult,
  user: any,
  db: DbClient,
  messageQueue: Queue<MessageJobData>
): Promise<string> {
  const items = classification.items || [];

  if (items.length === 0) {
    return "I couldn't parse any items from your message. Try listing them with bullet points or line breaks.";
  }

  const createdTasks: Array<{ title: string; type: string; personName?: string }> = [];
  const errors: string[] = [];

  for (const item of items) {
    try {
      // Create task with personName directly
      const [task] = await db
        .insert(tasks)
        .values({
          userId: user.id,
          rawText: item.title || '',
          title: item.title || 'Untitled task',
          type: (item.type as any) || 'action',
          status: 'pending',
          context: (item.context as any) || null,
          priority: (item.priority as any) || null,
          dueDate: item.dueDate || null,
          personName: item.personName || null,
        })
        .returning();

      // Queue for Todoist sync with project routing
      await enqueueTodoistSync(messageQueue, {
        userId: user.id,
        taskId: task!.id,
        classification: {
          type: item.type as any,
          title: item.title,
          confidence: classification.confidence,
          context: item.context as any,
          priority: item.priority as any,
          dueDate: item.dueDate,
          targetProject: item.targetProject,
        },
      });

      createdTasks.push({
        title: task!.title,
        type: task!.type,
        personName: item.personName,
      });
    } catch (error) {
      console.error('[MultiItem] Error creating task:', error);
      errors.push(item.title || 'Unknown item');
    }
  }

  // Update user stats
  if (createdTasks.length > 0) {
    await db
      .update(users)
      .set({
        totalTasksCaptured: (user.totalTasksCaptured ?? 0) + createdTasks.length,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  }

  // Format response
  const typeEmojis: Record<string, string> = {
    action: '✅',
    waiting: '⏳',
    agenda: '👤',
    project: '📁',
    someday: '💭',
  };

  const lines = createdTasks.map((t) => {
    const emoji = typeEmojis[t.type] || '✅';
    const personSuffix = t.personName ? ` (${t.personName})` : '';
    return `${emoji} ${t.title}${personSuffix}`;
  });

  if (errors.length > 0) {
    lines.push(`\n⚠️ Couldn't capture: ${errors.join(', ')}`);
  }

  return `Got ${createdTasks.length} items:\n\n${lines.join('\n')}`;
}

/**
 * Handle direct execution (fast path)
 * Simplified: stores personName directly instead of resolving to people table
 */
async function handleDirectExecution(
  classification: FastClassifyResult,
  user: any,
  db: DbClient,
  messageQueue: Queue<MessageJobData>,
  rawText: string
): Promise<string> {
  // Handle simple task capture
  if (classification.type === 'task' && classification.taskCapture) {
    const task = classification.taskCapture;

    // Create task with personName directly
    const [created] = await db
      .insert(tasks)
      .values({
        userId: user.id,
        rawText,
        title: task.title || rawText,
        type: (task.type as any) || 'action',
        status: 'pending',
        context: (task.context as any) || null,
        priority: (task.priority as any) || null,
        dueDate: task.dueDate || null,
        personName: task.personName || null,
      })
      .returning();

    // Update user stats
    await db
      .update(users)
      .set({
        totalTasksCaptured: (user.totalTasksCaptured ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Queue for Todoist sync with project routing
    await enqueueTodoistSync(messageQueue, {
      userId: user.id,
      taskId: created!.id,
      classification: {
        type: task.type as any,
        title: task.title,
        confidence: classification.confidence,
        context: task.context as any,
        priority: task.priority as any,
        dueDate: task.dueDate,
        targetProject: task.targetProject,
      },
    });

    return formatTaskCapture(
      task.title || rawText,
      task.type as any,
      task.context as any,
      task.priority as any,
      task.dueDate,
      task.personName
    );
  }

  // Handle simple intents that don't need data lookup
  if (classification.type === 'intent' && classification.intent) {
    const intent = classification.intent;

    switch (intent.type) {
      case 'show_help':
        return formatHelp();

      // Other simple intents can be added here
      // Most intents will fall through to the tool-enabled path
    }
  }

  // Handle needs_clarification
  if (classification.type === 'needs_clarification' && classification.clarificationQuestion) {
    return classification.clarificationQuestion;
  }

  // Fallback
  return formatHelp();
}

/**
 * Handle with tool-enabled agent (slow path)
 */
async function handleWithTools(
  message: string,
  classification: FastClassifyResult,
  user: any,
  db: DbClient,
  contextManager: ReturnType<typeof createContextManager>
): Promise<string> {
  // Get conversation context
  const conversationContext = await contextManager.get(user.id);

  // Build tool context
  const toolContext: ToolContext = {
    userId: user.id,
    db,
    todoistClient: user.todoistAccessToken
      ? createTodoistClient(user.todoistAccessToken)
      : null,
    timezone: user.timezone,
    conversationContext,
  };

  // Determine which tools to use based on classification
  let tools = toolSets.full;

  if (classification.intent?.type?.startsWith('query_')) {
    tools = toolSets.query;
  } else if (classification.intent?.type?.includes('batch') || classification.intent?.type?.includes('all')) {
    tools = toolSets.batch;
  }

  // Run agent loop
  const result = await runAgentLoop({
    message,
    tools,
    context: toolContext,
    maxIterations: 4,
  });

  // Update conversation context
  if (result.updatedContext) {
    await contextManager.update(user.id, result.updatedContext);
  }

  return result.response;
}
