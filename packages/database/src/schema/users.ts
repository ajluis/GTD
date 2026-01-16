import { pgTable, uuid, text, timestamp, integer, pgEnum, index } from 'drizzle-orm/pg-core';

/**
 * User status enum
 * - onboarding: New user going through Notion OAuth setup
 * - active: Fully set up and using the system
 * - paused: User has paused notifications/processing
 */
export const userStatusEnum = pgEnum('user_status', ['onboarding', 'active', 'paused']);

/**
 * Users table
 * Stores user accounts linked to phone numbers and Notion workspaces
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Phone number in E.164 format (e.g., +15551234567) */
    phoneNumber: text('phone_number').unique().notNull(),

    // Notion Integration
    /** Encrypted OAuth access token */
    notionAccessToken: text('notion_access_token'),
    /** Notion workspace ID */
    notionWorkspaceId: text('notion_workspace_id'),
    /** Workspace name for display */
    notionWorkspaceName: text('notion_workspace_name'),
    /** Tasks database ID (auto-created during onboarding) */
    notionTasksDatabaseId: text('notion_tasks_database_id'),
    /** People database ID (auto-created during onboarding) */
    notionPeopleDatabaseId: text('notion_people_database_id'),
    /** Notion bot ID from OAuth */
    notionBotId: text('notion_bot_id'),

    // User Preferences
    /** User's timezone (IANA format) */
    timezone: text('timezone').default('America/New_York').notNull(),
    /** Daily digest time in HH:MM format */
    digestTime: text('digest_time').default('08:00').notNull(),
    /** Hours before meeting to send reminder */
    meetingReminderHours: integer('meeting_reminder_hours').default(2).notNull(),

    // Status
    /** Current user status */
    status: userStatusEnum('status').default('onboarding').notNull(),
    /** Current step in onboarding flow */
    onboardingStep: text('onboarding_step').default('welcome'),

    // Stats
    /** Total tasks captured via SMS */
    totalTasksCaptured: integer('total_tasks_captured').default(0).notNull(),
    /** Total tasks marked complete */
    totalTasksCompleted: integer('total_tasks_completed').default(0).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_users_phone').on(table.phoneNumber),
    index('idx_users_status').on(table.status),
  ]
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
