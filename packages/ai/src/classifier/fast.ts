/**
 * Fast Classifier
 * Lightweight classification without full people list
 */

import { createGeminiClient, GeminiClient } from '../gemini-client.js';
import {
  FAST_CLASSIFY_SYSTEM,
  buildFastClassifyPrompt,
} from './prompts.js';
import type { FastClassifyResult } from '../tools/types.js';

/**
 * Options for fast classification
 */
export interface FastClassifyOptions {
  /** The message to classify */
  message: string;
  /** User's timezone */
  timezone: string;
  /** Current time */
  currentTime: Date;
  /** Recent messages for context (last 2-3) */
  recentMessages?: Array<{ role: string; content: string }>;
  /**
   * Available Todoist project names for AI routing
   * If provided, classifier will select the most appropriate project for tasks
   */
  availableProjects?: string[];
}

/**
 * Fast classifier class
 */
export class FastClassifier {
  private client: GeminiClient;

  constructor(client?: GeminiClient) {
    this.client = client ?? createGeminiClient();
  }

  /**
   * Classify a message quickly without full context
   */
  async classify(options: FastClassifyOptions): Promise<FastClassifyResult> {
    const { message, timezone, currentTime, recentMessages, availableProjects } = options;

    const prompt = buildFastClassifyPrompt(
      message,
      timezone,
      currentTime,
      recentMessages,
      availableProjects
    );

    try {
      const result = await this.client.generateJSON<FastClassifyResult>(
        prompt,
        FAST_CLASSIFY_SYSTEM
      );

      // Validate and normalize result
      return this.normalizeResult(result);
    } catch (error) {
      console.error('[FastClassifier] Error:', error);

      // Return unknown on error
      return {
        type: 'unknown',
        needsDataLookup: false,
        confidence: 0,
        reasoning: `Classification error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  /**
   * Normalize and validate classification result
   */
  private normalizeResult(result: FastClassifyResult): FastClassifyResult {
    // Ensure type is valid
    const validTypes = ['task', 'multi_item', 'intent', 'needs_clarification', 'unknown'];
    if (!validTypes.includes(result.type)) {
      result.type = 'unknown';
    }

    // Ensure confidence is between 0 and 1
    result.confidence = Math.max(0, Math.min(1, result.confidence ?? 0.5));

    // Ensure needsDataLookup is boolean
    result.needsDataLookup = Boolean(result.needsDataLookup);

    // Normalize task capture
    if (result.taskCapture) {
      result.taskCapture = this.normalizeTaskCapture(result.taskCapture);
    }

    // Normalize multi-item
    if (result.items && Array.isArray(result.items)) {
      result.items = result.items.map((item) => this.normalizeTaskCapture(item));
    }

    return result;
  }

  /**
   * Normalize a task capture object
   */
  private normalizeTaskCapture<
    T extends {
      title?: string;
      type?: string;
      context?: string;
      priority?: string;
      dueDate?: string;
      personName?: string;
      targetProject?: string;
    }
  >(task: T): T {
    // Ensure type is valid
    const validTypes = ['action', 'project', 'waiting', 'someday', 'agenda'];
    if (!task.type || !validTypes.includes(task.type)) {
      task.type = 'action';
    }

    // Normalize context
    const validContexts = ['computer', 'phone', 'home', 'outside'];
    if (task.context && !validContexts.includes(task.context)) {
      delete task.context;
    }

    // Normalize priority
    const validPriorities = ['today', 'this_week', 'soon'];
    if (task.priority && !validPriorities.includes(task.priority)) {
      task.priority = 'soon';
    }

    // Validate date format
    if (task.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)) {
      delete task.dueDate;
    }

    // Clean title
    if (task.title) {
      task.title = task.title.trim();
      // Remove common prefixes
      task.title = task.title
        .replace(/^(let's|i need to|i should|can you|please|just|gotta|need to|want to)\s+/i, '')
        .trim();
      // Capitalize first letter
      task.title = task.title.charAt(0).toUpperCase() + task.title.slice(1);
    }

    return task;
  }
}

/**
 * Create a fast classifier instance
 */
export function createFastClassifier(client?: GeminiClient): FastClassifier {
  return new FastClassifier(client);
}
