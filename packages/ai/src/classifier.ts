import type {
  ClassificationResult,
  PersonForMatching,
  IntentResult,
  IntentType,
  IntentEntities,
} from '@gtd/shared-types';
import { GeminiClient, createGeminiClient } from './gemini-client.js';
import {
  buildClassificationPrompt,
  CLASSIFIER_SYSTEM_PROMPT,
  type ConversationMessage,
  type RecentTaskContext,
} from './prompts/classify-task.js';

/**
 * GTD Message Classifier
 *
 * Uses Gemini AI to classify incoming SMS messages:
 * 1. Detect INTENTS (user wants to do something)
 * 2. Classify TASK CAPTURE (user wants to save something)
 */
export class GTDClassifier {
  private gemini: GeminiClient;

  constructor(gemini?: GeminiClient) {
    this.gemini = gemini ?? createGeminiClient();
  }

  /**
   * Classify an incoming SMS message
   *
   * @param message - Raw SMS message text
   * @param people - User's configured people for agenda matching
   * @param currentTime - Current time for date parsing (optional)
   * @param conversationHistory - Recent conversation messages for context (optional)
   * @param mode - 'classify' (default) or 'extract' (for re-classification after clarification)
   * @param timezone - User's timezone for date calculations (default: America/New_York)
   * @param recentTasks - User's recent tasks for context (helps answer questions about existing tasks)
   * @returns Classification result with type, intent, or task details
   */
  async classify(
    message: string,
    people: PersonForMatching[] = [],
    currentTime: Date = new Date(),
    conversationHistory: ConversationMessage[] = [],
    mode: 'classify' | 'extract' = 'classify',
    timezone: string = 'America/New_York',
    recentTasks: RecentTaskContext[] = []
  ): Promise<ClassificationResult> {
    const prompt = buildClassificationPrompt(message, people, currentTime, conversationHistory, mode, timezone, recentTasks);

    try {
      const result = await this.gemini.generateJSON<RawClassificationResult>(
        prompt,
        CLASSIFIER_SYSTEM_PROMPT
      );

      // Validate and normalize the result
      return this.normalizeResult(result, message);
    } catch (error) {
      // If AI fails, return unknown with low confidence
      console.error('[GTDClassifier] Classification failed:', error);

      return {
        type: 'unknown',
        title: message,
        confidence: 0,
        reasoning: `Classification failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Normalize and validate the raw AI response
   */
  private normalizeResult(
    raw: RawClassificationResult,
    originalMessage: string
  ): ClassificationResult {
    // Check if this is an intent response
    if (raw.type === 'intent' && raw.intent) {
      return this.normalizeIntentResult(raw, originalMessage);
    }

    // Check if this needs clarification
    if (raw.type === 'needs_clarification' && raw.followUpQuestion) {
      return this.normalizeClarificationResult(raw, originalMessage);
    }

    // Otherwise, it's a task capture or unknown
    return this.normalizeTaskResult(raw, originalMessage);
  }

  /**
   * Normalize a needs_clarification result
   */
  private normalizeClarificationResult(
    raw: RawClassificationResult,
    originalMessage: string
  ): ClassificationResult {
    const confidence = typeof raw.confidence === 'number'
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.8;

    return {
      type: 'needs_clarification',
      confidence,
      reasoning: raw.reasoning,
      partialTask: raw.partialTask ? {
        type: raw.partialTask.type as any || 'action',
        title: raw.partialTask.title || originalMessage,
      } : {
        type: 'action',
        title: originalMessage,
      },
      missingInfo: Array.isArray(raw.missingInfo) ? raw.missingInfo : [],
      followUpQuestion: raw.followUpQuestion || "Can you tell me more about this task?",
    };
  }

  /**
   * Normalize an intent classification result
   */
  private normalizeIntentResult(
    raw: RawClassificationResult,
    _originalMessage: string
  ): ClassificationResult {
    const rawIntent = raw.intent!;

    // Validate intent type
    const validIntents = VALID_INTENTS;
    const intentType = validIntents.includes(rawIntent.intent as IntentType)
      ? (rawIntent.intent as IntentType)
      : 'show_help'; // Default to help if unknown intent

    // Normalize confidence
    const intentConfidence = typeof rawIntent.confidence === 'number'
      ? Math.max(0, Math.min(1, rawIntent.confidence))
      : 0.8;

    const overallConfidence = typeof raw.confidence === 'number'
      ? Math.max(0, Math.min(1, raw.confidence))
      : intentConfidence;

    // Normalize entities (use bracket notation for index signature access)
    const entities: IntentEntities = {};
    const rawEntities = rawIntent.entities ?? {};

    if (rawEntities['taskText']) {
      entities.taskText = String(rawEntities['taskText']).trim();
    }
    if (rawEntities['personName']) {
      entities.personName = String(rawEntities['personName']).trim();
    }
    if (rawEntities['newValue']) {
      entities.newValue = String(rawEntities['newValue']).trim();
    }
    if (rawEntities['context'] && isValidContext(String(rawEntities['context']))) {
      entities.context = rawEntities['context'] as IntentEntities['context'];
    }
    if (rawEntities['priority'] && isValidPriority(String(rawEntities['priority']))) {
      entities.priority = rawEntities['priority'] as IntentEntities['priority'];
    }
    if (rawEntities['dueDate'] && isValidDate(String(rawEntities['dueDate']))) {
      entities.dueDate = String(rawEntities['dueDate']);
    }
    if (rawEntities['taskType'] && isValidTaskType(String(rawEntities['taskType']))) {
      entities.taskType = rawEntities['taskType'] as IntentEntities['taskType'];
    }
    if (rawEntities['dayOfWeek'] && isValidDayOfWeek(String(rawEntities['dayOfWeek']))) {
      entities.dayOfWeek = rawEntities['dayOfWeek'] as IntentEntities['dayOfWeek'];
    }
    if (rawEntities['frequency'] && isValidFrequency(String(rawEntities['frequency']))) {
      entities.frequency = rawEntities['frequency'] as IntentEntities['frequency'];
    }
    if (rawEntities['noteContent']) {
      entities.noteContent = String(rawEntities['noteContent']).trim();
    }
    if (Array.isArray(rawEntities['aliases'])) {
      entities.aliases = (rawEntities['aliases'] as unknown[]).map((a) => String(a).trim());
    }

    const intent: IntentResult = {
      intent: intentType,
      confidence: intentConfidence,
      entities,
      reasoning: rawIntent.reasoning,
    };

    return {
      type: 'intent',
      intent,
      confidence: overallConfidence,
      reasoning: rawIntent.reasoning,
    };
  }

  /**
   * Normalize a task capture classification result
   */
  private normalizeTaskResult(
    raw: RawClassificationResult,
    originalMessage: string
  ): ClassificationResult {
    // Ensure type is valid
    const validTypes = [
      'action',
      'project',
      'agenda',
      'waiting',
      'someday',
      'command', // Legacy support
      'unknown',
    ] as const;
    const type = validTypes.includes(raw.type as any)
      ? (raw.type as ClassificationResult['type'])
      : 'unknown';

    // Ensure confidence is a valid number between 0 and 1
    const confidence = typeof raw.confidence === 'number'
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;

    // Build normalized result
    const result: ClassificationResult = {
      type,
      confidence,
    };

    // Legacy command support
    if (type === 'command' && raw.command) {
      result.command = raw.command.toLowerCase().trim();
    }

    // Add title (fallback to original message)
    // Apply defensive cleanup to remove casual prefixes the LLM might have missed
    if (type !== 'command') {
      const rawTitle = raw.title?.trim() || originalMessage;
      result.title = cleanupTaskTitle(rawTitle);
    }

    // Add optional fields if present and valid
    if (raw.context && isValidContext(raw.context)) {
      result.context = raw.context as ClassificationResult['context'];
    }

    if (raw.priority && isValidPriority(raw.priority)) {
      result.priority = raw.priority as ClassificationResult['priority'];
    }

    if (raw.personMatch && typeof raw.personMatch === 'object') {
      result.personMatch = {
        personId: raw.personMatch.personId || '',
        name: raw.personMatch.name || '',
        confidence: typeof raw.personMatch.confidence === 'number'
          ? Math.max(0, Math.min(1, raw.personMatch.confidence))
          : 0,
      };
    }

    if (raw.dueDate && isValidDate(raw.dueDate)) {
      result.dueDate = raw.dueDate;
    }

    if (raw.reasoning) {
      result.reasoning = raw.reasoning;
    }

    return result;
  }
}

/**
 * Raw classification result from Gemini (before validation)
 */
interface RawClassificationResult {
  type: string;
  command?: string;
  intent?: {
    intent: string;
    confidence?: number;
    entities?: Record<string, any>;
    reasoning?: string;
  };
  title?: string;
  context?: string;
  priority?: string;
  personMatch?: {
    personId?: string;
    name?: string;
    confidence?: number;
  };
  dueDate?: string;
  confidence?: number;
  reasoning?: string;
  // Clarification fields
  partialTask?: {
    type?: string;
    title?: string;
  };
  missingInfo?: string[];
  followUpQuestion?: string;
}

/**
 * Valid intent types
 */
const VALID_INTENTS: IntentType[] = [
  // Queries
  'query_today',
  'query_tomorrow',
  'query_actions',
  'query_projects',
  'query_waiting',
  'query_someday',
  'query_context',
  'query_people',
  'query_person_agenda',
  'query_specific_task',
  // Completion
  'complete_task',
  'complete_recent',
  'complete_person_agenda',
  // People management
  'add_person',
  'remove_person',
  'set_alias',
  'set_schedule',
  // Settings
  'set_digest_time',
  'set_timezone',
  'set_reminder_hours',
  'set_review_day',
  'set_review_time',
  'pause_account',
  'resume_account',
  'show_settings',
  // Task editing
  'reschedule_task',
  'set_task_priority',
  'set_task_context',
  'add_task_note',
  'rename_task',
  'delete_task',
  'assign_task_person',
  // Corrections
  'undo_last',
  'change_task_type',
  'correct_person',
  // Bulk
  'clear_person_agenda',
  'complete_all_today',
  'complete_all_context',
  // Info
  'show_stats',
  'show_help',
  'show_weekly_review',
];

/**
 * Validation helpers
 */
const VALID_CONTEXTS = ['computer', 'phone', 'home', 'outside'] as const;
const VALID_PRIORITIES = ['today', 'this_week', 'soon'] as const;
const VALID_TASK_TYPES = ['action', 'project', 'waiting', 'someday', 'agenda'] as const;
const VALID_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'as_needed'] as const;

function isValidContext(context: string): boolean {
  return VALID_CONTEXTS.includes(context as any);
}

/**
 * Remove casual prefixes from task titles that the LLM might have missed
 * This is a defensive cleanup to ensure titles are clean even if the prompt is ignored
 */
function cleanupTaskTitle(title: string): string {
  // Prefixes to remove (case-insensitive)
  const prefixPatterns = [
    /^let['']?s\s+/i,
    /^i\s+need\s+to\s+/i,
    /^i\s+should\s+/i,
    /^can\s+you\s+(add\s+)?/i,
    /^could\s+you\s+(add\s+)?/i,
    /^we\s+should\s+/i,
    /^we\s+need\s+to\s+/i,
    /^you\s+should\s+/i,
    /^don['']?t\s+forget\s+to\s+/i,
    /^remember\s+to\s+/i,
    /^please\s+/i,
    /^just\s+/i,
    /^gotta\s+/i,
    /^need\s+to\s+/i,
    /^want\s+to\s+/i,
    /^i\s+want\s+to\s+/i,
  ];

  let cleaned = title;
  for (const pattern of prefixPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Capitalize first letter if it's now lowercase
  const firstChar = cleaned.charAt(0);
  if (cleaned.length > 0 && firstChar && firstChar !== firstChar.toUpperCase()) {
    cleaned = firstChar.toUpperCase() + cleaned.slice(1);
  }

  return cleaned.trim();
}

function isValidPriority(priority: string): boolean {
  return VALID_PRIORITIES.includes(priority as any);
}

function isValidTaskType(taskType: string): boolean {
  return VALID_TASK_TYPES.includes(taskType as any);
}

function isValidDayOfWeek(day: string): boolean {
  return VALID_DAYS.includes(day.toLowerCase() as any);
}

function isValidFrequency(frequency: string): boolean {
  return VALID_FREQUENCIES.includes(frequency as any);
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date));
}

/**
 * Create a classifier instance
 */
export function createClassifier(gemini?: GeminiClient): GTDClassifier {
  return new GTDClassifier(gemini);
}
