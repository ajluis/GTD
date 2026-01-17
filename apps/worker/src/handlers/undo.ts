import type { IntentEntities } from '@clarity/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Handle undo_last intent
 * "undo", "undo that", "take that back", "never mind"
 *
 * Note: Full undo support requires action history tracking.
 * This is a placeholder for future implementation.
 */
export async function handleUndoLast(ctx: HandlerContext): Promise<string> {
  // TODO: Implement action history tracking and undo
  // For now, return a helpful message

  return "↩️ Undo isn't available yet.\n\nTo fix something:\n• Delete a task: 'delete [task]'\n• Change type: 'make [task] a project'\n• Reschedule: 'move [task] to [date]'";
}

/**
 * Handle change_task_type intent
 * "that should be a project", "make it an action"
 */
export async function handleChangeTaskType(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const taskType = entities.taskType;

  if (!taskType) {
    return "What type should it be? Options: action, project, waiting, someday";
  }

  // TODO: Need to track the "last task" to know what to change
  // For now, return instructions

  return `To change a task's type, try:\n"change [task name] to ${taskType}"`;
}

/**
 * Handle correct_person intent
 * "I meant Sarah not Sara", "wrong person, it's John"
 */
export async function handleCorrectPerson(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const personName = entities.personName;

  if (!personName) {
    return "Who did you mean? Try 'I meant [correct name]'";
  }

  // TODO: Need to track the "last task" to know what to correct
  // For now, return instructions

  return `To reassign a task to ${personName}, try:\n"assign [task name] to ${personName}"`;
}
