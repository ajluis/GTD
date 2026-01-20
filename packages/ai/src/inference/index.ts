/**
 * Task Inference Engine
 *
 * Uses context to automatically infer task details:
 * - Project (based on keywords, recent activity, person associations)
 * - Labels (from GTD contexts, person tags, learned patterns)
 * - Priority (from urgency words, learned patterns)
 * - Due dates (from natural language, typical times)
 *
 * The inference engine is the "intelligence layer" that makes the agent
 * feel personalized and context-aware.
 */

import type { GeminiClient } from '../gemini-client.js';
import type { TaskType, TaskContext, TaskPriority } from '@gtd/shared-types';

// ============================================================================
// Types
// ============================================================================

/**
 * Inferred task details
 */
export interface InferredTask {
  /** Cleaned task content */
  content: string;
  /** Original raw text */
  rawText: string;
  /** Inferred task type */
  type: TaskType;
  /** Inferred project */
  project?: InferredField<string>;
  /** Inferred labels */
  labels?: InferredField<string[]>;
  /** Inferred due date (natural language or ISO) */
  dueDate?: InferredField<string>;
  /** Inferred priority (1-4, Todoist format) */
  priority?: InferredField<1 | 2 | 3 | 4>;
  /** Inferred GTD context */
  context?: InferredField<TaskContext>;
  /** Inferred person (for agenda/waiting items) */
  person?: InferredField<{ id: string; name: string }>;
  /** Overall confidence in the inference */
  overallConfidence: number;
  /** Reasoning for the inferences (for transparency) */
  reasoning: string;
}

/**
 * An inferred field with confidence and reason
 */
export interface InferredField<T> {
  value: T;
  confidence: number;
  reason: string;
}

/**
 * User context for inference (simplified from full UserContext)
 */
export interface InferenceContext {
  /** User's preferences */
  preferences: {
    defaultProject?: string;
    labelMappings: Record<string, string[]>;
    projectMappings: Record<string, string>;
    priorityKeywords: {
      high: string[];
      medium: string[];
      low: string[];
    };
  };
  /** Learned patterns */
  patterns: {
    frequentProjects: string[];
    wordAssociations: Array<{
      trigger: string;
      target: {
        project?: string;
        labels?: string[];
        priority?: number;
      };
      confidence: number;
    }>;
  };
  /** Session context */
  session: {
    recentProjects: string[];
    recentTasks: Array<{ title: string; project?: string }>;
  };
  /** Known entities */
  entities: {
    people: Array<{
      id: string;
      name: string;
      aliases: string[];
      todoistLabel?: string;
    }>;
    projects: Array<{
      id: string;
      name: string;
      hierarchyName: string;
    }>;
    labels: Array<{
      name: string;
      isContext: boolean;
    }>;
  };
  /** Current time info */
  currentTime: Date;
  timezone: string;
}

/**
 * Inference options
 */
export interface InferenceOptions {
  /** Use LLM for complex inference (default: true) */
  useLLM?: boolean;
  /** Minimum confidence to include a field */
  minConfidence?: number;
}

// ============================================================================
// Inference Engine
// ============================================================================

/**
 * Task Inference Engine
 */
export class TaskInferenceEngine {
  private client: GeminiClient;

  constructor(client: GeminiClient) {
    this.client = client;
  }

  /**
   * Infer task details from raw text using context
   */
  async inferTaskDetails(
    rawText: string,
    context: InferenceContext,
    options: InferenceOptions = {}
  ): Promise<InferredTask> {
    const { useLLM = true, minConfidence = 0.3 } = options;

    // Start with rule-based inference
    const ruleBasedResult = this.applyRules(rawText, context);

    // If confidence is high enough or LLM is disabled, return rule-based result
    if (!useLLM || ruleBasedResult.overallConfidence >= 0.8) {
      return ruleBasedResult;
    }

    // Use LLM to enhance inference
    try {
      const llmResult = await this.inferWithLLM(rawText, context, ruleBasedResult);
      return this.mergeResults(ruleBasedResult, llmResult, minConfidence);
    } catch (error) {
      console.error('[InferenceEngine] LLM inference failed:', error);
      return ruleBasedResult;
    }
  }

