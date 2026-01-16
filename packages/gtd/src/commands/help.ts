import type { CommandHandler } from './types.js';
import { formatHelp } from '../formatters/index.js';

/**
 * Help command handler
 *
 * Returns a list of available commands.
 */
export const handleHelp: CommandHandler = async () => {
  return formatHelp();
};
