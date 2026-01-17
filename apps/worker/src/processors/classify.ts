import type { Job } from 'bullmq';
import type { ClassifyJobData, MessageJobData } from '@gtd/queue';
import { enqueueNotionSync, enqueueOutboundMessage } from '@gtd/queue';
import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import { users, messages, tasks, people, conversationStates } from '@gtd/database';
import { eq, desc, and } from 'drizzle-orm';
import { createClassifier, findBestFuzzyMatch, formatDidYouMean, type ConversationMessage } from '@gtd/ai';
import {
  createNotionClient,
  createPerson as createNotionPerson,
  queryTasksDueToday,
  queryActiveActions,
  queryActiveProjects,
  queryWaitingTasks,
  querySomedayTasks,
  queryTasksByContext,
  queryAgendaForPerson,
  findTaskByText,
  completeTask,
  extractTaskTitle,
  extractTaskDueDate,
  isTaskDueToday,
} from '@gtd/notion';
import {
  isCommand,
  parseCommand,
  formatTaskCapture,
  formatClarification,
  formatProjectFollowup,
  formatWaitingFollowup,
  formatHelp,
  formatTaskList,
  formatTaskComplete,
} from '@gtd/gtd';
import type { PersonForMatching, ClassificationResult } from '@gtd/shared-types';
import { handleIntent, type HandlerContext } from '../handlers/intents.js';

/**
 * Classification Processor
 *
 * Uses Gemini AI to classify incoming messages:
 * 1. Check if it's a command (bypass AI)
 * 2. Fetch user's people for matching
 * 3. Classify with Gemini
 * 4. Create local task record
 * 5. Queue for Notion sync
 * 6. Send confirmation SMS
 */
