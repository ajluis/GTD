import type { CommandContext, CommandDefinition } from './types.js';
import { handleHelp } from './help.js';

export type { CommandContext, CommandHandler, CommandDefinition } from './types.js';

/**
 * All registered commands
 *
 * Commands are matched in order, so more specific commands should come first.
 */
const commands: CommandDefinition[] = [
  {
    name: 'help',
    aliases: ['?', 'commands'],
    description: 'Show available commands',
    handler: handleHelp,
  },
  // Note: Additional commands (today, actions, done, etc.) will be implemented
  // in the worker where they have access to database clients.
  // These placeholder definitions help with command detection.
];

/**
 * Check if a message is a command
 *
 * @param message - User's message
 * @returns True if message starts with a known command
 */
export function isCommand(message: string): boolean {
  const normalized = message.trim().toLowerCase();

  // Check for exact command matches
  const commandList = [
    'today',
    'actions',
    'projects',
    'waiting',
    'someday',
    'meetings',
    'people',
    'help',
    '?',
    'commands',
    '@work',
    '@home',
    '@errands',
    '@calls',
    '@computer',
  ];

  // Exact match
  if (commandList.includes(normalized)) {
    return true;
  }

  // Starts with command + space (for commands with args like "done task")
  for (const cmd of ['done', 'done with']) {
    if (normalized.startsWith(cmd + ' ') || normalized === cmd) {
      return true;
    }
  }

  return false;
}

/**
 * Parse command from message
 *
 * @param message - User's message
 * @returns Command name and arguments, or null if not a command
 */
export function parseCommand(message: string): { command: string; args: string[] } | null {
  const normalized = message.trim().toLowerCase();

  // Handle "done with [name]" specially
  if (normalized.startsWith('done with ')) {
    return {
      command: 'done_with',
      args: [message.slice('done with '.length).trim()],
    };
  }

  // Handle "done [text]"
  if (normalized.startsWith('done ')) {
    return {
      command: 'done',
      args: [message.slice('done '.length).trim()],
    };
  }

  // Handle context commands
  if (normalized.startsWith('@')) {
    const context = normalized.slice(1); // Remove @
    return {
      command: 'context',
      args: [context],
    };
  }

  // Simple commands without args
  const simpleCommands = [
    'today',
    'actions',
    'projects',
    'waiting',
    'someday',
    'meetings',
    'people',
    'help',
  ];

  for (const cmd of simpleCommands) {
    if (normalized === cmd || normalized === cmd.charAt(0)) {
      return { command: cmd, args: [] };
    }
  }

  // Check aliases
  if (normalized === '?' || normalized === 'commands') {
    return { command: 'help', args: [] };
  }

  return null;
}

/**
 * Execute a command
 *
 * @param command - Command name
 * @param args - Command arguments
 * @param ctx - Command context
 * @returns SMS response
 */
export async function executeCommand(
  command: string,
  args: string[],
  ctx: CommandContext
): Promise<string | null> {
  const def = commands.find(
    (c) => c.name === command || c.aliases?.includes(command)
  );

  if (!def) {
    return null;
  }

  return def.handler(ctx, args);
}

// Re-export individual handlers for direct use
export { handleHelp } from './help.js';