  /**
   * Apply rule-based inference
   */
  private applyRules(rawText: string, context: InferenceContext): InferredTask {
    const lowerText = rawText.toLowerCase();
    const result: InferredTask = {
      content: this.cleanContent(rawText),
      rawText,
      type: this.inferTaskType(lowerText),
      overallConfidence: 0.5,
      reasoning: 'Rule-based inference',
    };

    const reasons: string[] = [];

    // Infer project
    const projectInference = this.inferProject(lowerText, context);
    if (projectInference) {
      result.project = projectInference;
      reasons.push(`project: ${projectInference.reason}`);
    }

    // Infer labels
    const labelsInference = this.inferLabels(lowerText, context);
    if (labelsInference && labelsInference.value.length > 0) {
      result.labels = labelsInference;
      reasons.push(`labels: ${labelsInference.reason}`);
    }

    // Infer priority
    const priorityInference = this.inferPriority(lowerText, context);
    if (priorityInference) {
      result.priority = priorityInference;
      reasons.push(`priority: ${priorityInference.reason}`);
    }

    // Infer due date
    const dueDateInference = this.inferDueDate(lowerText, context);
    if (dueDateInference) {
      result.dueDate = dueDateInference;
      reasons.push(`due: ${dueDateInference.reason}`);
    }

    // Infer GTD context
    const contextInference = this.inferContext(lowerText, context);
    if (contextInference) {
      result.context = contextInference;
      reasons.push(`context: ${contextInference.reason}`);
    }

    // Infer person
    const personInference = this.inferPerson(lowerText, context);
    if (personInference) {
      result.person = personInference;
      reasons.push(`person: ${personInference.reason}`);

      // If person detected, adjust task type
      if (!lowerText.includes('waiting')) {
        result.type = 'agenda';
      }
    }

    // Calculate overall confidence
    const confidences = [
      result.project?.confidence,
      result.labels?.confidence,
      result.priority?.confidence,
      result.dueDate?.confidence,
      result.context?.confidence,
      result.person?.confidence,
    ].filter((c): c is number => c !== undefined);

    if (confidences.length > 0) {
      result.overallConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    }

    result.reasoning = reasons.length > 0 ? reasons.join('; ') : 'No specific patterns matched';

    return result;
  }

  /**
   * Clean task content (remove inferred metadata)
   */
  private cleanContent(rawText: string): string {
    let content = rawText;

    // Remove common prefixes
    content = content.replace(/^(add|create|new|make)\s+/i, '');
    content = content.replace(/^(task|todo|reminder|item)[:.]?\s*/i, '');

    // Remove priority indicators
    content = content.replace(/\b(urgent|asap|important|p[1-4])\b/gi, '');

    // Remove date indicators (keep for LLM to parse)
    // We don't remove these here since they're informative

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ').trim();

    return content;
  }

  /**
   * Infer task type from text
   */
  private inferTaskType(text: string): TaskType {
    if (text.includes('waiting for') || text.includes('waiting on')) {
      return 'waiting';
    }
    if (text.includes('someday') || text.includes('maybe') || text.includes('eventually')) {
      return 'someday';
    }
    if (
      text.includes('discuss with') ||
      text.includes('ask') ||
      text.includes('talk to') ||
      text.includes('agenda')
    ) {
      return 'agenda';
    }
    return 'action';
  }

