/**
 * People Lookup Tool
 * Search and retrieve people from user's contact list
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { people } from '@gtd/database';
import { eq, ilike, or, and } from 'drizzle-orm';

export const lookupPeople: Tool = {
  name: 'lookup_people',
  description: 'Search for people in the user\'s contact list by name or criteria. Returns matching contacts with their IDs, names, aliases, and meeting schedules.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Name or partial name to search for',
      },
      meetingDay: {
        type: 'string',
        description: 'Filter by meeting day',
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default 10)',
        default: 10,
      },
    },
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { query, meetingDay, limit = 10 } = params as {
      query?: string;
      meetingDay?: string;
      limit?: number;
    };

    try {
      let results;

      if (query) {
        // Search by name or alias
        const searchPattern = `%${query}%`;
        results = await context.db.query.people.findMany({
          where: and(
            eq(people.userId, context.userId),
            eq(people.active, true),
            or(
              ilike(people.name, searchPattern),
              // Note: alias search would need a more complex query
              // For now, we'll do a basic name search
            )
          ),
          limit: limit,
        });

        // Also check aliases manually (since JSONB array search is complex)
        if (results.length === 0) {
          const allPeople = await context.db.query.people.findMany({
            where: and(
              eq(people.userId, context.userId),
              eq(people.active, true)
            ),
          });

          const lowerQuery = query.toLowerCase();
          results = allPeople.filter(
            (p) =>
              p.name.toLowerCase().includes(lowerQuery) ||
              p.aliases?.some((a) => a.toLowerCase().includes(lowerQuery))
          ).slice(0, limit);
        }
      } else if (meetingDay) {
        // Filter by meeting day
        results = await context.db.query.people.findMany({
          where: and(
            eq(people.userId, context.userId),
            eq(people.active, true),
            eq(people.dayOfWeek, meetingDay as any)
          ),
          limit: limit,
        });
      } else {
        // Return all people
        results = await context.db.query.people.findMany({
          where: and(
            eq(people.userId, context.userId),
            eq(people.active, true)
          ),
          limit: limit,
        });
      }

      const formattedResults = results.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases ?? [],
        frequency: p.frequency,
        dayOfWeek: p.dayOfWeek,
        notionPageId: p.notionPageId,
      }));

      return {
        success: true,
        data: {
          count: formattedResults.length,
          people: formattedResults,
        },
        trackEntities: {
          people: formattedResults.map((p) => ({ id: p.id, name: p.name })),
        },
      };
    } catch (error) {
      console.error('[lookup_people] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to lookup people',
      };
    }
  },
};
