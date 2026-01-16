import type { ClassificationResult, PersonForMatching } from '@clarity/shared-types';
import { GeminiClient, createGeminiClient } from './gemini-client.js';
import {
  buildClassificationPrompt,
  CLASSIFIER_SYSTEM_PROMPT,
} from './prompts/classify-task.js';

/**
 * GTD Message Classifier
 *
 * Uses Gemini AI to classify incoming SMS messages into GTD task types,
 * match person references, and infer context/priority.
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
   * @returns Classification result with type, title, context, etc.
   */
  async classify(
    message: string,
    people: PersonForMatching[] = [],
    currentTime: Date = new Date()
  ): Promise<ClassificationResult> {
    const prompt = buildClassificationPrompt(message, people, currentTime);

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
    // Ensure type is valid
    const validTypes = [
      'action',
      'project',
      'agenda',
      'waiting',
      'someday',
      'command',
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

    // Add command if present
    if (type === 'command' && raw.command) {
      result.command = raw.command.toLowerCase().trim();
    }

    // Add title (fallback to original message)
    if (type !== 'command') {
      result.title = raw.title?.trim() || originalMessage;
    }

    // Add optional fields if present and valid
    if (raw.context && isValidContext(raw.context)) {
      result.context = raw.context;
    }

    if (raw.priority && isValidPriority(raw.priority)) {
      result.priority = raw.priority;
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
}

/**
 * Type guards for validation
 */
function isValidContext(context: string): context is ClassificationResult['context'] {
  return ['work', 'home', 'errands', 'calls', 'computer', 'anywhere'].includes(context);
}

function isValidPriority(priority: string): priority is ClassificationResult['priority'] {
  return ['today', 'this_week', 'soon'].includes(priority);
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
