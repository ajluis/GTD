import { pgTable, uuid, text, timestamp, date, pgEnum, index } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { people } from './people.js';

/**
 * GTD Task type enum
 */
export const taskTypeEnum = pgEnum('task_type', [
  'action', // Next physical action
  'project', // Multi-step outcome
  'waiting', // Waiting on someone
  'someday', // Future/maybe idea
  'agenda', // Discussion topic for a person
]);

/**
 * Task sync status enum
 */
export const taskStatusEnum = pgEnum('task_status', [
  'pending', // Created locally, not yet synced
  'synced', // Successfully synced to Notion
  'completed', // Marked done
  'discussed', // Agenda item discussed in meeting
  'failed', // Sync failed
]);

/**
 * Task priority enum
 */
export const taskPriorityEnum = pgEnum('task_priority', [
  'today', // 🔥 Today
  'this_week', // ⚡ This week
  'soon', // 📋 Soon
]);

/**
 * GTD Context enum
 */
export const taskContextEnum = pgEnum('task_context', [
  'work', // @work
  'home', // @home
  'errands', // @errands
  'calls', // @calls
  'computer', // @computer
  'anywhere', // @anywhere
]);

/**
 * Tasks table
 * Local record of tasks before and after Notion sync
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Reference to the owning user */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Notion page ID after sync */
    notionPageId: text('notion_page_id').unique(),

    // Task Content
    /** Original SMS text as received */
    rawText: text('raw_text').notNull(),

    /** Parsed/cleaned task title */
    title: text('title').notNull(),

    /** Additional notes or context */
    notes: text('notes'),

    // GTD Classification
    /** Task type (action, project, waiting, someday, agenda) */
    type: taskTypeEnum('type').notNull(),

    /** Sync/completion status */
    status: taskStatusEnum('status').default('pending').notNull(),

    /** GTD context for actions */
    context: taskContextEnum('context'),

    /** Priority level */
    priority: taskPriorityEnum('priority'),

    // Relationships
    /** Person associated with agenda/waiting items */
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),

    /** Parent project for sub-tasks */
    parentProjectId: uuid('parent_project_id').references((): any => tasks.id, {
      onDelete: 'set null',
    }),

    // Dates
    /** Due date or follow-up date */
    dueDate: date('due_date'),

    /** When task was completed */
    completedAt: timestamp('completed_at', { withTimezone: true }),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    /** Last successful Notion sync */
    syncedAt: timestamp('synced_at', { withTimezone: true }),

    /** Last sync error message */
    lastSyncError: text('last_sync_error'),
  },
  (table) => [
    index('idx_tasks_user_id').on(table.userId),
    index('idx_tasks_user_type_status').on(table.userId, table.type, table.status),
    index('idx_tasks_user_context').on(table.userId, table.context),
    index('idx_tasks_user_person').on(table.userId, table.personId),
    index('idx_tasks_user_due').on(table.userId, table.dueDate),
    index('idx_tasks_notion_page').on(table.notionPageId),
    index('idx_tasks_parent_project').on(table.parentProjectId),
  ]
);

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
