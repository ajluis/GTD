/**
 * Messages Lookup Tool
 * Retrieve conversation history for context
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { messages } from '@gtd/database';
import { eq, desc, and, lt } from 'drizzle-orm';

export const lookupMessages: Tool = {
  name: 'lookup_messages',
  description: 'Get recent conversation history with the user. Useful for understanding context of follow-up messages.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of messages to retrieve (default 10)',
        default: 10,
      },
      before: {
        type: 'string',
        description: 'Get messages before this timestamp (ISO format)',
        format: 'date-time',
      },
    },
    required: [],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { limit = 10, before } = params as {
      limit?: number;
      before?: string;
    };

    try {
      const conditions = [eq(messages.userId, context.userId)];

      if (before) {
        conditions.push(lt(messages.createdAt, new Date(before)));
      }

      const results = await context.db.query.messages.findMany({
        where: and(...conditions),
        orderBy: [desc(messages.createdAt)],
        limit: limit,
      });

      // Reverse to get chronological order (oldest first)
      const chronological = results.reverse();

      const formattedResults = chronological.map((m) => ({
        id: m.id,
        direction: m.direction,
        content: m.content,
        timestamp: m.createdAt.toISOString(),
        role: m.direction === 'inbound' ? 'user' : 'assistant',
      }));

      return {
        success: true,
        data: {
          count: formattedResults.length,
          messages: formattedResults,
        },
      };
    } catch (error) {
      console.error('[lookup_messages] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to lookup messages',
      };
    }
  },
};