export function createClassifyProcessor(
  db: DbClient,
  messageQueue: Queue<MessageJobData>
) {
  const classifier = createClassifier();

  return async (job: Job<ClassifyJobData>) => {
    const { userId, messageId, content } = job.data;

    console.log(`[Classify] Processing message ${messageId} for user ${userId}`);

    // 1. Get user and their phone number
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    // 1b. Check for pending clarification state
    const pendingClarification = await db.query.conversationStates.findFirst({
      where: eq(conversationStates.userId, userId),
    });

    if (pendingClarification?.stateType === 'task_clarification') {
      // User is responding to a clarification question
      const response = await handleClarificationResponse(
        db,
        messageQueue,
        user,
        pendingClarification,
        content
      );

      // Delete the clarification state
      await db.delete(conversationStates).where(eq(conversationStates.id, pendingClarification.id));

      await enqueueOutboundMessage(messageQueue, {
        userId,
        toNumber: user.phoneNumber,
        content: response,
        inReplyTo: messageId,
      });

      return { success: true, type: 'clarification_response' };
    }

    // 2. Check if it's a command
    if (isCommand(content)) {
      const parsed = parseCommand(content);
      if (parsed) {
        const response = await handleCommand(parsed.command, parsed.args, user, db);
        await enqueueOutboundMessage(messageQueue, {
          userId,
          toNumber: user.phoneNumber,
          content: response,
        });
        return { success: true, type: 'command', command: parsed.command };
      }
    }

    // 3. Get user's people for matching
    const userPeople = await db.query.people.findMany({
      where: eq(people.userId, userId),
    });

    const peopleForMatching: PersonForMatching[] = userPeople.map((p) => ({
      id: p.id,
      name: p.name,
      aliases: p.aliases ?? [],
      frequency: p.frequency,
      dayOfWeek: p.dayOfWeek,
    }));

    // 2b. Check if message is just a person's name (show their agenda)
    const contentLower = content.trim().toLowerCase();
    const matchedPerson = userPeople.find(
      (p) =>
        p.name.toLowerCase() === contentLower ||
        p.aliases?.some((a) => a.toLowerCase() === contentLower)
    );

    if (matchedPerson) {
      const response = await handleCommand('show_person_agenda', [matchedPerson.name], user, db);
      if (response) {
        await enqueueOutboundMessage(messageQueue, {
          userId,
          toNumber: user.phoneNumber,
          content: response,
        });
        return { success: true, type: 'command', command: 'show_person_agenda' };
      }
    }

    // 2c. Try fuzzy matching if no exact match and message looks like a name
    if (!matchedPerson && content.trim().split(/\s+/).length <= 3) {
      const fuzzyMatch = findBestFuzzyMatch(content.trim(), peopleForMatching, 0.7);

      if (fuzzyMatch && fuzzyMatch.distance > 0) {
        // Found a fuzzy match - ask for confirmation
        const confirmMessage = formatDidYouMean(fuzzyMatch);
        await enqueueOutboundMessage(messageQueue, {
          userId,
          toNumber: user.phoneNumber,
          content: confirmMessage,
        });
        // TODO: Store conversation state to handle "yes" response
        return { success: true, type: 'fuzzy_match', suggestion: fuzzyMatch.person.name };
      }
    }

    // 4. Fetch recent conversation history for context
    const recentMessages = await db.query.messages.findMany({
      where: eq(messages.userId, userId),
      orderBy: [desc(messages.createdAt)],
      limit: 10, // Fetch last 10 messages (will use 6 most recent)
    });

    // Convert to ConversationMessage format (oldest first for context)
    const conversationHistory: ConversationMessage[] = recentMessages
      .reverse() // Oldest first
      .map((msg) => ({
        role: msg.direction === 'inbound' ? 'user' as const : 'assistant' as const,
        content: msg.content,
        timestamp: msg.createdAt,
      }));

    // 5. Classify with Gemini (with conversation history)
    const classification = await classifier.classify(
      content,
      peopleForMatching,
      new Date(), // currentTime
      conversationHistory
    );

    console.log(`[Classify] Result: ${classification.type} (${classification.confidence})`);

    // 6. Update message with classification
    await db
      .update(messages)
      .set({ classification })
      .where(eq(messages.id, messageId));

    // 7. Handle based on classification type
    let response: string;

    if (classification.type === 'intent' && classification.intent) {
      // Intent detected by AI - use new intent handler system
      console.log(`[Classify] AI detected intent: ${classification.intent.intent}`);

      const handlerContext: HandlerContext = {
        user: {
          id: user.id,
          phoneNumber: user.phoneNumber,
          notionAccessToken: user.notionAccessToken,
          notionTasksDatabaseId: user.notionTasksDatabaseId,
          notionPeopleDatabaseId: user.notionPeopleDatabaseId,
          timezone: user.timezone,
          digestTime: user.digestTime,
          meetingReminderHours: user.meetingReminderHours,
          status: user.status,
          totalTasksCaptured: user.totalTasksCaptured,
          totalTasksCompleted: user.totalTasksCompleted,
        },
        db,
        messageQueue,
      };

      response = await handleIntent(classification.intent, handlerContext);
    } else if (classification.type === 'command') {
      // Legacy command support (for backwards compatibility)
      const commandArgs: string[] = [];

      if (classification.command === 'context' && classification.context) {
        commandArgs.push(classification.context);
      }

      console.log(`[Classify] Legacy command: ${classification.command}`);

      response = await handleCommand(
        classification.command ?? 'help',
        commandArgs,
        user,
        db
      );
    } else if (classification.type === 'needs_clarification' && classification.followUpQuestion) {
      // Task is vague - ask follow-up question
      console.log(`[Classify] Needs clarification: ${classification.missingInfo?.join(', ')}`);

      // Store partial task in conversation state for when user responds
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // Expire after 1 hour

      await db.insert(conversationStates).values({
        userId,
        stateType: 'task_clarification',
        step: 'awaiting_response',
        data: {
          partialTask: classification.partialTask,
          missingInfo: classification.missingInfo,
          originalMessage: content,
        },
        expiresAt,
      });

      response = classification.followUpQuestion;
    } else if (classification.type === 'unknown' || classification.confidence < 0.5) {
      // Low confidence - ask for clarification
      response = formatClarification(classification);
    } else {
      // Create task
      const taskResponse = await createTaskFromClassification(
        db,
        messageQueue,
        user,
        classification,
        content,
        peopleForMatching
      );
      response = taskResponse;
    }

    // 8. Send response
    await enqueueOutboundMessage(messageQueue, {
      userId,
      toNumber: user.phoneNumber,
      content: response,
      inReplyTo: messageId,
    });

    return {
      success: true,
      type: classification.type,
      confidence: classification.confidence,
    };
  };
}

/**
 * Handle a command
 */
