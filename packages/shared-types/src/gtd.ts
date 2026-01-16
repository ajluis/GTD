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
 */
export interface ClassificationResult {
  /** Classified task type */
  type: TaskType | 'command' | 'unknown';

  /** Detected command (if type is 'command') */
  command?: string;

  /** Cleaned/parsed task title */
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
 * SMS Command Types
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
