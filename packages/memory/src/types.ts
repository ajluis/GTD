/**
 * Memory System Types
 *
 * Type definitions for the learning and memory system
 * that enables the agent to improve over time.
 */

// ============================================================================
// Memory Types
// ============================================================================

/**
 * Base memory interface
 */
export interface Memory {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  entities: MemoryEntity[];
  relevanceScore: number;
  createdAt: Date;
  lastRetrievedAt?: Date;
  retrievalCount: number;
}

/**
 * Types of memories
 */
export type MemoryType = 'interaction' | 'correction' | 'preference' | 'important';

/**
 * Entity extracted from a memory
 * Note: Must match the ConversationEntity type in database schema
 */
export interface MemoryEntity {
  type: 'task' | 'person' | 'project' | 'topic';
  id?: string;
  name: string;
  context?: string;
}

// ============================================================================
// Learning Types
// ============================================================================

/**
 * Learning signal from a user correction
 */
export interface CorrectionLearning {
  /** Task content that was corrected */
  taskContent: string;

  /** What was originally inferred */
  original: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
  };

  /** What the user corrected it to */
  corrected: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
  };

  /** Keywords extracted from the task */
  keywords: string[];

  /** When the correction happened */
  timestamp: Date;
}

/**
 * Learned association
 */
export interface LearnedAssociation {
  /** Trigger phrase or keyword */
  trigger: string;

  /** What it maps to */
  target: {
    project?: string;
    labels?: string[];
    priority?: number;
    context?: string;
  };

  /** Confidence in this association (0-1) */
  confidence: number;

  /** Number of times this was observed */
  occurrences: number;

  /** Last time this was used */
  lastUsed: Date;

  /** Source of the learning */
  source: 'correction' | 'usage' | 'explicit';
}

/**
 * Usage pattern
 */
export interface UsagePattern {
  /** What action was taken */
  action: 'create_task' | 'complete_task' | 'query' | 'update_task';

  /** Relevant entities */
  entities: {
    project?: string;
    labels?: string[];
    person?: string;
  };

  /** Time of day */
  hour: number;

  /** Day of week */
  dayOfWeek: number;

  /** Count of this pattern */
  count: number;
}

// ============================================================================
// Memory Operations
// ============================================================================

/**
 * Memory storage request
 */
export interface StoreMemoryRequest {
  userId: string;
  type: MemoryType;
  content: string;
  entities?: MemoryEntity[];
  relevanceScore?: number;
}

/**
 * Memory retrieval request
 */
export interface RetrieveMemoryRequest {
  userId: string;
  /** Query text to match against */
  query?: string;
  /** Filter by memory type */
  types?: MemoryType[];
  /** Filter by entities */
  entities?: Partial<MemoryEntity>[];
  /** Maximum number of memories to return */
  limit?: number;
  /** Minimum relevance score */
  minRelevance?: number;
}

/**
 * Memory retrieval result
 */
export interface RetrievedMemory extends Memory {
  /** How well this memory matched the query */
  matchScore: number;
}

// ============================================================================
// Learning Operations
// ============================================================================

/**
 * Learning input from an interaction
 */
export interface InteractionForLearning {
  /** User's original message */
  message: string;

  /** What the agent inferred */
  inference?: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
  };

  /** What actually happened (from tool calls) */
  outcome?: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
    taskId?: string;
  };

  /** User's correction (if any) */
  correction?: {
    project?: string;
    labels?: string[];
    priority?: number;
    taskType?: string;
  };

  /** Tool calls made */
  toolCalls?: Array<{
    tool: string;
    params: Record<string, unknown>;
    success: boolean;
  }>;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Learning result
 */
export interface LearningResult {
  /** New associations learned */
  newAssociations: LearnedAssociation[];

  /** Updated associations */
  updatedAssociations: LearnedAssociation[];

  /** Memory stored */
  memoryStored?: Memory;

  /** Summary of what was learned */
  summary: string;
}