async function handleCommand(
  command: string,
  args: string[],
  user: any,
  db: DbClient
): Promise<string> {
  switch (command) {
    case 'help':
      return formatHelp();

    case 'today': {
      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return "🔥 TODAY:\nConnect Notion first to see your tasks.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const tasks = await queryTasksDueToday(notion, user.notionTasksDatabaseId);

        if (tasks.length === 0) {
          return "🔥 TODAY:\nNo tasks due today! 🎉\n\nText something to capture a task.";
        }

        const formatted = tasks.map((t) => ({
          title: extractTaskTitle(t),
          detail: extractTaskDueDate(t) === new Date().toISOString().split('T')[0] ? undefined : 'due soon',
        }));

        return formatTaskList('🔥 TODAY:', formatted);
      } catch (error) {
        console.error('[Command:today] Error querying Notion:', error);
        return "🔥 TODAY:\nCouldn't fetch tasks. Try again later.";
      }
    }

    case 'actions': {
      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return "✅ ACTIONS:\nConnect Notion first to see your tasks.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const tasks = await queryActiveActions(notion, user.notionTasksDatabaseId);

        if (tasks.length === 0) {
          return "✅ ACTIONS:\nNo active actions.\n\nText something to capture a task.";
        }

        const formatted = tasks.slice(0, 10).map((t) => ({
          title: extractTaskTitle(t),
        }));

        const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
        return formatTaskList('✅ ACTIONS:', formatted) + suffix;
      } catch (error) {
        console.error('[Command:actions] Error querying Notion:', error);
        return "✅ ACTIONS:\nCouldn't fetch tasks. Try again later.";
      }
    }

    case 'projects': {
      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return "📁 PROJECTS:\nConnect Notion first to see your projects.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const tasks = await queryActiveProjects(notion, user.notionTasksDatabaseId);

        if (tasks.length === 0) {
          return "📁 PROJECTS:\nNo active projects.\n\nCapture one by texting 'Project: [name]'";
        }

        const formatted = tasks.map((t) => ({
          title: extractTaskTitle(t),
        }));

        return formatTaskList('📁 PROJECTS:', formatted);
      } catch (error) {
        console.error('[Command:projects] Error querying Notion:', error);
        return "📁 PROJECTS:\nCouldn't fetch projects. Try again later.";
      }
    }

    case 'waiting': {
      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return "⏳ WAITING:\nConnect Notion first to see your waiting items.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const tasks = await queryWaitingTasks(notion, user.notionTasksDatabaseId);

        if (tasks.length === 0) {
          return "⏳ WAITING:\nNothing waiting on others.\n\nCapture with 'Waiting on [person] for [thing]'";
        }

        const formatted = tasks.map((t) => ({
          title: extractTaskTitle(t),
          detail: extractTaskDueDate(t) ? `due ${extractTaskDueDate(t)}` : undefined,
        }));

        return formatTaskList('⏳ WAITING:', formatted);
      } catch (error) {
        console.error('[Command:waiting] Error querying Notion:', error);
        return "⏳ WAITING:\nCouldn't fetch tasks. Try again later.";
      }
    }

    case 'someday': {
      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return "💭 SOMEDAY:\nConnect Notion first to see your someday list.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const tasks = await querySomedayTasks(notion, user.notionTasksDatabaseId);

        if (tasks.length === 0) {
          return "💭 SOMEDAY:\nNo someday items yet.\n\nCapture ideas with 'Someday: [idea]'";
        }

        const formatted = tasks.slice(0, 10).map((t) => ({
          title: extractTaskTitle(t),
        }));

        const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
        return formatTaskList('💭 SOMEDAY:', formatted) + suffix;
      } catch (error) {
        console.error('[Command:someday] Error querying Notion:', error);
        return "💭 SOMEDAY:\nCouldn't fetch tasks. Try again later.";
      }
    }

    case 'meetings':
    case 'people': {
      // List all people with pending agenda counts
      const userPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      if (userPeople.length === 0) {
        return "👥 PEOPLE:\nNo people added yet.\n\nText 'add person [name]' to add someone.";
      }

      const lines = await Promise.all(
        userPeople.map(async (p) => {
          const agendaItems = await db.query.tasks.findMany({
            where: eq(tasks.personId, p.id),
          });
          const pendingCount = agendaItems.filter((t) => t.status !== 'completed' && t.status !== 'synced').length;
          const schedule = p.frequency && p.dayOfWeek
            ? ` (${p.frequency} on ${p.dayOfWeek})`
            : p.frequency
              ? ` (${p.frequency})`
              : '';
          return `• ${p.name}${schedule}${pendingCount > 0 ? ` - ${pendingCount} pending` : ''}`;
        })
      );

      return `👥 PEOPLE:\n${lines.join('\n')}`;
    }

    case 'add_person': {
      const name = args[0];
      if (!name) {
        return "Please specify a name: 'add person [name]'";
      }

      // Check if person already exists
      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const alreadyExists = allPeople.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );

      if (alreadyExists) {
        return `👤 ${name} already exists in your people list.`;
      }

      // Create in Notion if user has People database configured
      let notionPageId: string | null = null;
      if (user.notionAccessToken && user.notionPeopleDatabaseId) {
        try {
          console.log(`[AddPerson] Creating ${name} in Notion People database...`);
          const notion = createNotionClient(user.notionAccessToken);
          notionPageId = await createNotionPerson(notion, user.notionPeopleDatabaseId, {
            name,
          });
          console.log(`[AddPerson] Created Notion page: ${notionPageId}`);
        } catch (error) {
          console.error(`[AddPerson] Failed to create in Notion:`, error);
          // Continue anyway - save locally
        }
      }

      // Save to local database
      await db.insert(people).values({
        userId: user.id,
        name,
        notionPageId,
        active: true,
      });

      return `✅ Added ${name} to your people.${notionPageId ? ' (synced to Notion)' : ''}\n\nOptional:\n• 'alias ${name} = nickname1, nickname2'\n• '${name} meets weekly on Tuesday'`;
    }

    case 'remove_person': {
      const name = args[0];
      if (!name) {
        return "Please specify a name: 'remove person [name]'";
      }

      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const person = allPeople.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );

      if (!person) {
        return `👤 ${name} not found in your people list.`;
      }

      await db.delete(people).where(eq(people.id, person.id));

      return `✅ Removed ${name} from your people.`;
    }

    case 'set_alias': {
      const [name, aliasesStr] = args;
      if (!name || !aliasesStr) {
        return "Format: 'alias [name] = alias1, alias2, alias3'";
      }

      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const person = allPeople.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );

      if (!person) {
        return `👤 ${name} not found. Add them first with 'add person ${name}'`;
      }

      const aliases = aliasesStr.split(',').map((a) => a.trim().toLowerCase());

      await db
        .update(people)
        .set({ aliases, updatedAt: new Date() })
        .where(eq(people.id, person.id));

      return `✅ Set aliases for ${person.name}: ${aliases.join(', ')}`;
    }

    case 'set_schedule': {
      const [name, frequency, dayOfWeek] = args;
      if (!name || !frequency) {
        return "Format: '[name] meets weekly on Tuesday'";
      }

      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const person = allPeople.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );

      if (!person) {
        return `👤 ${name} not found. Add them first with 'add person ${name}'`;
      }

      await db
        .update(people)
        .set({
          frequency: frequency as any,
          dayOfWeek: dayOfWeek as any || null,
          updatedAt: new Date(),
        })
        .where(eq(people.id, person.id));

      const scheduleStr = dayOfWeek
        ? `${frequency} on ${dayOfWeek}`
        : frequency;

      return `✅ ${person.name} now meets ${scheduleStr}`;
    }

    case 'context': {
      const ctx = args[0];
      if (!ctx) {
        return "Please specify a context: @work, @home, @errands, @calls, @computer";
      }

      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return `📍 @${ctx}:\nConnect Notion first to see your tasks.`;
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const tasks = await queryTasksByContext(notion, user.notionTasksDatabaseId, ctx);

        if (tasks.length === 0) {
          return `📍 @${ctx}:\nNo tasks in this context.\n\nCapture one by adding @${ctx} to your message.`;
        }

        const formatted = tasks.slice(0, 10).map((t) => ({
          title: extractTaskTitle(t),
        }));

        const suffix = tasks.length > 10 ? `\n\n(+${tasks.length - 10} more)` : '';
        return formatTaskList(`📍 @${ctx}:`, formatted) + suffix;
      } catch (error) {
        console.error(`[Command:context:${ctx}] Error querying Notion:`, error);
        return `📍 @${ctx}:\nCouldn't fetch tasks. Try again later.`;
      }
    }

    case 'done': {
      const searchText = args.join(' ');
      if (!searchText) {
        return "What did you complete? Try 'done [task text]'";
      }

      if (!user.notionAccessToken || !user.notionTasksDatabaseId) {
        return "Connect Notion first to mark tasks complete.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const matchingTasks = await findTaskByText(notion, user.notionTasksDatabaseId, searchText);

        if (matchingTasks.length === 0) {
          return `No matching task found for "${searchText}".\n\nTry a different search term.`;
        }

        if (matchingTasks.length === 1) {
          // Exact match - complete it
          const task = matchingTasks[0]!;
          const title = extractTaskTitle(task);
          const wasDueToday = isTaskDueToday(task);

          await completeTask(notion, task.id);

          // Update local DB stats
          await db
            .update(users)
            .set({
              totalTasksCompleted: (user.totalTasksCompleted ?? 0) + 1,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

          return formatTaskComplete(title, wasDueToday);
        }

        // Multiple matches - ask user to be more specific
        const options = matchingTasks.slice(0, 3).map((t, i) => `${i + 1}. ${extractTaskTitle(t)}`);
        return `Found ${matchingTasks.length} matching tasks:\n${options.join('\n')}\n\nBe more specific or reply with number.`;
      } catch (error) {
        console.error('[Command:done] Error completing task:', error);
        return "Couldn't complete task. Try again later.";
      }
    }

    case 'done_with': {
      const personName = args[0];
      if (!personName) {
        return "Who did you meet with? Try 'done with [name]'";
      }

      // Look up person in user's people list
      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const person = allPeople.find(
        (p) =>
          p.name.toLowerCase() === personName.toLowerCase() ||
          p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
      );

      if (!person) {
        return `I don't have "${personName}" in your people list.\n\nAdd them with 'add person ${personName}'`;
      }

      if (!user.notionAccessToken || !user.notionTasksDatabaseId || !person.notionPageId) {
        return "Connect Notion first to process agenda items.";
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const agendaItems = await queryAgendaForPerson(notion, user.notionTasksDatabaseId, person.notionPageId);

        if (agendaItems.length === 0) {
          return `✅ No pending agenda items for ${person.name}.\n\nGreat meeting! 🎉`;
        }

        // For now, list items and mark all as discussed
        // TODO: Implement multi-turn conversation for item-by-item processing
        const itemTitles = agendaItems.map((item, i) => `${i + 1}. ${extractTaskTitle(item)}`);

        // Mark all as discussed
        const { markDiscussed } = await import('@gtd/notion');
        for (const item of agendaItems) {
          await markDiscussed(notion, item.id);
        }

        return `👥 ${person.name} - ${agendaItems.length} items discussed:\n${itemTitles.join('\n')}\n\n✅ All marked as discussed!`;
      } catch (error) {
        console.error('[Command:done_with] Error processing agenda:', error);
        return "Couldn't process agenda items. Try again later.";
      }
    }

    case 'show_person_agenda': {
      // This handles when user just texts a person's name
      const personName = args[0];
      if (!personName) {
        return formatHelp();
      }

      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const person = allPeople.find(
        (p) =>
          p.name.toLowerCase() === personName.toLowerCase() ||
          p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
      );

      if (!person) {
        return formatHelp(); // Not a known person name
      }

      if (!user.notionAccessToken || !user.notionTasksDatabaseId || !person.notionPageId) {
        return `👤 ${person.name}\n\nConnect Notion first to see agenda items.`;
      }

      try {
        const notion = createNotionClient(user.notionAccessToken);
        const agendaItems = await queryAgendaForPerson(notion, user.notionTasksDatabaseId, person.notionPageId);

        if (agendaItems.length === 0) {
          return `👤 ${person.name}\n\nNo pending agenda items.\n\nAdd one by texting '@${person.name.split(' ')[0]} [topic]'`;
        }

        const formatted = agendaItems.map((t) => ({
          title: extractTaskTitle(t),
        }));

        return formatTaskList(`👤 ${person.name} (${agendaItems.length} pending):`, formatted, true);
      } catch (error) {
        console.error('[Command:show_person_agenda] Error:', error);
        return `👤 ${person.name}\n\nCouldn't fetch agenda items. Try again later.`;
      }
    }

    default:
      return formatHelp();
  }
}

