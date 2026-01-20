/**
 * Context System Types
 *
 * Type definitions for the rich context system that enables
 * intelligent task inference and personalized agent behavior.
 *
 * The context system has four layers:
 * 1. Preferences - User-configured rules and mappings
 * 2. Patterns - Learned behaviors from user interactions
 * 3. Session - Active conversation state
 * 4. Entities - Known people, projects, and recurring items
 */

// ============================================================================
// Core Context Types
// ============================================================================

/**
 * Complete user context for agent decision-making
 */
export interface UserContext {
  /** User ID */
  userId: string;

  /** Explicit user preferences */
  preferences: UserPreferences;

  /** Patterns learned from user behavior */
  patterns: LearnedPatterns;

  /** Current session state */
  session: SessionContext;

  /** Known entities */
  entities: UserEntities;

  /** When context was last updated */
  updatedAt: Date;
}

/**
 * User-configured preferences and rules
 */
export interface UserPreferences {
  /** Default project for unspecified tasks */
  defaultProject?: string;

  /** Working hours (for time-based inference) */
  workingHours?: {
    start: string; // HH:MM
    end: string; // HH:MM
    timezone: string;
  };

  /** Keyword to label mappings */
  labelMappings: Record<string, string[]>;

  /** Keyword to project mappings */
  projectMappings: Record<string, string>;

  /** Priority keywords */
  priorityKeywords: {
    high: string[];
    medium: string[];
    low: string[];
  };

  /** Default context (GTD context) */
  defaultContext?: 'computer' | 'phone' | 'home' | 'outside';

  /** Custom date phrases */
  dateAliases: Record<string, string>;
}

/**
 * Patterns learned from user behavior
 */
export interface LearnedPatterns {
  /** Typical times for recurring phrases */
  typicalTaskTimes: Record<string, string>;

  /** Most commonly used labels */
  commonLabels: string[];

  /** Most frequently used projects */
  frequentProjects: string[];

  /** Word associations learned from corrections */
  wordAssociations: WordAssociation[];

  /** Task type patterns (what type of task certain phrases usually become) */
  taskTypePatterns: TaskTypePattern[];

  /** Person mention patterns */
  personPatterns: PersonPattern[];
}

/**
 * Word association learned from user corrections
 */
export interface WordAssociation {
  /** Trigger word or phrase */
  trigger: string;
  /** What it maps to */
  target: {
    project?: string;
    labels?: string[];
    priority?: number;
    context?: string;
  };
  /** How confident we are (0-1) */
  confidence: number;
  /** Number of times this pattern was observed */
  occurrences: number;
  /** When this was last updated */
  lastUsed: Date;
}

/**
 * Task type pattern
 */
export interface TaskTypePattern {
  /** Trigger phrase/keyword */
  trigger: string;
  /** Task type it usually maps to */
  taskType: 'action' | 'project' | 'waiting' | 'someday' | 'agenda';
  /** Confidence score */
  confidence: number;
  /** Occurrence count */
  occurrences: number;
}

/**
 * Person mention pattern
 */
export interface PersonPattern {
  /** How the person is mentioned (e.g., "call sarah", "sarah's stuff") */
  mentionPattern: string;
  /** Person ID in the system */
  personId: string;
  /** Person name for display */
  personName: string;
  /** Confidence score */
  confidence: number;
}

/**
 * Current session context (active conversation state)
 */
export interface SessionContext {
  /** Recently created/modified tasks (for "that", "the first one") */
  recentTasks: TaskRef[];

  /** Recently mentioned projects */
  recentProjects: string[];

  /** Current topic being discussed */
  currentTopic?: string;

  /** People mentioned in this session */
  mentionedPeople: PersonRef[];

  /** Active multi-turn flow (if any) */
  activeFlow?: {
    type: 'weekly_review' | 'bulk_confirm' | 'clarification' | 'brain_dump';
    state: unknown;
    startedAt: Date;
  };

  /** Last created task ID (for immediate edits) */
  lastCreatedTaskId?: string;

  /** Undo stack (last 5 reversible actions) */
  undoStack: UndoInfo[];

  /** When session started */
  startedAt: Date;

  /** When session was last active */
  lastActivityAt: Date;
}

/**
 * Task reference for session context
 */
export interface TaskRef {
  id: string;
  title: string;
  todoistId?: string;
  type?: 'action' | 'project' | 'waiting' | 'someday' | 'agenda';
  project?: string;
  createdAt: Date;
}

/**
 * Person reference for session context
 */
export interface PersonRef {
  id: string;
  name: string;
  aliases?: string[];
}

/**
 * Undo information
 */
