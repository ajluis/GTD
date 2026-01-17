import { users } from '@clarity/database';
import { eq } from 'drizzle-orm';
import type { IntentEntities } from '@clarity/shared-types';
import type { HandlerContext } from './intents.js';

/**
 * Common timezone mappings
 */
const TIMEZONE_MAPPINGS: Record<string, string> = {
  // US
  'pacific': 'America/Los_Angeles',
  'pst': 'America/Los_Angeles',
  'pdt': 'America/Los_Angeles',
  'mountain': 'America/Denver',
  'mst': 'America/Denver',
  'mdt': 'America/Denver',
  'central': 'America/Chicago',
  'cst': 'America/Chicago',
  'cdt': 'America/Chicago',
  'eastern': 'America/New_York',
  'est': 'America/New_York',
  'edt': 'America/New_York',
  // Cities
  'los angeles': 'America/Los_Angeles',
  'la': 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'sf': 'America/Los_Angeles',
  'seattle': 'America/Los_Angeles',
  'denver': 'America/Denver',
  'chicago': 'America/Chicago',
  'new york': 'America/New_York',
  'nyc': 'America/New_York',
  'boston': 'America/New_York',
  'miami': 'America/New_York',
  'atlanta': 'America/New_York',
  // States/Regions
  'california': 'America/Los_Angeles',
  'texas': 'America/Chicago',
  'florida': 'America/New_York',
  // International
  'london': 'Europe/London',
  'uk': 'Europe/London',
  'paris': 'Europe/Paris',
  'berlin': 'Europe/Berlin',
  'tokyo': 'Asia/Tokyo',
  'sydney': 'Australia/Sydney',
  // UTC
  'utc': 'UTC',
  'gmt': 'UTC',
};

/**
 * Parse time string to HH:MM format
 */
function parseTimeString(timeStr: string | undefined): string | null {
  if (!timeStr) return null;

  const normalized = timeStr.toLowerCase().trim();

  // Try HH:MM format
  const hhmmMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmmMatch) {
    const hours = parseInt(hhmmMatch[1]!, 10);
    const minutes = parseInt(hhmmMatch[2]!, 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  // Try "7am", "7:30pm" format
  const ampmMatch = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1]!, 10);
    const minutes = ampmMatch[2] ? parseInt(ampmMatch[2], 10) : 0;
    const isPM = ampmMatch[3] === 'pm';

    if (hours === 12) {
      hours = isPM ? 12 : 0;
    } else if (isPM) {
      hours += 12;
    }

    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    }
  }

  return null;
}

/**
 * Format time for display
 */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const h = hours! % 12 || 12;
  const ampm = hours! >= 12 ? 'PM' : 'AM';
  return minutes === 0 ? `${h} ${ampm}` : `${h}:${minutes!.toString().padStart(2, '0')} ${ampm}`;
}

/**
 * Handle set_digest_time intent
 * "send my digest at 7am", "change morning summary to 6:30"
 */
export async function handleSetDigestTime(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const timeValue = entities.newValue;
  const parsedTime = parseTimeString(timeValue);

  if (!parsedTime) {
    return "What time? Try '7am', '7:30am', or '07:00'";
  }

  await ctx.db
    .update(users)
    .set({ digestTime: parsedTime, updatedAt: new Date() })
    .where(eq(users.id, ctx.user.id));

  return `✅ Daily digest will arrive at ${formatTime(parsedTime)}.`;
}

/**
 * Handle set_timezone intent
 * "I'm in Pacific time", "change timezone to Eastern", "I moved to California"
 */