/**
 * Create a task from classification result
 */
async function createTaskFromClassification(
  db: DbClient,
  messageQueue: Queue<MessageJobData>,
  user: any,
  classification: ClassificationResult,
  rawText: string,
  peopleForMatching: PersonForMatching[]
): Promise<string> {
  // Find matched person if applicable
  let matchedPerson: PersonForMatching | undefined;
  let pendingCount = 0;

  if (
    classification.personMatch &&
    classification.personMatch.confidence > 0.5
  ) {
    matchedPerson = peopleForMatching.find(
      (p) => p.id === classification.personMatch!.personId
    );

    if (matchedPerson) {
      // Count existing pending agenda items for this person
      const existingAgenda = await db.query.tasks.findMany({
        where: eq(tasks.personId, matchedPerson.id),
      });
      pendingCount = existingAgenda.filter((t) => t.status !== 'completed').length + 1;
    }
  }

  // Create local task
  const [task] = await db
    .insert(tasks)
    .values({
      userId: user.id,
      rawText,
      title: classification.title ?? rawText,
      type: classification.type as any,
      status: 'pending',
      context: classification.context ?? null,
      priority: classification.priority ?? null,
      personId: matchedPerson?.id ?? null,
      dueDate: classification.dueDate ?? null,
    })
    .returning();

  // Increment user's captured count
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
    taskId: task!.id,
    classification,
  });

  // Format response based on type
  if (classification.type === 'project') {
    return formatProjectFollowup(classification.title ?? rawText);
  }

  if (classification.type === 'waiting' && !classification.dueDate) {
    return formatWaitingFollowup(classification.title ?? rawText);
  }

  return formatTaskCapture(
    classification.title ?? rawText,
    classification.type as any,
    classification.context,
    classification.priority,
    classification.dueDate,
    matchedPerson?.name,
    pendingCount > 0 ? pendingCount : undefined
  );
}

