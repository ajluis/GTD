/**
 * Context Database Schema
 *
 * Stores user preferences, learned patterns, and conversation memory
 * for the intelligent agent system.
 *
 * Key tables:
 * - user_preferences: Explicit user-configured rules
 * - user_patterns: Learned behaviors from corrections
 * - conversation_memory: Summarized conversation history
 */

import { pgTable, uuid, text, timestamp, jsonb, index, boolean, integer } from 'drizzle-orm/pg-core';
import { users } from './users.js';

// ============================================================================
// User Preferences
// ============================================================================

/**
 * User preferences for task inference
 *
 * Stores explicit rules the user has configured:
 * - Label mappings (keywords → labels)
 * - Project mappings (keywords → projects)
 * - Default project
 * - Working hours
 */
export const userPreferences = pgTable(
  'user_preferences',
  {
    /** User ID (primary key, references users) */
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Default project for unspecified tasks */
    defaultProject: text('default_project'),

    /** Working hours configuration */
    workingHours: jsonb('working_hours').$type<{
      start: string;
      end: string;
      timezone: string;
    } | null>(),

    /** Keyword to label mappings */
    labelMappings: jsonb('label_mappings')
      .$type<Record<string, string[]>>()
      .default({})
      .notNull(),

    /** Keyword to project mappings */
    projectMappings: jsonb('project_mappings')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),

    /** Priority keyword mappings */
    priorityKeywords: jsonb('priority_keywords')
      .$type<{
        high: string[];
        medium: string[];
        low: string[];
      }>()
      .default({ high: [], medium: [], low: [] })
      .notNull(),

    /** Default GTD context */
    defaultContext: text('default_context').$type<
      'computer' | 'phone' | 'home' | 'outside' | null
    >(),

    /** Custom date phrase aliases */
    dateAliases: jsonb('date_aliases')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),

    /** When preferences were last updated */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

export type UserPreferencesRecord = typeof userPreferences.$inferSelect;
export type NewUserPreferencesRecord = typeof userPreferences.$inferInsert;

// ============================================================================
// Learned Patterns
// ============================================================================

/**
 * Word association learned from user corrections
 */
interface WordAssociationData {
  trigger: string;
  target: {
    project?: string;
    labels?: string[];
    priority?: number;
    context?: string;
  };
  confidence: number;
  occurrences: number;
  lastUsed: string; // ISO date
}

/**
 * Task type pattern data
 */
interface TaskTypePatternData {
  trigger: string;
  taskType: 'action' | 'project' | 'waiting' | 'someday' | 'agenda';
  confidence: number;
  occurrences: number;
}

/**
 * Person mention pattern data
 */
interface PersonPatternData {
  mentionPattern: string;
  personId: string;
  personName: string;
  confidence: number;
}

/**
 * User patterns learned from behavior
 *
 * Stores inferred patterns from user corrections and usage:
 * - Word associations
 * - Task type patterns
 * - Person mention patterns
 * - Frequency data (common labels, frequent projects)
 */
export const userPatterns = pgTable(
  'user_patterns',
  {
    /** User ID (primary key, references users) */
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Typical times for recurring phrases (e.g., "standup" → "9:00am") */
    typicalTaskTimes: jsonb('typical_task_times')
      .$type<Record<string, string>>()
      .default({})
      .notNull(),

    /** Most commonly used labels */
    commonLabels: jsonb('common_labels')
      .$type<string[]>()
      .default([])
      .notNull(),

    /** Most frequently used projects */
    frequentProjects: jsonb('frequent_projects')
      .$type<string[]>()
      .default([])
      .notNull(),

    /** Word associations learned from corrections */
    wordAssociations: jsonb('word_associations')
      .$type<WordAssociationData[]>()
      .default([])
      .notNull(),

    /** Task type patterns */
    taskTypePatterns: jsonb('task_type_patterns')
      .$type<TaskTypePatternData[]>()
      .default([])
      .notNull(),

    /** Person mention patterns */
    personPatterns: jsonb('person_patterns')
      .$type<PersonPatternData[]>()
      .default([])
      .notNull(),

    /** Total corrections processed (for stats) */
    totalCorrections: integer('total_corrections').default(0).notNull(),

    /** When patterns were last updated */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  }
);

export type UserPatternsRecord = typeof userPatterns.$inferSelect;
export type NewUserPatternsRecord = typeof userPatterns.$inferInsert;

// ============================================================================
// Conversation Memory
// ============================================================================

/**
 * Key entity extracted from conversation
 */
interface ConversationEntity {
  type: 'task' | 'person' | 'project' | 'topic';
  id?: string;
  name: string;
  context?: string;
}

/**
 * Conversation memory for context continuity
 *
 * Stores summarized conversation history for long-term context:
 * - Summaries of past interactions
 * - Key entities mentioned
 * - Important decisions or preferences expressed
 */
export const conversationMemory = pgTable(
  'conversation_memory',
  {
    /** Unique ID */
    id: uuid('id').primaryKey().defaultRandom(),

    /** User ID */
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    /** Summary of the conversation/interaction */
    summary: text('summary').notNull(),

    /** Key entities extracted from this memory */
    keyEntities: jsonb('key_entities')
      .$type<ConversationEntity[]>()
      .default([])
      .notNull(),

    /** Memory type for categorization */
    memoryType: text('memory_type')
      .$type<'interaction' | 'preference' | 'correction' | 'important'>()
      .default('interaction')
      .notNull(),

    /** Relevance score for retrieval (higher = more relevant) */
    relevanceScore: integer('relevance_score').default(50).notNull(),

    /** Number of times this memory has been retrieved */
    retrievalCount: integer('retrieval_count').default(0).notNull(),

    /** When this memory was created */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

    /** When this memory was last retrieved */
    lastRetrievedAt: timestamp('last_retrieved_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_conversation_memory_user').on(table.userId),
    index('idx_conversation_memory_type').on(table.userId, table.memoryType),
    index('idx_conversation_memory_relevance').on(table.userId, table.relevanceScore),
    index('idx_conversation_memory_created').on(table.userId, table.createdAt),
  ]
);

export type ConversationMemoryRecord = typeof conversationMemory.$inferSelect;
export type NewConversationMemoryRecord = typeof conversationMemory.$inferInsert;

// ============================================================================
// Entity Cache
// ============================================================================

/**
 * Cached Todoist entities
 *
 * Stores cached projects and labels from Todoist
 * to avoid repeated API calls and enable offline inference.
 */
export const todoistEntityCache = pgTable(
  'todoist_entity_cache',
  {
    /** User ID (primary key, references users) */
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** Cached projects */
    projects: jsonb('projects')
      .$type<
        Array<{
          id: string;
          name: string;
          hierarchyName: string;
          parentId?: string;
          isInbox: boolean;
          keywords?: string[];
        }>
      >()
      .default([])
      .notNull(),

    /** Cached labels */
    labels: jsonb('labels')
      .$type<
        Array<{
          id: string;
          name: string;
          isContext: boolean;
          isPerson: boolean;
        }>
      >()
      .default([])
      .notNull(),

    /** When cache was last updated */
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),

    /** Cache expiry time */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  }
);

export type TodoistEntityCacheRecord = typeof todoistEntityCache.$inferSelect;
export type NewTodoistEntityCacheRecord = typeof todoistEntityCache.$inferInsert;