export async function handleSetTimezone(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const tzValue = entities.newValue?.toLowerCase().trim();

  if (!tzValue) {
    return "What timezone? Try 'Pacific', 'Eastern', or a city name like 'New York'.";
  }

  // Try to resolve timezone
  let timezone: string | null = null;

  // Check our mappings first
  if (TIMEZONE_MAPPINGS[tzValue]) {
    timezone = TIMEZONE_MAPPINGS[tzValue]!;
  }

  // Check if it's already a valid IANA timezone
  if (!timezone) {
    try {
      // Test if it's a valid timezone
      new Date().toLocaleString('en-US', { timeZone: tzValue });
      timezone = tzValue;
    } catch {
      // Not a valid IANA timezone
    }
  }

  // Try common variations
  if (!timezone) {
    const variations = [
      tzValue.replace(/\s+/g, '_'),
      `America/${tzValue.charAt(0).toUpperCase() + tzValue.slice(1)}`,
      `Europe/${tzValue.charAt(0).toUpperCase() + tzValue.slice(1)}`,
    ];

    for (const tz of variations) {
      try {
        new Date().toLocaleString('en-US', { timeZone: tz });
        timezone = tz;
        break;
      } catch {
        // Not valid, try next
      }
    }
  }

  if (!timezone) {
    return `I couldn't find timezone "${tzValue}".\n\nTry: Pacific, Eastern, Central, Mountain, or a city like 'New York'.`;
  }

  await ctx.db
    .update(users)
    .set({ timezone, updatedAt: new Date() })
    .where(eq(users.id, ctx.user.id));

  // Get current time in new timezone for confirmation
  const now = new Date().toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return `✅ Timezone updated to ${timezone}.\n\nYour current time: ${now}`;
}

/**
 * Handle set_reminder_hours intent
 * "remind me 3 hours before meetings"
 */
export async function handleSetReminderHours(
  entities: IntentEntities,
  ctx: HandlerContext
): Promise<string> {
  const hoursValue = entities.newValue;

  // Parse hours from string
  const hours = hoursValue ? parseInt(hoursValue, 10) : NaN;

  if (isNaN(hours) || hours < 0 || hours > 24) {
    return "How many hours before? Try 'remind me 2 hours before meetings'";
  }

  await ctx.db
    .update(users)
    .set({ meetingReminderHours: hours, updatedAt: new Date() })
    .where(eq(users.id, ctx.user.id));

  const hourText = hours === 1 ? '1 hour' : `${hours} hours`;
  return `✅ Meeting reminders will arrive ${hourText} before.`;
}

/**
 * Handle pause_account intent
 * "pause notifications", "going on vacation"
 */
export async function handlePauseAccount(ctx: HandlerContext): Promise<string> {
  if (ctx.user.status === 'paused') {
    return "You're already paused. Text 'I'm back' to resume.";
  }

  await ctx.db
    .update(users)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(eq(users.id, ctx.user.id));

  return "✅ Notifications paused.\n\nText 'I'm back' or 'resume' when you're ready!";
}

/**
 * Handle resume_account intent
 * "I'm back", "resume notifications", "unpause"
 */
export async function handleResumeAccount(ctx: HandlerContext): Promise<string> {
  if (ctx.user.status === 'active') {
    return "You're already active! Text something to capture a task.";
  }

  await ctx.db
    .update(users)
    .set({ status: 'active', updatedAt: new Date() })
    .where(eq(users.id, ctx.user.id));

  return "✅ Welcome back! Notifications resumed.\n\nText 'today' to see what's on your plate.";
}

/**
 * Handle show_settings intent
 * "what are my settings", "show preferences"
 */
export async function handleShowSettings(ctx: HandlerContext): Promise<string> {
  const digestTime = formatTime(ctx.user.digestTime);

  const lines = [
    '⚙️ SETTINGS:',
    '',
    `📍 Timezone: ${ctx.user.timezone}`,
    `☀️ Daily digest: ${digestTime}`,
    `🔔 Meeting reminder: ${ctx.user.meetingReminderHours}h before`,
    `📊 Status: ${ctx.user.status}`,
    '',
    `📈 Tasks captured: ${ctx.user.totalTasksCaptured}`,
    `✅ Tasks completed: ${ctx.user.totalTasksCompleted}`,
  ];

  return lines.join('\n');
}
