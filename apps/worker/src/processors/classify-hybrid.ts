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
import { enqueueNotionSync, enqueueOutboundMessage } from '@gtd/queue';
import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users, messages, tasks, people } from '@gtd/database';
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
import { createNotionClient } from '@gtd/notion';

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

    // 3. Fast classification
    const classification = await fastClassifier.classify({
      message: content,
      timezone: user.timezone,
      currentTime: new Date(),
      recentMessages: recentContext,
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

  // Get user's people for name resolution
  const userPeople = await db.query.people.findMany({
    where: eq(people.userId, user.id),
  });

  const createdTasks: Array<{ title: string; type: string; personName?: string }> = [];
  const errors: string[] = [];

  for (const item of items) {
    try {
      // Resolve person
      let personId: string | null = null;
      let resolvedPersonName: string | undefined;

      if (item.personName) {
        const match = userPeople.find(
          (p) =>
            p.name.toLowerCase() === item.personName!.toLowerCase() ||
            p.aliases?.some((a) => a.toLowerCase() === item.personName!.toLowerCase())
        );

        if (match) {
          personId = match.id;
          resolvedPersonName = match.name;
        } else if (item.type === 'agenda' || item.type === 'waiting') {
          // Auto-create person
          const [newPerson] = await db
            .insert(people)
            .values({
              userId: user.id,
              name: item.personName,
              active: true,
            })
            .returning();

          if (newPerson) {
            personId = newPerson.id;
            resolvedPersonName = newPerson.name;
            userPeople.push(newPerson); // Add to local cache
          }
        }
      }

      // Create task
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
          personId,
        })
        .returning();

      // Queue for Notion sync
      await enqueueNotionSync(messageQueue, {
        userId: user.id,
        taskId: task!.id,
        classification: {
          type: item.type as any,
          title: item.title,
          confidence: classification.confidence,
          context: item.context as any,
          priority: item.priority as any,
          dueDate: item.dueDate,
        },
      });

      createdTasks.push({
        title: task!.title,
        type: task!.type,
        personName: resolvedPersonName,
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

    // Resolve person if needed
    let personId: string | null = null;
    let resolvedPersonName: string | undefined;

    if (task.personName) {
      const userPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const match = userPeople.find(
        (p) =>
          p.name.toLowerCase() === task.personName!.toLowerCase() ||
          p.aliases?.some((a) => a.toLowerCase() === task.personName!.toLowerCase())
      );

      if (match) {
        personId = match.id;
        resolvedPersonName = match.name;
      } else if (task.type === 'agenda' || task.type === 'waiting') {
        // Auto-create person
        const [newPerson] = await db
          .insert(people)
          .values({
            userId: user.id,
            name: task.personName,
            active: true,
          })
          .returning();

        if (newPerson) {
          personId = newPerson.id;
          resolvedPersonName = newPerson.name;
        }
      }
    }

    // Create task
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
        personId,
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

    // Queue for Notion sync
    await enqueueNotionSync(messageQueue, {
      userId: user.id,
      taskId: created!.id,
      classification: {
        type: task.type as any,
        title: task.title,
        confidence: classification.confidence,
        context: task.context as any,
        priority: task.priority as any,
        dueDate: task.dueDate,
      },
    });

    return formatTaskCapture(
      task.title || rawText,
      task.type as any,
      task.context as any,
      task.priority as any,
      task.dueDate,
      resolvedPersonName
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
    notionClient: user.notionAccessToken
      ? createNotionClient(user.notionAccessToken)
      : null,
    notionTasksDatabaseId: user.notionTasksDatabaseId,
    notionPeopleDatabaseId: user.notionPeopleDatabaseId,
    timezone: user.timezone,
    conversationContext,
  };

  // Determine which tools to use based on classification
  let tools = toolSets.full;

  if (classification.intent?.type?.startsWith('query_')) {
    tools = toolSets.query;
  } else if (classification.intent?.type?.includes('person')) {
    tools = toolSets.people;
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
