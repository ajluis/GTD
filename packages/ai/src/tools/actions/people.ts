/**
 * People Action Tools
 * Create, update, and manage contacts
 */

import type { Tool, ToolContext, ToolResult, StoredPersonData } from '../types.js';
import { people } from '@gtd/database';
import { eq, and } from 'drizzle-orm';

/**
 * Create a new person
 */
export const createPerson: Tool = {
  name: 'create_person',
  description: 'Add a new person to the user\'s contacts. Use for tracking people they meet with.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Person\'s name',
      },
      aliases: {
        type: 'array',
        description: 'Alternative names or nicknames',
        items: { type: 'string' },
      },
      frequency: {
        type: 'string',
        description: 'How often they meet',
        enum: ['daily', 'weekly', 'biweekly', 'monthly', 'as_needed'],
      },
      dayOfWeek: {
        type: 'string',
        description: 'Which day they typically meet',
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      },
    },
    required: ['name'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { name, aliases, frequency, dayOfWeek } = params as {
      name: string;
      aliases?: string[];
      frequency?: string;
      dayOfWeek?: string;
    };

    try {
      // Check if person already exists
      const existing = await context.db.query.people.findFirst({
        where: and(
          eq(people.userId, context.userId),
          eq(people.name, name)
        ),
      });

      if (existing) {
        return {
          success: false,
          error: `Person "${name}" already exists`,
        };
      }

      // Create person
      const [person] = await context.db
        .insert(people)
        .values({
          userId: context.userId,
          name,
          aliases: aliases || null,
          frequency: (frequency as any) || null,
          dayOfWeek: (dayOfWeek as any) || null,
          active: true,
        })
        .returning();

      return {
        success: true,
        data: {
          personId: person!.id,
          name: person!.name,
          aliases: person!.aliases,
          frequency: person!.frequency,
          dayOfWeek: person!.dayOfWeek,
        },
        trackEntities: {
          people: [{ id: person!.id, name: person!.name }],
        },
      };
    } catch (error) {
      console.error('[create_person] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create person',
      };
    }
  },
};

/**
 * Update a person
 */
export const updatePerson: Tool = {
  name: 'update_person',
  description: 'Update a person\'s information like aliases, meeting frequency, or meeting day.',
  parameters: {
    type: 'object',
    properties: {
      personId: {
        type: 'string',
        description: 'Person ID (from lookup_people)',
      },
      name: {
        type: 'string',
        description: 'New name',
      },
      aliases: {
        type: 'array',
        description: 'New aliases (replaces existing)',
        items: { type: 'string' },
      },
      frequency: {
        type: 'string',
        description: 'New meeting frequency',
        enum: ['daily', 'weekly', 'biweekly', 'monthly', 'as_needed'],
      },
      dayOfWeek: {
        type: 'string',
        description: 'New meeting day',
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      },
    },
    required: ['personId'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { personId, name, aliases, frequency, dayOfWeek } = params as {
      personId: string;
      name?: string;
      aliases?: string[];
      frequency?: string;
      dayOfWeek?: string;
    };

    try {
      // Get current person
      const current = await context.db.query.people.findFirst({
        where: and(
          eq(people.id, personId),
          eq(people.userId, context.userId)
        ),
      });

      if (!current) {
        return {
          success: false,
          error: 'Person not found',
        };
      }

      // Build update
      const updates: Record<string, unknown> = { updatedAt: new Date() };

      if (name !== undefined) updates['name'] = name;
      if (aliases !== undefined) updates['aliases'] = aliases;
      if (frequency !== undefined) updates['frequency'] = frequency;
      if (dayOfWeek !== undefined) updates['dayOfWeek'] = dayOfWeek;

      // Update
      const [updated] = await context.db
        .update(people)
        .set(updates)
        .where(eq(people.id, personId))
        .returning();

      return {
        success: true,
        data: {
          personId: updated!.id,
          name: updated!.name,
          aliases: updated!.aliases,
          frequency: updated!.frequency,
          dayOfWeek: updated!.dayOfWeek,
        },
      };
    } catch (error) {
      console.error('[update_person] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update person',
      };
    }
  },
};

/**
 * Remove a person
 */
export const removePerson: Tool = {
  name: 'remove_person',
  description: 'Remove a person from contacts. Does not delete their agenda items.',
  parameters: {
    type: 'object',
    properties: {
      personId: {
        type: 'string',
        description: 'Person ID (from lookup_people)',
      },
    },
    required: ['personId'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { personId } = params as { personId: string };

    try {
      // Get person for confirmation and undo
      const person = await context.db.query.people.findFirst({
        where: and(
          eq(people.id, personId),
          eq(people.userId, context.userId)
        ),
      });

      if (!person) {
        return {
          success: false,
          error: 'Person not found',
        };
      }

      // Store for undo
      const personData: StoredPersonData = {
        id: person.id,
        name: person.name,
        aliases: person.aliases,
        frequency: person.frequency,
        dayOfWeek: person.dayOfWeek,
        notionPageId: person.notionPageId,
      };

      // Soft delete (mark inactive) rather than hard delete
      await context.db
        .update(people)
        .set({ active: false, updatedAt: new Date() })
        .where(eq(people.id, personId));

      return {
        success: true,
        data: {
          personId: person.id,
          name: person.name,
          removed: true,
        },
        undoAction: {
          type: 'restore_person',
          personData,
        },
      };
    } catch (error) {
      console.error('[remove_person] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to remove person',
      };
    }
  },
};
