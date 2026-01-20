/**
 * @gtd/context - Context Management Package
 *
 * This package provides the rich context system that enables
 * intelligent task inference and personalized agent behavior.
 *
 * ## Key Concepts
 *
 * **Context** is information about the user that helps the agent
 * make better decisions:
 *
 * - **Preferences**: User-configured rules (label mappings, default projects)
 * - **Patterns**: Learned behaviors from corrections and usage
 * - **Session**: Current conversation state (recent tasks, mentioned people)
 * - **Entities**: Known people, projects, and labels
 *
 * ## Usage
 *
 * ```typescript
 * import { createContextManager, formatContextForPrompt } from '@gtd/context';
 *
 * // Create manager
 * const contextManager = createContextManager({ db });
 *
 * // Get context for a user
 * const context = await contextManager.getContext(userId);
 *
 * // Format for LLM prompt
 * const contextPrompt = formatContextForPrompt(context);
 *
 * // Update after interaction
 * await contextManager.updateFromInteraction(userId, {
 *   type: 'task_created',
 *   message: 'add buy milk',
 *   entities: { tasks: [{ id: '123', title: 'Buy milk' }] },
 *   response: 'Added "Buy milk" to Personal',
 *   timestamp: new Date(),
 * });
 * ```
 */

// Types
export type {
  // Core context types
  UserContext,
  UserPreferences,
  LearnedPatterns,
  SessionContext,
  UserEntities,

  // Entity types
  PersonEntity,
  ProjectEntity,
  LabelEntity,
  RecurringPattern,

  // Pattern types
  WordAssociation,
  TaskTypePattern,
  PersonPattern,

  // Session types
  TaskRef,
  PersonRef,
  UndoInfo,

  // Update types
  ContextUpdate,
  ToolCallInfo,
  CorrectionSignal,
} from './types.js';

// Default values
export {
  DEFAULT_PREFERENCES,
  DEFAULT_PATTERNS,
  createEmptySession,
  createEmptyEntities,
} from './types.js';

// Context Manager
export {
  ContextManager,
  createContextManager,
  type ContextManagerConfig,
} from './manager.js';

// Context Loader (prompt formatting)
export {
  formatContextForPrompt,
  suggestProject,
  suggestLabels,
  findPerson,
  findProject,
} from './loader.js';
