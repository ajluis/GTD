import { pgTable, uuid, text, timestamp, boolean, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';

/**
 * Meeting frequency enum
 */
export const meetingFrequencyEnum = pgEnum('meeting_frequency', [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'as_needed',
]);

/**
 * Day of week enum
 */
export const dayOfWeekEnum = pgEnum('day_of_week', [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

/**
 * People table
 * Cached from Notion People database for fast alias matching
 * Used to route agenda items to the right person
 */
export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Reference to the user who owns this person entry */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Notion page ID for sync */
    notionPageId: text('notion_page_id').unique(),

    // Person Details
    /** Person or meeting name */
    name: text('name').notNull(),

    /** Alternative names/triggers for matching (e.g., "sarah", "sc", "product") */
    aliases: text('aliases').array().default([]),

    // Meeting Schedule
    /** How often you meet with this person */
    frequency: meetingFrequencyEnum('frequency'),

    /** Which day of the week you typically meet */
    dayOfWeek: dayOfWeekEnum('day_of_week'),

    // Status
    /** Whether to include in agenda routing */
    active: boolean('active').default(true).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    /** Last sync from Notion */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_people_user_id').on(table.userId),
    index('idx_people_user_name').on(table.userId, table.name),
    index('idx_people_notion_page').on(table.notionPageId),
    index('idx_people_active').on(table.userId, table.active),
  ]
);

export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
