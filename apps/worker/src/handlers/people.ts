import { people } from '@gtd/database';
import { eq } from 'drizzle-orm';
import { ensurePersonLabel, createTodoistClient } from '@gtd/todoist';
import type { IntentEntities, MeetingFrequency, DayOfWeek } from '@gtd/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Handle add_person intent
 * "track Sarah", "add John to my people", "I need to track meetings with Alex"
 */
export async function handleAddPerson(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;
  if (!personName) {
    return "Who do you want to add? Try 'track [name]' or 'add person [name]'";
  }

  // Check if person already exists
  const allPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  const alreadyExists = allPeople.find(
    (p) => p.name.toLowerCase() === personName.toLowerCase()
  );

  if (alreadyExists) {
    return `👤 ${personName} is already in your people list.`;
  }

  // Create person label in Todoist if connected
  let todoistLabel: string | null = null;
  if (ctx.user.todoistAccessToken) {
    try {
      console.log(`[AddPerson] Creating label for ${personName} in Todoist...`);
      const todoist = createTodoistClient(ctx.user.todoistAccessToken);
      todoistLabel = await ensurePersonLabel(todoist, personName);
      console.log(`[AddPerson] Created Todoist label: ${todoistLabel}`);
    } catch (error) {
      console.error(`[AddPerson] Failed to create Todoist label:`, error);
      // Continue anyway - save locally
    }
  }

  // Save to local database
  await ctx.db.insert(people).values({
    userId: ctx.user.id,
    name: personName,
    todoistLabel,
    active: true,
  });

  const syncNote = todoistLabel ? ' (synced to Todoist)' : '';
  return `✅ Added ${personName} to your people.${syncNote}\n\nOptional next steps:\n• "${personName} goes by [nickname]" to add an alias\n• "${personName} meets weekly on Tuesday" to set schedule`;
}

/**
 * Handle remove_person intent
 * "remove Sarah", "stop tracking John", "delete Alex from my people"
 */
export async function handleRemovePerson(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;
  if (!personName) {
    return "Who do you want to remove? Try 'remove [name]' or 'stop tracking [name]'";
  }

  const allPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  const person = allPeople.find(
    (p) =>
      p.name.toLowerCase() === personName.toLowerCase() ||
      p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
  );

  if (!person) {
    return `I don't have "${personName}" in your people list.`;
  }

  await ctx.db.delete(people).where(eq(people.id, person.id));

  return `✅ Removed ${person.name} from your people.`;
}

/**
 * Handle set_alias intent
 * "Sarah goes by SC", "call John JD", "Sarah = SC, Sarah C"
 */
export async function handleSetAlias(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;
  const aliasValue = entities.newValue;
  const aliasArray = entities.aliases;

  if (!personName) {
    return "Who are you adding an alias for? Try '[name] goes by [alias]'";
  }

  const allPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  const person = allPeople.find(
    (p) =>
      p.name.toLowerCase() === personName.toLowerCase() ||
      p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
  );

  if (!person) {
    return `I don't have "${personName}" in your people list.\n\nAdd them first with 'track ${personName}'`;
  }

  // Parse aliases from either array or comma-separated string
  let aliases: string[];
  if (aliasArray && aliasArray.length > 0) {
    aliases = aliasArray.map((a) => a.toLowerCase().trim());
  } else if (aliasValue) {
    aliases = aliasValue.split(',').map((a) => a.toLowerCase().trim());
  } else {
    return "What alias? Try '[name] goes by [alias]' or '[name] = alias1, alias2'";
  }

  // Merge with existing aliases
  const existingAliases = person.aliases ?? [];
  const mergedAliases = [...new Set([...existingAliases, ...aliases])];

  await ctx.db
    .update(people)
    .set({ aliases: mergedAliases, updatedAt: new Date() })
    .where(eq(people.id, person.id));

  return `✅ ${person.name} aliases: ${mergedAliases.join(', ')}`;
}

/**
 * Handle set_schedule intent
 * "I see Sarah every Tuesday", "John meets weekly", "Alex and I meet biweekly on Friday"
 */
export async function handleSetSchedule(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;
  const frequency = entities.frequency;
  const dayOfWeek = entities.dayOfWeek;

  if (!personName) {
    return "Who are you setting a schedule for? Try '[name] meets weekly on Tuesday'";
  }

  if (!frequency) {
    return "How often? Try '[name] meets daily/weekly/biweekly/monthly'";
  }

  const allPeople = await ctx.db.query.people.findMany({
    where: eq(people.userId, ctx.user.id),
  });

  const person = allPeople.find(
    (p) =>
      p.name.toLowerCase() === personName.toLowerCase() ||
      p.aliases?.some((a) => a.toLowerCase() === personName.toLowerCase())
  );

  if (!person) {
    return `I don't have "${personName}" in your people list.\n\nAdd them first with 'track ${personName}'`;
  }

  await ctx.db
    .update(people)
    .set({
      frequency: frequency as MeetingFrequency,
      dayOfWeek: (dayOfWeek as DayOfWeek) || null,
      updatedAt: new Date(),
    })
    .where(eq(people.id, person.id));

  const scheduleStr = dayOfWeek
    ? `${frequency} on ${dayOfWeek}`
    : frequency;

  return `✅ ${person.name} now meets ${scheduleStr}`;
}
