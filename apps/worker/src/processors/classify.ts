import type { Job } from 'bullmq';
import type { ClassifyJobData, MessageJobData } from '@clarity/queue';
import { enqueueNotionSync, enqueueOutboundMessage } from '@clarity/queue';
import type { Queue } from 'bullmq';
import type { DbClient } from '@clarity/database';
import { users, messages, tasks, people } from '@clarity/database';
import { eq } from 'drizzle-orm';
import { createClassifier } from '@clarity/ai';
import {
  isCommand,
  parseCommand,
  formatTaskCapture,
  formatClarification,
  formatProjectFollowup,
  formatWaitingFollowup,
  formatHelp,
} from '@clarity/gtd';
import type { PersonForMatching, ClassificationResult } from '@clarity/shared-types';

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

    // 4. Classify with Gemini
    const classification = await classifier.classify(content, peopleForMatching);

    console.log(`[Classify] Result: ${classification.type} (${classification.confidence})`);

    // 5. Update message with classification
    await db
      .update(messages)
      .set({ classification })
      .where(eq(messages.id, messageId));

    // 6. Handle based on classification type
    let response: string;

    if (classification.type === 'command') {
      // Command detected by AI
      response = await handleCommand(
        classification.command ?? 'help',
        [],
        user,
        db
      );
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

    // 7. Send response
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

    case 'today':
      // TODO: Query tasks from Notion and format
      return "🔥 TODAY:\n• (Coming soon - Notion queries)\n\nText 'help' for commands.";

    case 'actions':
      return "✅ ACTIONS:\n• (Coming soon - Notion queries)\n\nText 'help' for commands.";

    case 'projects':
      return "📁 PROJECTS:\n• (Coming soon - Notion queries)\n\nText 'help' for commands.";

    case 'waiting':
      return "⏳ WAITING:\n• (Coming soon - Notion queries)\n\nText 'help' for commands.";

    case 'someday':
      return "💭 SOMEDAY:\n• (Coming soon - Notion queries)\n\nText 'help' for commands.";

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
      const existing = await db.query.people.findFirst({
        where: eq(people.userId, user.id),
      });

      const allPeople = await db.query.people.findMany({
        where: eq(people.userId, user.id),
      });

      const alreadyExists = allPeople.find(
        (p) => p.name.toLowerCase() === name.toLowerCase()
      );

      if (alreadyExists) {
        return `👤 ${name} already exists in your people list.`;
      }

      await db.insert(people).values({
        userId: user.id,
        name,
        active: true,
      });

      return `✅ Added ${name} to your people.\n\nOptional next steps:\n• 'alias ${name} = nickname1, nickname2'\n• '${name} meets weekly on Tuesday'`;
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

    case 'context':
      const ctx = args[0];
      return `📍 @${ctx}:\n• (Coming soon - Notion queries)\n\nText 'help' for commands.`;

    case 'done':
      const searchText = args.join(' ');
      return `Looking for "${searchText}"...\n\n(Task completion coming soon)`;

    case 'done_with':
      const personName = args[0];
      return `Processing agenda items for ${personName}...\n\n(Post-meeting flow coming soon)`;

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
