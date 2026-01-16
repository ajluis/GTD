/**
 * Command Handler Context
 *
 * Provides access to database clients and user information
 * needed to execute commands.
 */
export interface CommandContext {
  /** User's database ID */
  userId: string;
  /** User's phone number */
  phoneNumber: string;
  /** User's Notion Tasks database ID */
  notionTasksDbId: string;
  /** User's Notion People database ID */
  notionPeopleDbId: string;
  /** User's Notion access token */
  notionToken: string;
}

/**
 * Command Handler Function
 *
 * Takes the command context and optional arguments,
 * returns the SMS response to send to the user.
 */
export type CommandHandler = (
  ctx: CommandContext,
  args: string[]
) => Promise<string>;

/**
 * Command Definition
 */
export interface CommandDefinition {
  /** Command name (lowercase, no prefix) */
  name: string;
  /** Aliases that also trigger this command */
  aliases?: string[];
  /** Brief description for help text */
  description: string;
  /** The handler function */
  handler: CommandHandler;
}
