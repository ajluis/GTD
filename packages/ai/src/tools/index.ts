/**
 * Tool Registry
 * Central registry of all available tools
 */

import type { Tool } from './types.js';

// Lookup tools
import { lookupTasks, lookupTodayTasks } from './lookup/tasks.js';
import { lookupMessages } from './lookup/messages.js';
import { getUserSettings, getProductivityStats } from './lookup/settings.js';

// Action tools
import {
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  undoLastAction,
} from './actions/tasks.js';
import {
  batchCreateTasks,
  batchCompleteTasks,
  batchDeleteTasks,
} from './actions/batch.js';
import {
  setTimezone,
  setDigestTime,
  setMeetingReminderHours,
  setWeeklyReviewSchedule,
  pauseAccount,
  resumeAccount,
} from './actions/settings.js';

// Re-export types
export * from './types.js';

/**
 * All available tools
 */
export const allTools: Tool[] = [
  // Lookup tools (read-only, safe)
  lookupTasks,
  lookupTodayTasks,
  lookupMessages,
  getUserSettings,
  getProductivityStats,

  // Task action tools
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  undoLastAction,

  // Batch tools
  batchCreateTasks,
  batchCompleteTasks,
  batchDeleteTasks,

  // Settings tools
  setTimezone,
  setDigestTime,
  setMeetingReminderHours,
  setWeeklyReviewSchedule,
  pauseAccount,
  resumeAccount,
];

/**
 * Tool registry as a Map for quick lookup
 */
export const toolRegistry: Map<string, Tool> = new Map(
  allTools.map((tool) => [tool.name, tool])
);

/**
 * Get a subset of tools by names
 */
export function getTools(names: string[]): Tool[] {
  return names
    .map((name) => toolRegistry.get(name))
    .filter((tool): tool is Tool => tool !== undefined);
}

/**
 * Get tools appropriate for different operations
 */
export const toolSets = {
  /** Tools for reading data only */
  lookup: [
    lookupTasks,
    lookupTodayTasks,
    lookupMessages,
    getUserSettings,
    getProductivityStats,
  ],

  /** Tools for task operations */
  tasks: [
    lookupTasks,
    lookupTodayTasks,
    createTask,
    updateTask,
    completeTask,
    deleteTask,
    undoLastAction,
  ],

  /** Tools for batch operations */
  batch: [lookupTasks, batchCreateTasks, batchCompleteTasks, batchDeleteTasks],

  /** Tools for query operations */
  query: [
    lookupTasks,
    lookupTodayTasks,
    lookupMessages,
    getUserSettings,
    getProductivityStats,
  ],

  /** Tools for settings operations */
  settings: [
    getUserSettings,
    setTimezone,
    setDigestTime,
    setMeetingReminderHours,
    setWeeklyReviewSchedule,
    pauseAccount,
    resumeAccount,
  ],

  /** Full toolset for general agent */
  full: allTools,
};

/**
 * Format tools for LLM prompt
 */
export function formatToolsForPrompt(tools: Tool[]): string {
  return tools
    .map((tool) => {
      const params = Object.entries(tool.parameters.properties)
        .map(([name, schema]) => {
          const required = tool.parameters.required?.includes(name)
            ? ' (required)'
            : '';
          const enumValues = schema.enum ? ` [${schema.enum.join('|')}]` : '';
          return `    - ${name}: ${schema.description}${required}${enumValues}`;
        })
        .join('\n');

      return `${tool.name}:
  ${tool.description}
  Parameters:
${params || '    (none)'}`;
    })
    .join('\n\n');
}

// Re-export individual tools for direct import
export {
  lookupTasks,
  lookupTodayTasks,
  lookupMessages,
  getUserSettings,
  getProductivityStats,
  createTask,
  updateTask,
  completeTask,
  deleteTask,
  undoLastAction,
  batchCreateTasks,
  batchCompleteTasks,
  batchDeleteTasks,
  setTimezone,
  setDigestTime,
  setMeetingReminderHours,
  setWeeklyReviewSchedule,
  pauseAccount,
  resumeAccount,
};
