import { pgTable, uuid, text, timestamp, jsonb, index } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * Conversation States table
 * Manages multi-turn conversation context for complex interactions
 *
 * Examples:
 * - Onboarding flow (multiple steps)
 * - Post-meeting processing ("done with Sarah" -> process each item)
 * - Clarification dialogs ("Which Sarah?")
 * - Adding a new person (name -> frequency -> day)
 */
export const conversationStates = pgTable(
  'conversation_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Reference to the user */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /**
     * State type for routing logic:
     * - onboarding: New user setup flow
     * - clarification: Awaiting disambiguation (e.g., which person)
     * - post_meeting: Processing agenda items after meeting
     * - add_person: Adding a new person to People table
     * - waiting_followup: Setting follow-up date for waiting item
     */
    stateType: text('state_type').notNull(),

    /**
     * Current step within the state flow
     * e.g., for onboarding: 'welcome', 'oauth_pending', 'database_setup', 'add_person'
     */
    step: text('step'),

    /**
     * State-specific data stored as JSON
     * Structure varies by state type:
     *
     * onboarding: { oauthState?: string }
     * clarification: { options: [{id, name}], originalMessage: string }
     * post_meeting: { personId: string, items: [{id, title}], currentIndex: number }
     * add_person: { name?: string, frequency?: string }
     * waiting_followup: { taskId: string }
     */
    data: jsonb('data').default({}).$type<Record<string, unknown>>(),

    /** When this state expires (auto-cleanup) */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_conversation_states_user').on(table.userId),
    index('idx_conversation_states_expires').on(table.expiresAt),
    index('idx_conversation_states_type').on(table.userId, table.stateType),
  ]
);

export type ConversationState = typeof conversationStates.$inferSelect;
export type NewConversationState = typeof conversationStates.$inferInsert;