/**
 * Handle clarification response from user
 * Re-classifies to extract fields, keeps original title clean, puts extra info in notes
 */
async function handleClarificationResponse(
  db: DbClient,
  messageQueue: Queue<MessageJobData>,
  user: any,
  state: any,
  clarificationText: string
): Promise<string> {
  const classifier = createClassifier();

  const data = state.data as {
    partialTask?: { type: string; title: string };
    missingInfo?: string[];
    originalMessage?: string;
  };

  const originalMessage = data.originalMessage || data.partialTask?.title || '';

  // Classify the combined context to extract fields (date, priority, person, etc.)
  // but we'll use the ORIGINAL message as the clean title
  const combinedForClassification = `${originalMessage}. Additional context: ${clarificationText}`;

  // Get user's people for matching
  const userPeople = await db.query.people.findMany({
    where: eq(people.userId, user.id),
  });

  const peopleForMatching: PersonForMatching[] = userPeople.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases ?? [],
    frequency: p.frequency,
    dayOfWeek: p.dayOfWeek,
  }));

  // Re-classify to extract all fields
  const classification = await classifier.classify(
    combinedForClassification,
    peopleForMatching,
    new Date(),
    []
  );

  // Use the classification result, falling back to partial task type
  const taskType = (classification.type !== 'unknown' && classification.type !== 'needs_clarification' && classification.type !== 'intent' && classification.type !== 'command')
    ? classification.type
    : (data.partialTask?.type || 'action');

  // Keep the ORIGINAL title clean - don't append clarification to it
  // Use classification.title if it's cleaner, otherwise use original
  const title = classification.title && !classification.title.includes('Additional context')
    ? classification.title
    : originalMessage;

  // Find matched person if applicable
  let matchedPerson: PersonForMatching | undefined;
  if (classification.personMatch && classification.personMatch.confidence > 0.5) {
    matchedPerson = peopleForMatching.find(
      (p) => p.id === classification.personMatch!.personId
    );
  }

  // Determine if clarification adds meaningful notes (not just person info or dates)
  const missingInfo = data.missingInfo || [];
  const isPersonInfo = missingInfo.includes('person') || clarificationText.toLowerCase().includes("he's") || clarificationText.toLowerCase().includes("she's");
  const notes = isPersonInfo ? null : clarificationText; // Only add as notes if it's task-relevant detail

  // Create the task with all extracted fields
  const [task] = await db
    .insert(tasks)
    .values({
      userId: user.id,
      rawText: originalMessage,
      title,
      type: taskType as any,
      status: 'pending',
      context: classification.context ?? null,
      priority: classification.priority ?? null,
      personId: matchedPerson?.id ?? null,
      dueDate: classification.dueDate ?? null,
      notes: notes ?? null,
    })
    .returning();

  // Increment user's captured count
  await db
    .update(users)
    .set({
      totalTasksCaptured: (user.totalTasksCaptured ?? 0) + 1,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Queue for Notion sync with full classification
  // Notes are already saved to task record and will be synced from there
  await enqueueNotionSync(messageQueue, {
    userId: user.id,
    taskId: task!.id,
    classification: {
      type: taskType as any,
      title,
      confidence: classification.confidence,
      context: classification.context,
      priority: classification.priority,
      personMatch: classification.personMatch,
      dueDate: classification.dueDate,
    },
  });

  return formatTaskCapture(
    title,
    taskType as any,
    classification.context,
    classification.priority,
    classification.dueDate,
    matchedPerson?.name
  );
}
