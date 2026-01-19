import type { Queue } from 'bullmq';
import type { DbClient } from '@gtd/database';
import type { MessageJobData } from '@gtd/queue';
import type { IntentResult } from '@gtd/shared-types';

// Import handlers
import {
  handleQueryToday,
  handleQueryTomorrow,
  handleQueryActions,
  handleQueryProjects,
  handleQueryWaiting,
  handleQuerySomeday,
  handleQueryContext,
  handleQueryPeople,
  handleQueryPersonAgenda,
  handleQuerySpecificTask,
  handleShowWeeklyReview,
} from './queries.js';
import {
  handleCompleteTask,
  handleCompleteRecent,
  handleCompletePersonAgenda,
} from './completion.js';
import {
  handleAddPerson,
  handleRemovePerson,
  handleSetAlias,
  handleSetSchedule,
} from './people.js';
import {
  handleSetDigestTime,
  handleSetTimezone,
  handleSetReminderHours,
  handlePauseAccount,
  handleResumeAccount,
  handleShowSettings,
  handleSetReviewDay,
  handleSetReviewTime,
} from './settings.js';
import {
  handleRescheduleTask,
  handleSetTaskPriority,
  handleSetTaskContext,
  handleAddTaskNote,
  handleRenameTask,
  handleDeleteTask,
  handleAssignTaskPerson,
} from './editing.js';
import {
  handleUndoLast,
  handleChangeTaskType,
  handleCorrectPerson,
} from './undo.js';
import {
  handleClearPersonAgenda,
  handleCompleteAllToday,
  handleCompleteAllContext,
  handleShowStats,
  handleShowHelp,
} from './bulk.js';

/**
 * User context passed to all handlers
 */
export interface HandlerContext {
  user: {
    id: string;
    phoneNumber: string;
    notionAccessToken: string | null;
    notionTasksDatabaseId: string | null;
    notionPeopleDatabaseId: string | null;
    timezone: string;
    digestTime: string;
    meetingReminderHours: number;
    weeklyReviewDay: string;
    weeklyReviewTime: string;
    status: string;
    totalTasksCaptured: number;
    totalTasksCompleted: number;
  };
  db: DbClient;
  messageQueue: Queue<MessageJobData>;
}

/**
 * Main intent handler - routes to specific handler based on intent type
 */
export async function handleIntent(
  intent: IntentResult,
  ctx: HandlerContext
): Promise<string> {
  console.log(`[IntentHandler] Processing intent: ${intent.intent}`);
  console.log(`[IntentHandler] Entities:`, JSON.stringify(intent.entities));

  try {
    switch (intent.intent) {
      // Query intents
      case 'query_today':
        return handleQueryToday(ctx);
      case 'query_tomorrow':
        return handleQueryTomorrow(ctx);
      case 'query_actions':
        return handleQueryActions(ctx);
      case 'query_projects':
        return handleQueryProjects(ctx);
      case 'query_waiting':
        return handleQueryWaiting(ctx);
      case 'query_someday':
        return handleQuerySomeday(ctx);
      case 'query_context':
        return handleQueryContext(intent.entities, ctx);
      case 'query_people':
        return handleQueryPeople(ctx);
      case 'query_person_agenda':
        return handleQueryPersonAgenda(intent.entities, ctx);
      case 'query_specific_task':
        return handleQuerySpecificTask(intent.entities, ctx);

      // Completion intents
      case 'complete_task':
        return handleCompleteTask(intent.entities, ctx);
      case 'complete_recent':
        return handleCompleteRecent(ctx);
      case 'complete_person_agenda':
        return handleCompletePersonAgenda(intent.entities, ctx);

      // People management intents
      case 'add_person':
        return handleAddPerson(intent.entities, ctx);
      case 'remove_person':
        return handleRemovePerson(intent.entities, ctx);
      case 'set_alias':
        return handleSetAlias(intent.entities, ctx);
      case 'set_schedule':
        return handleSetSchedule(intent.entities, ctx);

      // Settings intents
      case 'set_digest_time':
        return handleSetDigestTime(intent.entities, ctx);
      case 'set_timezone':
        return handleSetTimezone(intent.entities, ctx);
      case 'set_reminder_hours':
        return handleSetReminderHours(intent.entities, ctx);
      case 'set_review_day':
        return handleSetReviewDay(intent.entities, ctx);
      case 'set_review_time':
        return handleSetReviewTime(intent.entities, ctx);
      case 'pause_account':
        return handlePauseAccount(ctx);
      case 'resume_account':
        return handleResumeAccount(ctx);
      case 'show_settings':
        return handleShowSettings(ctx);

      // Task editing intents
      case 'reschedule_task':
        return handleRescheduleTask(intent.entities, ctx);
      case 'set_task_priority':
        return handleSetTaskPriority(intent.entities, ctx);
      case 'set_task_context':
        return handleSetTaskContext(intent.entities, ctx);
      case 'add_task_note':
        return handleAddTaskNote(intent.entities, ctx);
      case 'rename_task':
        return handleRenameTask(intent.entities, ctx);
      case 'delete_task':
        return handleDeleteTask(intent.entities, ctx);
      case 'assign_task_person':
        return handleAssignTaskPerson(intent.entities, ctx);

      // Correction intents
      case 'undo_last':
        return handleUndoLast(ctx);
      case 'change_task_type':
        return handleChangeTaskType(intent.entities, ctx);
      case 'correct_person':
        return handleCorrectPerson(intent.entities, ctx);

      // Bulk operations
      case 'clear_person_agenda':
        return handleClearPersonAgenda(intent.entities, ctx);
      case 'complete_all_today':
        return handleCompleteAllToday(ctx);
      case 'complete_all_context':
        return handleCompleteAllContext(intent.entities, ctx);

      // Info
      case 'show_stats':
        return handleShowStats(ctx);
      case 'show_help':
        return handleShowHelp();
      case 'show_weekly_review':
        return handleShowWeeklyReview(ctx);

      default:
        console.warn(`[IntentHandler] Unknown intent: ${intent.intent}`);
        return handleShowHelp();
    }
  } catch (error) {
    console.error(`[IntentHandler] Error handling ${intent.intent}:`, error);
    return "Sorry, something went wrong. Please try again.";
  }
}