export interface UndoInfo {
  type: 'create' | 'update' | 'delete' | 'complete';
  taskId: string;
  todoistId?: string;
  previousState?: unknown;
  timestamp: Date;
}

/**
 * Known entities (people, projects, recurring items)
 */
export interface UserEntities {
  /** People in the user's agenda system */
  people: PersonEntity[];

  /** Projects from Todoist (cached) */
  projects: ProjectEntity[];

  /** Labels from Todoist (cached) */
  labels: LabelEntity[];

  /** Recurring task patterns */
  recurringPatterns: RecurringPattern[];

  /** When entities were last synced */
  lastSyncedAt: Date;
}

/**
 * Person entity
 */
export interface PersonEntity {
  id: string;
  name: string;
  aliases: string[];
  frequency?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'as_needed';
  dayOfWeek?: string;
  todoistLabel?: string;
  relationship?: 'colleague' | 'friend' | 'family' | 'client' | 'other';
  /** Keywords associated with this person */
  associatedKeywords?: string[];
  active: boolean;
}

/**
 * Project entity (from Todoist)
 */
export interface ProjectEntity {
  id: string;
  name: string;
  /** Flattened hierarchy name (e.g., "Work / Project Apollo") */
  hierarchyName: string;
  parentId?: string;
  isInbox: boolean;
  /** Keywords that suggest this project */
  keywords?: string[];
}

/**
 * Label entity (from Todoist)
 */
export interface LabelEntity {
  id: string;
  name: string;
  /** Is this a GTD context label? */
  isContext: boolean;
  /** Is this a person label? */
  isPerson: boolean;
}

/**
 * Recurring task pattern
 */
export interface RecurringPattern {
  /** Description of the recurring task */
  description: string;
  /** Cron-like schedule */
  schedule: string;
  /** Default project */
  project?: string;
  /** Default labels */
  labels?: string[];
  /** Is this pattern active? */
  active: boolean;
}

// ============================================================================
// Context Update Types
// ============================================================================

/**
 * Context update from an interaction
 */
export interface ContextUpdate {
  /** Type of update */
  type: 'task_created' | 'task_completed' | 'task_updated' | 'correction' | 'preference_set';

  /** The message that triggered this */
  message: string;

  /** Tool calls that were made */
  toolCalls?: ToolCallInfo[];

  /** Agent response */
  response: string;

  /** Entities to track */
  entities?: {
    tasks?: TaskRef[];
    people?: PersonRef[];
    projects?: string[];
  };

  /** Learning signal (if user corrected something) */
  correction?: CorrectionSignal;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Tool call information for context updates
 */
export interface ToolCallInfo {
  tool: string;
  params: Record<string, unknown>;
  success: boolean;
}

/**
 * Correction signal for learning
 */
export interface CorrectionSignal {
  /** What was originally inferred */
  original: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
  };

  /** What the user corrected it to */
  corrected: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
  };

  /** The original task content */
  taskContent: string;

  /** Keywords that might be triggers */
  potentialTriggers: string[];
}

// ============================================================================
// Default Values
// ============================================================================

/**
 * Default user preferences
 */
export const DEFAULT_PREFERENCES: UserPreferences = {
  labelMappings: {
    call: ['@calls', '@phone'],
    email: ['@computer'],
    buy: ['@errands'],
    fix: ['@computer'],
    review: ['@computer'],
    read: ['@anywhere'],
    write: ['@computer'],
  },
  projectMappings: {},
  priorityKeywords: {
    high: ['urgent', 'asap', 'critical', 'important', 'immediately'],
    medium: ['soon', 'this week'],
    low: ['someday', 'maybe', 'eventually', 'when possible'],
  },
  dateAliases: {
    eod: 'today',
    eow: 'friday',
    'next week': 'monday',
  },
};

/**
 * Default learned patterns (empty)
 */
export const DEFAULT_PATTERNS: LearnedPatterns = {
  typicalTaskTimes: {},
  commonLabels: [],
  frequentProjects: [],
  wordAssociations: [],
  taskTypePatterns: [],
  personPatterns: [],
};

/**
 * Create empty session context
 */
export function createEmptySession(): SessionContext {
  const now = new Date();
  return {
    recentTasks: [],
    recentProjects: [],
    mentionedPeople: [],
    undoStack: [],
    startedAt: now,
    lastActivityAt: now,
  };
}

/**
 * Create empty user entities
 */
export function createEmptyEntities(): UserEntities {
  return {
    people: [],
    projects: [],
    labels: [],
    recurringPatterns: [],
    lastSyncedAt: new Date(0), // Force initial sync
  };
}
