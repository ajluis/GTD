/**
 * GTD (Getting Things Done) Domain Types
 * Core types for task classification and management
 */

/** Task types in GTD methodology */
export type TaskType = 'action' | 'project' | 'waiting' | 'someday' | 'agenda';

/** Task status for local tracking */
export type TaskStatus = 'pending' | 'synced' | 'completed' | 'discussed' | 'failed';

/** GTD contexts for actions */
export type TaskContext = 'work' | 'home' | 'errands' | 'calls' | 'computer' | 'anywhere';

/** Task priority levels */
export type TaskPriority = 'today' | 'this_week' | 'soon';

/** Meeting frequency for People */
export type MeetingFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'as_needed';

/** Days of the week */
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/** User status during onboarding */
export type UserStatus = 'onboarding' | 'active' | 'paused';

/** Message direction */
export type MessageDirection = 'inbound' | 'outbound';

/** Message delivery status */
export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'received';

/**
 * AI Classification Result
 * Output from Gemini when classifying an incoming SMS
 *
 * Can be one of three categories:
 * 1. Task capture (action, project, waiting, someday, agenda)
 * 2. Intent (user wants to do something - query, edit, settings, etc.)
 * 3. Unknown (low confidence, needs clarification)
 */
export interface ClassificationResult {
  /** Classified type: task type, 'intent', 'needs_clarification', or 'unknown' */
  type: TaskType | 'intent' | 'command' | 'needs_clarification' | 'unknown';

  /** Detected command (legacy - for backwards compatibility) */
  command?: string;

  /** Intent detection result (if type is 'intent') */
  intent?: IntentResult;

  /** Cleaned/parsed task title (for task capture) */
  title?: string;

  /** Inferred context */
  context?: TaskContext;

  /** Inferred priority */
  priority?: TaskPriority;

  /** Matched person for agenda/waiting items */
  personMatch?: {
    personId: string;
    name: string;
    confidence: number;
  };

  /** Parsed due date (ISO format) */
  dueDate?: string;

  /** Classification confidence (0-1) */
  confidence: number;

  /** AI reasoning for classification */
  reasoning?: string;

  /** Partial task info when clarification is needed */
  partialTask?: {
    type: TaskType;
    title: string;
  };

  /** What information is missing */
  missingInfo?: string[];

  /** Natural language follow-up question to ask */
  followUpQuestion?: string;
}

/**
 * Conversation State Types
 * Used for multi-turn interactions
 */
export type ConversationStateType =
  | 'onboarding'
  | 'clarification'
  | 'post_meeting'
  | 'add_person'
  | 'waiting_followup';

export interface ConversationState {
  type: ConversationStateType;
  step?: string;
  data?: Record<string, unknown>;
  expiresAt: number;
}

/**
 * SMS Command Types (legacy - being replaced by IntentType)
 */
export type SMSCommand =
  | 'today'
  | 'actions'
  | 'projects'
  | 'waiting'
  | 'someday'
  | 'meetings'
  | 'done'
  | 'help'
  | '@work'
  | '@home'
  | '@errands'
  | '@calls'
  | '@computer';

/**
 * Person data for agenda matching
 */
export interface PersonForMatching {
  id: string;
  name: string;
  aliases: string[];
  frequency: MeetingFrequency | null;
  dayOfWeek: DayOfWeek | null;
}

/**
 * Intent Types
 * All possible user intents that the LLM can detect
 */
export type IntentType =
  // Queries - user wants to SEE information
  | 'query_today'
  | 'query_actions'
  | 'query_projects'
  | 'query_waiting'
  | 'query_someday'
  | 'query_context'
  | 'query_people'
  | 'query_person_agenda'
  // Task completion - user wants to MARK something done
  | 'complete_task'
  | 'complete_recent'
  | 'complete_person_agenda'
  // People management - user wants to MANAGE people
  | 'add_person'
  | 'remove_person'
  | 'set_alias'
  | 'set_schedule'
  // Settings - user wants to CHANGE preferences
  | 'set_digest_time'
  | 'set_timezone'
  | 'set_reminder_hours'
  | 'pause_account'
  | 'resume_account'
  | 'show_settings'
  // Task editing - user wants to MODIFY an existing task
  | 'reschedule_task'
  | 'set_task_priority'
  | 'set_task_context'
  | 'add_task_note'
  | 'rename_task'
  | 'delete_task'
  | 'assign_task_person'
  // Corrections - user wants to FIX a recent action
  | 'undo_last'
  | 'change_task_type'
  | 'correct_person'
  // Bulk operations
  | 'clear_person_agenda'
  | 'complete_all_today'
  // Information
  | 'show_stats'
  | 'show_help';

/**
 * Entities extracted from user message for intent handling
 */
export interface IntentEntities {
  /** Task text for searching (e.g., "dentist call") */
  taskText?: string;
  /** Person name for people operations */
  personName?: string;
  /** New value for updates (time, timezone, alias, etc.) */
  newValue?: string;
  /** Context for context operations */
  context?: TaskContext;
  /** Priority for priority operations */
  priority?: TaskPriority;
  /** Due date for scheduling */
  dueDate?: string;
  /** Task type for type changes */
  taskType?: TaskType;
  /** Day of week for schedule setting */
  dayOfWeek?: DayOfWeek;
  /** Meeting frequency for schedule setting */
  frequency?: MeetingFrequency;
  /** Note content for adding notes */
  noteContent?: string;
  /** Aliases for alias setting */
  aliases?: string[];
}

/**
 * Intent detection result
 * Returned when user wants to DO something (not capture a task)
 */
export interface IntentResult {
  /** The detected intent */
  intent: IntentType;
  /** Confidence in the intent detection (0-1) */
  confidence: number;
  /** Extracted entities from the message */
  entities: IntentEntities;
  /** AI reasoning for the intent detection */
  reasoning?: string;
}
