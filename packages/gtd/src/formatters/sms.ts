import type { TaskType, TaskContext, TaskPriority, ClassificationResult } from '@clarity/shared-types';

/**
 * SMS Message Limits
 * Standard SMS is 160 characters, but we aim for shorter for better readability
 */
const MAX_SMS_LENGTH = 160;
const PREFERRED_SMS_LENGTH = 140;

/**
 * Emoji mapping for task types
 */
const TYPE_EMOJI: Record<TaskType, string> = {
  action: '✅',
  project: '📁',
  waiting: '⏳',
  someday: '💭',
  agenda: '👥',
};

/**
 * Emoji mapping for contexts
 */
const CONTEXT_DISPLAY: Record<TaskContext, string> = {
  work: '📍 @work',
  home: '📍 @home',
  errands: '📍 @errands',
  calls: '📍 @calls',
  computer: '📍 @computer',
  anywhere: '📍 @anywhere',
};

/**
 * Emoji mapping for priorities
 */
const PRIORITY_DISPLAY: Record<TaskPriority, string> = {
  today: '🔥 Today',
  this_week: '⚡ This week',
  soon: '📋 Soon',
};

/**
 * Format a captured task confirmation
 */
export function formatTaskCapture(
  title: string,
  type: TaskType,
  context?: TaskContext | null,
  priority?: TaskPriority | null,
  dueDate?: string | null,
  personName?: string | null,
  pendingCount?: number
): string {
  const lines: string[] = [];

  // Main task line with type emoji
  const emoji = TYPE_EMOJI[type];

  switch (type) {
    case 'action':
      lines.push(`${emoji} ${title}`);
      break;
    case 'project':
      lines.push(`${emoji} Project: ${title}`);
      break;
    case 'waiting':
      lines.push(`${emoji} Waiting: ${title}`);
      break;
    case 'someday':
      lines.push(`${emoji} Someday: ${title}`);
      break;
    case 'agenda':
      lines.push(`${emoji} ${personName ?? 'Someone'}: '${title}'`);
      break;
  }

  // Add context
  if (context) {
    lines.push(CONTEXT_DISPLAY[context]);
  }

  // Add due date
  if (dueDate) {
    lines.push(`📅 Due: ${formatDate(dueDate)}`);
  }

  // Add priority (only if not obvious from due date)
  if (priority && !dueDate) {
    lines.push(PRIORITY_DISPLAY[priority]);
  }

  // Add pending count for agenda items
  if (type === 'agenda' && personName && pendingCount !== undefined) {
    lines.push(`${pendingCount} items pending.`);
  }

  return lines.join('\n');
}

/**
 * Format a clarification question response
 */
export function formatClarification(classification: ClassificationResult): string {
  if (classification.type === 'unknown') {
    return (
      classification.reasoning ??
      "I'm not sure what you'd like to do. Can you rephrase that?"
    );
  }

  // For agenda items without person match
  if (classification.type === 'agenda' && classification.personMatch?.confidence === 0) {
    return `I don't have "${classification.personMatch.name}" in your People list.\n1️⃣ Add them & create agenda item\n2️⃣ Make it an action instead\n3️⃣ Skip`;
  }

  return 'What would you like to do with this?';
}

/**
 * Format task completion response
 */
export function formatTaskComplete(title: string, wasDueToday?: boolean): string {
  let response = `✅ ${truncate(title, 40)} — done!`;

  if (wasDueToday) {
    response += '\nNice timing! 🎉';
  }

  return response;
}

/**
 * Format help command response
 */
export function formatHelp(): string {
  return `📖 Commands:
• today — today's tasks
• actions — all actions
• @work/@home/@calls — by context
• projects — active projects
• waiting — waiting on others
• someday — future ideas
• meetings — your people
• done [text] — complete task
• help — this message`;
}

/**
 * Format project follow-up question
 */
export function formatProjectFollowup(projectTitle: string): string {
  return `📁 Project: ${truncate(projectTitle, 50)}\n\nWhat's the first action to move this forward?`;
}

/**
 * Format waiting follow-up question
 */
export function formatWaitingFollowup(title: string): string {
  return `⏳ Waiting: ${truncate(title, 50)}\n\nWhen should I remind you to follow up?`;
}

/**
 * Format onboarding welcome message
 */
export function formatWelcome(oauthUrl: string): string {
  return `Hey! 👋 I'm Clarity — your GTD assistant.\n\nText me tasks, ideas, or things to discuss with people. I'll organize everything in Notion.\n\nLet's connect your workspace:\n${oauthUrl}`;
}

/**
 * Format onboarding complete message
 */
export function formatOnboardingComplete(): string {
  return `You're all set! 🎉\n\nText me anything — I'll organize it.\n\nText 'help' for commands.`;
}

/**
 * Format task list for SMS
 */
export function formatTaskList(
  title: string,
  tasks: Array<{ title: string; emoji?: string; detail?: string }>,
  showNumbers = false
): string {
  const lines: string[] = [title, ''];

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!;
    const prefix = showNumbers ? `${i + 1}. ` : '• ';
    const emoji = task.emoji ? `${task.emoji} ` : '';
    let line = `${prefix}${emoji}${truncate(task.title, 40)}`;

    if (task.detail) {
      line += ` — ${task.detail}`;
    }

    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Split long message into multiple SMS-sized chunks
 */
export function splitMessage(message: string, maxLength = MAX_SMS_LENGTH): string[] {
  if (message.length <= maxLength) {
    return [message];
  }

  const messages: string[] = [];
  const lines = message.split('\n');
  let current = '';

  for (const line of lines) {
    const potentialLength = current.length + (current ? 1 : 0) + line.length;

    if (potentialLength <= maxLength) {
      current += (current ? '\n' : '') + line;
    } else {
      if (current) {
        messages.push(current);
      }
      current = line;
    }
  }

  if (current) {
    messages.push(current);
  }

  return messages;
}

/**
 * Format a date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.getTime() === today.getTime()) {
    return 'Today';
  }

  if (date.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  }

  // Check if this week
  const daysUntil = Math.floor((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (daysUntil > 0 && daysUntil <= 7) {
    return date.toLocaleDateString('en-US', { weekday: 'long' });
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Truncate text with ellipsis
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 1) + '…';
}