  /**
   * Infer project from text and context
   */
  private inferProject(text: string, context: InferenceContext): InferredField<string> | undefined {
    // Check explicit project mappings
    for (const [trigger, project] of Object.entries(context.preferences.projectMappings)) {
      if (text.includes(trigger.toLowerCase())) {
        return {
          value: project,
          confidence: 0.9,
          reason: `keyword "${trigger}"`,
        };
      }
    }

    // Check word associations
    for (const assoc of context.patterns.wordAssociations) {
      if (assoc.target.project && text.includes(assoc.trigger.toLowerCase())) {
        return {
          value: assoc.target.project,
          confidence: assoc.confidence,
          reason: `learned from "${assoc.trigger}"`,
        };
      }
    }

    // Check if any project name is mentioned
    for (const project of context.entities.projects) {
      if (text.includes(project.name.toLowerCase())) {
        return {
          value: project.name,
          confidence: 0.85,
          reason: `mentioned "${project.name}"`,
        };
      }
    }

    // Use recent project if nothing else matches
    const recentProject = context.session.recentProjects[0];
    if (recentProject) {
      return {
        value: recentProject,
        confidence: 0.4,
        reason: 'recently used project',
      };
    }

    // Default project
    if (context.preferences.defaultProject) {
      return {
        value: context.preferences.defaultProject,
        confidence: 0.3,
        reason: 'default project',
      };
    }

    return undefined;
  }

  /**
   * Infer labels from text and context
   */
  private inferLabels(text: string, context: InferenceContext): InferredField<string[]> | undefined {
    const labels: string[] = [];
    const reasons: string[] = [];
    let maxConfidence = 0;

    // Check explicit label mappings
    for (const [trigger, mappedLabels] of Object.entries(context.preferences.labelMappings)) {
      if (text.includes(trigger.toLowerCase())) {
        for (const label of mappedLabels) {
          if (!labels.includes(label)) {
            labels.push(label);
          }
        }
        reasons.push(`"${trigger}"`);
        maxConfidence = Math.max(maxConfidence, 0.85);
      }
    }

    // Check word associations
    for (const assoc of context.patterns.wordAssociations) {
      if (assoc.target.labels && text.includes(assoc.trigger.toLowerCase())) {
        for (const label of assoc.target.labels) {
          if (!labels.includes(label)) {
            labels.push(label);
          }
        }
        reasons.push(`learned "${assoc.trigger}"`);
        maxConfidence = Math.max(maxConfidence, assoc.confidence);
      }
    }

    // Check for person mentions (add their label)
    for (const person of context.entities.people) {
      const personMentioned =
        text.includes(person.name.toLowerCase()) ||
        person.aliases.some((a) => text.includes(a.toLowerCase()));

      if (personMentioned && person.todoistLabel) {
        if (!labels.includes(person.todoistLabel)) {
          labels.push(person.todoistLabel);
        }
        reasons.push(`person: ${person.name}`);
        maxConfidence = Math.max(maxConfidence, 0.9);
      }
    }

    if (labels.length === 0) {
      return undefined;
    }

    return {
      value: labels,
      confidence: maxConfidence,
      reason: reasons.join(', '),
    };
  }

