/**
 * Todoist Labels Service
 *
 * Manages GTD-specific labels in Todoist.
 * Labels are used for contexts (@computer, @phone, etc.) and states (@waiting).
 *
 * GTD LABEL STRATEGY (per spec):
 * - @computer - Dense work requiring keyboard/screen
 * - @phone - Quick tasks from phone (calls, texts, emails)
 * - @out - Errands, appointments, physical tasks (maps from @home and @outside)
 * - @people - Agenda items for discussion
 * - @waiting - Tasks waiting on someone else
 */

import type { TodoistClient } from '../client.js';
import type { TodoistLabel } from '../types.js';

/**
 * Core GTD labels that should exist in Todoist
 */
export const GTD_LABELS = ['computer', 'phone', 'people', 'out', 'waiting'] as const;

export type GTDLabel = (typeof GTD_LABELS)[number];

/**
 * Map GTD context to Todoist label
 *
 * Note: 'home' and 'outside' both map to 'out' per the spec
 */
export const CONTEXT_TO_LABEL: Record<string, GTDLabel> = {
  computer: 'computer',
  phone: 'phone',
  home: 'out', // Consolidated to @out
  outside: 'out', // Consolidated to @out
};

/**
 * Map GTD task type to Todoist label (if applicable)
 *
 * Most types don't need labels - they're distinguished by project or other means.
 */
export const TYPE_TO_LABEL: Record<string, GTDLabel | null> = {
  action: null, // No label needed
  project: null, // No label needed
  waiting: 'waiting', // @waiting for delegation tracking
  someday: null, // Goes to Someday project
  agenda: 'people', // @people for discussion items
};

/**
 * Ensure all GTD labels exist in Todoist
 *
 * Creates any missing labels. Idempotent - safe to call multiple times.
 * This should be called after OAuth and periodically during sync.
 *
 * @param client - Authenticated Todoist client
 * @returns Object mapping label names to IDs
 */
export async function ensureGTDLabels(
  client: TodoistClient
): Promise<Record<string, string>> {
  // Get existing labels
  const existing = await client.get<TodoistLabel[]>('/labels');
  const existingByName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));

  const labelIds: Record<string, string> = {};

  for (const labelName of GTD_LABELS) {
    const existingLabel = existingByName.get(labelName);

    if (existingLabel) {
      // Label exists
      labelIds[labelName] = existingLabel.id;
    } else {
      // Create the label
      console.log(`[Labels] Creating GTD label: @${labelName}`);
      try {
        const newLabel = await client.post<TodoistLabel>('/labels', {
          name: labelName,
        });
        labelIds[labelName] = newLabel.id;
      } catch (error) {
        // Label might have been created in a race condition
        console.warn(`[Labels] Failed to create @${labelName}:`, error);
      }
    }
  }

  return labelIds;
}

/**
 * Build the labels array for a task
 *
 * Converts GTD context and type to appropriate Todoist labels.
 *
 * @param taskType - GTD task type
 * @param context - GTD context (optional)
 * @returns Array of label names to apply
 */
export function buildTaskLabels(
  taskType: string,
  context?: string | null
): string[] {
  const labels: string[] = [];

  // Add type-based label if applicable
  const typeLabel = TYPE_TO_LABEL[taskType];
  if (typeLabel) {
    labels.push(typeLabel);
  }

  // Add context-based label if applicable
  if (context) {
    const contextLabel = CONTEXT_TO_LABEL[context];
    if (contextLabel && !labels.includes(contextLabel)) {
      labels.push(contextLabel);
    }
  }

  return labels;
}

/**
 * Get all labels for a person (agenda items)
 *
 * Creates a personal label for tracking agenda items per person.
 * Format: lowercase, spaces replaced with underscores.
 *
 * @param personName - Name of the person
 * @returns Label name for the person
 */
export function getPersonLabel(personName: string): string {
  return personName.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Ensure a person-specific label exists
 *
 * @param client - Authenticated Todoist client
 * @param personName - Name of the person
 * @returns Label ID
 */
export async function ensurePersonLabel(
  client: TodoistClient,
  personName: string
): Promise<string> {
  const labelName = getPersonLabel(personName);

  // Check if exists
  const existing = await client.get<TodoistLabel[]>('/labels');
  const existingLabel = existing.find(
    (l) => l.name.toLowerCase() === labelName
  );

  if (existingLabel) {
    return existingLabel.id;
  }

  // Create the label
  const newLabel = await client.post<TodoistLabel>('/labels', {
    name: labelName,
  });

  return newLabel.id;
}
