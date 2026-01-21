/**
 * Settings Action Tools
 * Update user preferences and account settings
 */

import type { Tool, ToolContext, ToolResult } from '../types.js';
import { users } from '@gtd/database';
import { eq } from 'drizzle-orm';

/**
 * Timezone mappings for common city names
 */
const TIMEZONE_MAP: Record<string, string> = {
  // US Cities
  'new york': 'America/New_York',
  'nyc': 'America/New_York',
  'boston': 'America/New_York',
  'miami': 'America/New_York',
  'atlanta': 'America/New_York',
  'washington': 'America/New_York',
  'dc': 'America/New_York',
  'chicago': 'America/Chicago',
  'houston': 'America/Chicago',
  'dallas': 'America/Chicago',
  'austin': 'America/Chicago',
  'san antonio': 'America/Chicago',
  'denver': 'America/Denver',
  'phoenix': 'America/Phoenix',
  'los angeles': 'America/Los_Angeles',
  'la': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'sf': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles',
  'portland': 'America/Los_Angeles',
  'las vegas': 'America/Los_Angeles',
  'san diego': 'America/Los_Angeles',
  'honolulu': 'Pacific/Honolulu',
  'hawaii': 'Pacific/Honolulu',
  'anchorage': 'America/Anchorage',
  'alaska': 'America/Anchorage',

  // Common timezone abbreviations
  'eastern': 'America/New_York',
  'est': 'America/New_York',
  'edt': 'America/New_York',
  'et': 'America/New_York',
  'central': 'America/Chicago',
  'cst': 'America/Chicago',
  'cdt': 'America/Chicago',
  'ct': 'America/Chicago',
  'mountain': 'America/Denver',
  'mst': 'America/Denver',
  'mdt': 'America/Denver',
  'mt': 'America/Denver',
  'pacific': 'America/Los_Angeles',
  'pst': 'America/Los_Angeles',
  'pdt': 'America/Los_Angeles',
  'pt': 'America/Los_Angeles',

  // International
  'london': 'Europe/London',
  'uk': 'Europe/London',
  'paris': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'tokyo': 'Asia/Tokyo',
  'sydney': 'Australia/Sydney',
  'melbourne': 'Australia/Melbourne',
  'toronto': 'America/Toronto',
  'vancouver': 'America/Vancouver',
};

/**
 * Convert a timezone input to a valid IANA timezone
 */
function normalizeTimezone(input: string): string | null {
  const lower = input.toLowerCase().trim();

  // Check if it's already a valid IANA timezone
  if (input.includes('/')) {
    try {
      // Validate by trying to use it
      new Date().toLocaleString('en-US', { timeZone: input });
      return input;
    } catch {
      // Invalid timezone
    }
  }

  // Check our mapping
  if (TIMEZONE_MAP[lower]) {
    return TIMEZONE_MAP[lower];
  }

  // Try partial matches
  for (const [key, tz] of Object.entries(TIMEZONE_MAP)) {
    if (lower.includes(key) || key.includes(lower)) {
      return tz;
    }
  }

  return null;
}

/**
 * Get friendly timezone name
 */
function getFriendlyTimezoneName(tz: string): string {
  const parts = tz.split('/');
  const city = (parts[parts.length - 1] ?? tz).replace(/_/g, ' ');

  // Get current offset
  const now = new Date();
  const offset = now.toLocaleString('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  }).split(' ').pop() ?? '';

  return `${city} (${offset})`;
}

export const setTimezone: Tool = {
  name: 'set_timezone',
  description:
    "Update the user's timezone. Accepts city names (e.g., 'Austin', 'New York'), timezone abbreviations (e.g., 'CST', 'Pacific'), or IANA timezones (e.g., 'America/Chicago').",
  parameters: {
    type: 'object',
    properties: {
      timezone: {
        type: 'string',
        description: "The timezone to set (city name, abbreviation, or IANA timezone)",
      },
    },
    required: ['timezone'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { timezone } = params as { timezone: string };

    try {
      const normalizedTz = normalizeTimezone(timezone);

      if (!normalizedTz) {
        return {
          success: false,
          error: `I don't recognize "${timezone}" as a timezone. Try a city name like "Austin" or "New York", or a timezone like "CST" or "America/Chicago".`,
        };
      }

      // Update user's timezone
      await context.db
        .update(users)
        .set({ timezone: normalizedTz })
        .where(eq(users.id, context.userId));

      const friendlyName = getFriendlyTimezoneName(normalizedTz);

      return {
        success: true,
        data: {
          timezone: normalizedTz,
          friendlyName,
          message: `Timezone updated to ${friendlyName}`,
        },
      };
    } catch (error) {
      console.error('[set_timezone] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update timezone',
      };
    }
  },
};

export const setDigestTime: Tool = {
  name: 'set_digest_time',
  description:
    "Update the time when the daily digest is sent. Accepts times like '7am', '8:00', '9:30 AM', etc.",
  parameters: {
    type: 'object',
    properties: {
      time: {
        type: 'string',
        description: "The time to send the daily digest (e.g., '7am', '8:00', '9:30 AM')",
      },
    },
    required: ['time'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { time } = params as { time: string };

    try {
      // Parse the time string
      const normalizedTime = parseTimeString(time);

      if (!normalizedTime) {
        return {
          success: false,
          error: `I couldn't understand "${time}" as a time. Try something like "7am", "8:00", or "9:30 AM".`,
        };
      }

      // Update user's digest time
      await context.db
        .update(users)
        .set({ digestTime: normalizedTime })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          digestTime: normalizedTime,
          message: `Daily digest will now be sent at ${formatTime(normalizedTime)}`,
        },
      };
    } catch (error) {
      console.error('[set_digest_time] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update digest time',
      };
    }
  },
};

export const setMeetingReminderHours: Tool = {
  name: 'set_meeting_reminder_hours',
  description:
    'Update how many hours before meetings to send reminders.',
  parameters: {
    type: 'object',
    properties: {
      hours: {
        type: 'number',
        description: 'Number of hours before meetings to send reminders (1-24)',
      },
    },
    required: ['hours'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { hours } = params as { hours: number };

    try {
      if (hours < 1 || hours > 24) {
        return {
          success: false,
          error: 'Meeting reminder hours must be between 1 and 24.',
        };
      }

      await context.db
        .update(users)
        .set({ meetingReminderHours: hours })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          meetingReminderHours: hours,
          message: `Meeting reminders will now be sent ${hours} hour${hours === 1 ? '' : 's'} before meetings`,
        },
      };
    } catch (error) {
      console.error('[set_meeting_reminder_hours] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update meeting reminder hours',
      };
    }
  },
};