  /**
   * Infer priority from text
   */
  private inferPriority(
    text: string,
    context: InferenceContext
  ): InferredField<1 | 2 | 3 | 4> | undefined {
    // Check high priority keywords
    for (const keyword of context.preferences.priorityKeywords.high) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          value: 4, // Todoist priority 4 = highest
          confidence: 0.85,
          reason: `keyword "${keyword}"`,
        };
      }
    }

    // Check medium priority keywords
    for (const keyword of context.preferences.priorityKeywords.medium) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          value: 3,
          confidence: 0.7,
          reason: `keyword "${keyword}"`,
        };
      }
    }

    // Check low priority keywords
    for (const keyword of context.preferences.priorityKeywords.low) {
      if (text.includes(keyword.toLowerCase())) {
        return {
          value: 1, // Todoist priority 1 = lowest
          confidence: 0.7,
          reason: `keyword "${keyword}"`,
        };
      }
    }

    // Check word associations
    for (const assoc of context.patterns.wordAssociations) {
      if (assoc.target.priority && text.includes(assoc.trigger.toLowerCase())) {
        return {
          value: assoc.target.priority as 1 | 2 | 3 | 4,
          confidence: assoc.confidence,
          reason: `learned from "${assoc.trigger}"`,
        };
      }
    }

    return undefined;
  }

  /**
   * Infer due date from text
   */
  private inferDueDate(
    text: string,
    context: InferenceContext
  ): InferredField<string> | undefined {
    // Common date patterns
    const datePatterns: Array<{ pattern: RegExp; extract: (m: RegExpMatchArray) => string; confidence: number }> = [
      { pattern: /\btoday\b/i, extract: () => 'today', confidence: 0.95 },
      { pattern: /\btomorrow\b/i, extract: () => 'tomorrow', confidence: 0.95 },
      { pattern: /\bby\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, extract: (m) => m[1] ?? 'monday', confidence: 0.9 },
      { pattern: /\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, extract: (m) => `next ${m[1] ?? 'monday'}`, confidence: 0.9 },
      { pattern: /\bthis\s+(week|weekend)\b/i, extract: (m) => `this ${m[1] ?? 'week'}`, confidence: 0.85 },
      { pattern: /\bnext\s+week\b/i, extract: () => 'next week', confidence: 0.85 },
      { pattern: /\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i, extract: (m) => `in ${m[1] ?? '1'} ${m[2] ?? 'day'}`, confidence: 0.9 },
      { pattern: /\bby\s+(\d{1,2}\/\d{1,2})\b/, extract: (m) => m[1] ?? 'today', confidence: 0.95 },
      { pattern: /\beod\b/i, extract: () => 'today', confidence: 0.9 },
      { pattern: /\beow\b/i, extract: () => 'friday', confidence: 0.85 },
      { pattern: /\basap\b/i, extract: () => 'today', confidence: 0.8 },
    ];

    for (const { pattern, extract, confidence } of datePatterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          value: extract(match),
          confidence,
          reason: `pattern "${match[0]}"`,
        };
      }
    }

    return undefined;
  }

  /**
   * Infer GTD context from text
   */
  private inferContext(
    text: string,
    context: InferenceContext
  ): InferredField<TaskContext> | undefined {
    // Direct context mentions
    const contextPatterns: Array<{ pattern: RegExp; context: TaskContext; confidence: number }> = [
      { pattern: /@computer|@laptop|@online/i, context: 'computer', confidence: 0.95 },
      { pattern: /@phone|@call|@mobile/i, context: 'phone', confidence: 0.95 },
      { pattern: /@home|@house/i, context: 'home', confidence: 0.95 },
      { pattern: /@outside|@errand|@out/i, context: 'outside', confidence: 0.95 },
    ];

    for (const { pattern, context: ctx, confidence } of contextPatterns) {
      if (pattern.test(text)) {
        return { value: ctx, confidence, reason: 'explicit context tag' };
      }
    }

    // Infer from task content
    if (/\b(email|send|write|review|code|program|update|edit)\b/i.test(text)) {
      return { value: 'computer', confidence: 0.7, reason: 'computer-related action' };
    }
    if (/\b(call|phone|text|message)\b/i.test(text)) {
      return { value: 'phone', confidence: 0.7, reason: 'phone-related action' };
    }
    if (/\b(buy|pick up|shop|store|grocery|errand)\b/i.test(text)) {
      return { value: 'outside', confidence: 0.7, reason: 'errand-related action' };
    }

    return undefined;
  }

  /**
   * Infer person from text
   */
  private inferPerson(
    text: string,
    context: InferenceContext
  ): InferredField<{ id: string; name: string }> | undefined {
    for (const person of context.entities.people) {
      // Check name
      if (text.includes(person.name.toLowerCase())) {
        return {
          value: { id: person.id, name: person.name },
          confidence: 0.9,
          reason: `mentioned "${person.name}"`,
        };
      }

      // Check aliases
      for (const alias of person.aliases) {
        if (text.includes(alias.toLowerCase())) {
          return {
            value: { id: person.id, name: person.name },
            confidence: 0.85,
            reason: `alias "${alias}"`,
          };
        }
      }
    }

    return undefined;
  }

  /**
   * Use LLM for complex inference
   */
  private async inferWithLLM(
    rawText: string,
    context: InferenceContext,
    ruleBasedResult: InferredTask
  ): Promise<Partial<InferredTask>> {
    const prompt = this.buildLLMPrompt(rawText, context, ruleBasedResult);

    const response = await this.client.generate(prompt);

    try {
      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      console.error('[InferenceEngine] Failed to parse LLM response');
    }

    return {};
  }

  /**
   * Build prompt for LLM inference
   */
  private buildLLMPrompt(
    rawText: string,
    context: InferenceContext,
    ruleBasedResult: InferredTask
  ): string {
    return `You are a task inference engine. Given the user's task text and context, enhance the task details.

TASK TEXT: "${rawText}"

CURRENT INFERENCES (from rules):
${JSON.stringify(ruleBasedResult, null, 2)}

CONTEXT:
- Available projects: ${context.entities.projects.map((p) => p.name).join(', ')}
- Known people: ${context.entities.people.map((p) => p.name).join(', ')}
- Recent projects: ${context.session.recentProjects.join(', ')}
- Current time: ${context.currentTime.toISOString()}

TASK: Review the current inferences and suggest improvements. Focus on:
1. Is the project correct? Consider keywords and context.
2. Are the labels appropriate? Consider GTD contexts (@phone, @computer, etc.)
3. Is the due date correctly parsed?
4. Is the priority appropriate?

Respond with a JSON object containing only the fields you want to change:
{
  "project": { "value": "ProjectName", "confidence": 0.8, "reason": "explanation" },
  "labels": { "value": ["@label1"], "confidence": 0.7, "reason": "explanation" },
  "dueDate": { "value": "tomorrow", "confidence": 0.9, "reason": "explanation" },
  "priority": { "value": 3, "confidence": 0.6, "reason": "explanation" }
}

Only include fields where you have a better inference. Respond with {} if the current inferences are good.`;
  }

  /**
   * Merge rule-based and LLM results
   */
  private mergeResults(
    ruleBased: InferredTask,
    llmResult: Partial<InferredTask>,
    minConfidence: number
  ): InferredTask {
    const merged = { ...ruleBased };

    // Merge each field, preferring higher confidence
    const fields: Array<keyof Pick<InferredTask, 'project' | 'labels' | 'dueDate' | 'priority' | 'context' | 'person'>> = [
      'project',
      'labels',
      'dueDate',
      'priority',
      'context',
      'person',
    ];

    for (const field of fields) {
      const llmField = llmResult[field] as InferredField<unknown> | undefined;
      const ruleField = ruleBased[field] as InferredField<unknown> | undefined;

      if (llmField && llmField.confidence >= minConfidence) {
        if (!ruleField || llmField.confidence > ruleField.confidence) {
          (merged as any)[field] = llmField;
        }
      }
    }

    // Recalculate overall confidence
    const confidences = [
      merged.project?.confidence,
      merged.labels?.confidence,
      merged.priority?.confidence,
      merged.dueDate?.confidence,
      merged.context?.confidence,
      merged.person?.confidence,
    ].filter((c): c is number => c !== undefined);

    if (confidences.length > 0) {
      merged.overallConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    }

    merged.reasoning = `${ruleBased.reasoning}; enhanced with LLM`;

    return merged;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a task inference engine
 */
export function createInferenceEngine(client: GeminiClient): TaskInferenceEngine {
  return new TaskInferenceEngine(client);
}
