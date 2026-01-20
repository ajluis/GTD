/**
 * @gtd/memory - Memory and Learning Package
 *
 * This package provides long-term memory and learning capabilities
 * for the GTD agent, enabling it to improve over time.
 *
 * ## Key Concepts
 *
 * **Memory** stores significant interactions for future reference:
 * - Conversation summaries
 * - Important decisions
 * - User preferences expressed in conversation
 *
 * **Learning** extracts patterns from user behavior:
 * - Corrections ("no, put that in Apollo") → learned associations
 * - Usage patterns → reinforced preferences
 * - Frequency data → common labels, frequent projects
 *
 * ## Usage
 *
 * ```typescript
 * import { createMemoryManager, createLearningEngine } from '@gtd/memory';
 *
 * // Create managers
 * const memory = createMemoryManager({ db });
 * const learning = createLearningEngine({ db });
 *
 * // Store a memory
 * await memory.maybeStore(userId, {
 *   message: 'add buy groceries to personal',
 *   response: 'Added "Buy groceries" to Personal',
 *   toolCalls: [{ tool: 'create_task', success: true }],
 * });
 *
 * // Learn from an interaction
 * await learning.learnFromInteraction(userId, {
 *   message: 'add buy eggs',
 *   inference: { project: 'Inbox' },
 *   correction: { project: 'Groceries' },
 *   timestamp: new Date(),
 * });
 *
 * // Retrieve relevant memories
 * const memories = await memory.getRelevantMemories(userId, 'groceries');
 * ```
 */

// Types
export type {
  // Memory types
  Memory,
  MemoryType,
  MemoryEntity,
  StoreMemoryRequest,
  RetrieveMemoryRequest,
  RetrievedMemory,

  // Learning types
  CorrectionLearning,
  LearnedAssociation,
  UsagePattern,
  InteractionForLearning,
  LearningResult,
} from './types.js';

// Memory Manager
export {
  MemoryManager,
  createMemoryManager,
  type MemoryManagerConfig,
} from './manager.js';

// Learning Engine
export {
  LearningEngine,
  createLearningEngine,
  type LearningEngineConfig,
} from './learning.js';