export const setWeeklyReviewSchedule: Tool = {
  name: 'set_weekly_review_schedule',
  description:
    "Update when the weekly review reminder is sent. Specify day and time like 'Sunday at 6pm' or 'Fridays at 5:00'.",
  parameters: {
    type: 'object',
    properties: {
      day: {
        type: 'string',
        description: 'Day of week (monday, tuesday, wednesday, thursday, friday, saturday, sunday)',
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      },
      time: {
        type: 'string',
        description: "Time for the review (e.g., '6pm', '18:00')",
      },
    },
    required: ['day', 'time'],
  },
  execute: async (params: unknown, context: ToolContext): Promise<ToolResult> => {
    const { day, time } = params as { day: string; time: string };

    try {
      const normalizedTime = parseTimeString(time);

      if (!normalizedTime) {
        return {
          success: false,
          error: `I couldn't understand "${time}" as a time. Try something like "6pm" or "18:00".`,
        };
      }

      const normalizedDay = day.toLowerCase();
      const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      if (!validDays.includes(normalizedDay)) {
        return {
          success: false,
          error: `"${day}" is not a valid day. Use monday, tuesday, wednesday, thursday, friday, saturday, or sunday.`,
        };
      }

      await context.db
        .update(users)
        .set({
          weeklyReviewDay: normalizedDay,
          weeklyReviewTime: normalizedTime,
        })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          weeklyReviewDay: normalizedDay,
          weeklyReviewTime: normalizedTime,
          message: `Weekly review reminder set for ${capitalizeFirst(normalizedDay)}s at ${formatTime(normalizedTime)}`,
        },
      };
    } catch (error) {
      console.error('[set_weekly_review_schedule] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update weekly review schedule',
      };
    }
  },
};

export const pauseAccount: Tool = {
  name: 'pause_account',
  description:
    'Pause the account to stop receiving digests and reminders. Messages will still be processed.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_params: unknown, context: ToolContext): Promise<ToolResult> => {
    try {
      await context.db
        .update(users)
        .set({ status: 'paused' })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          status: 'paused',
          message: "Account paused. You won't receive digests or reminders. Text 'resume' to reactivate.",
        },
      };
    } catch (error) {
      console.error('[pause_account] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to pause account',
      };
    }
  },
};

export const resumeAccount: Tool = {
  name: 'resume_account',
  description:
    'Resume a paused account to start receiving digests and reminders again.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: async (_params: unknown, context: ToolContext): Promise<ToolResult> => {
    try {
      await context.db
        .update(users)
        .set({ status: 'active' })
        .where(eq(users.id, context.userId));

      return {
        success: true,
        data: {
          status: 'active',
          message: "Account resumed! You'll receive your daily digest and meeting reminders again.",
        },
      };
    } catch (error) {
      console.error('[resume_account] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resume account',
      };
    }
  },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a time string like "7am", "8:00", "9:30 PM" into HH:MM format
 */
function parseTimeString(input: string): string | null {
  const normalized = input.toLowerCase().trim();

  // Try HH:MM format
  const hhmmMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch && hhmmMatch[1] && hhmmMatch[2]) {
    const hour = parseInt(hhmmMatch[1], 10);
    const minute = parseInt(hhmmMatch[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    }
  }

  // Try "7am", "7 am", "7:30am", "7:30 am" format
  const ampmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch && ampmMatch[1] && ampmMatch[3]) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const isPm = ampmMatch[3] === 'pm';

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    // Convert to 24-hour format
    if (isPm && hour !== 12) {
      hour += 12;
    } else if (!isPm && hour === 12) {
      hour = 0;
    }

    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  }

  return null;
}

/**
 * Format HH:MM time string for display
 */
function formatTime(time: string): string {
  const parts = time.split(':');
  const hourStr = parts[0] ?? '0';
  const minuteStr = parts[1] ?? '00';
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  const isPm = hour >= 12;
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const displayMinute = minute > 0 ? `:${minuteStr}` : '';
  const ampm = isPm ? 'PM' : 'AM';

  return `${displayHour}${displayMinute} ${ampm}`;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
