/**
 * Notion API Types
 * Types for Notion database schemas and operations
 */

/**
 * Notion Tasks Database Schema
 */
export interface NotionTaskProperties {
  Task: string;
  Type: 'Action' | 'Project' | 'Waiting' | 'Someday' | 'Agenda';
  Status: 'To Do' | 'In Progress' | 'Done' | 'Discussed';
  Context?: '@work' | '@home' | '@errands' | '@calls' | '@computer' | '@anywhere';
  Person?: string; // Notion page ID
  Due?: string; // ISO date
  Priority?: '🔥 Today' | '⚡ This week' | '📋 Soon';
  Created: string; // ISO date
  Completed?: string; // ISO date
  Notes?: string;
}

/**
 * Notion People Database Schema
 */
export interface NotionPersonProperties {
  Name: string;
  Aliases?: string; // Comma-separated
  Frequency?: 'Daily' | 'Weekly' | 'Biweekly' | 'Monthly' | 'As Needed';
  Day?: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  Active: boolean;
  Notes?: string;
}

/**
 * Task type mapping from internal to Notion
 */
export const TASK_TYPE_TO_NOTION: Record<string, string> = {
  action: 'Action',
  project: 'Project',
  waiting: 'Waiting',
  someday: 'Someday',
  agenda: 'Agenda',
};

/**
 * Context mapping from internal to Notion
 */
export const CONTEXT_TO_NOTION: Record<string, string> = {
  work: '@work',
  home: '@home',
  errands: '@errands',
  calls: '@calls',
  computer: '@computer',
  anywhere: '@anywhere',
};

/**
 * Priority mapping from internal to Notion
 */
export const PRIORITY_TO_NOTION: Record<string, string> = {
  today: '🔥 Today',
  this_week: '⚡ This week',
  soon: '📋 Soon',
};

/**
 * Frequency mapping from internal to Notion
 */
export const FREQUENCY_TO_NOTION: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  as_needed: 'As Needed',
};

/**
 * Day mapping from internal to Notion
 */
export const DAY_TO_NOTION: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

/**
 * Database property definitions for auto-creation
 */
export const TASKS_DATABASE_PROPERTIES = {
  Task: { title: {} },
  Type: {
    select: {
      options: [
        { name: 'Action', color: 'blue' },
        { name: 'Project', color: 'purple' },
        { name: 'Waiting', color: 'orange' },
        { name: 'Someday', color: 'gray' },
        { name: 'Agenda', color: 'green' },
      ],
    },
  },
  Status: {
    status: {
      options: [
        { name: 'To Do', color: 'default' },
        { name: 'In Progress', color: 'blue' },
        { name: 'Done', color: 'green' },
        { name: 'Discussed', color: 'purple' },
      ],
      groups: [
        { name: 'To-do', option_ids: [], color: 'gray' },
        { name: 'In progress', option_ids: [], color: 'blue' },
        { name: 'Complete', option_ids: [], color: 'green' },
      ],
    },
  },
  Context: {
    select: {
      options: [
        { name: '@work', color: 'blue' },
        { name: '@home', color: 'red' },
        { name: '@errands', color: 'yellow' },
        { name: '@calls', color: 'green' },
        { name: '@computer', color: 'purple' },
        { name: '@anywhere', color: 'gray' },
      ],
    },
  },
  Due: { date: {} },
  Priority: {
    select: {
      options: [
        { name: '🔥 Today', color: 'red' },
        { name: '⚡ This week', color: 'orange' },
        { name: '📋 Soon', color: 'blue' },
      ],
    },
  },
  Created: { date: {} },
  Completed: { date: {} },
  Notes: { rich_text: {} },
} as const;

export const PEOPLE_DATABASE_PROPERTIES = {
  Name: { title: {} },
  Aliases: { rich_text: {} },
  Frequency: {
    select: {
      options: [
        { name: 'Daily', color: 'red' },
        { name: 'Weekly', color: 'orange' },
        { name: 'Biweekly', color: 'yellow' },
        { name: 'Monthly', color: 'green' },
        { name: 'As Needed', color: 'gray' },
      ],
    },
  },
  Day: {
    select: {
      options: [
        { name: 'Monday', color: 'blue' },
        { name: 'Tuesday', color: 'purple' },
        { name: 'Wednesday', color: 'pink' },
        { name: 'Thursday', color: 'red' },
        { name: 'Friday', color: 'orange' },
        { name: 'Saturday', color: 'yellow' },
        { name: 'Sunday', color: 'green' },
      ],
    },
  },
  Active: { checkbox: {} },
  Notes: { rich_text: {} },
} as const;
