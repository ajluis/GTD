/**
 * Memory Manager
 *
 * Handles storage, retrieval, and management of conversation memories
 * for long-term context and learning.
 */

import type { DbClient } from '@gtd/database';
import type {
  Memory,
  MemoryType,
  MemoryEntity,
  StoreMemoryRequest,
  RetrieveMemoryRequest,
  RetrievedMemory,
} from './types.js';

// ============================================================================
// Memory Manager
// ============================================================================

/**
 * Memory Manager Configuration
 */
export interface MemoryManagerConfig {
  db: DbClient;
  /** Maximum memories per user */
  maxMemoriesPerUser?: number;
  /** Decay factor for relevance over time */
  relevanceDecayFactor?: number;
}

/**
 * Memory Manager
 */
export class MemoryManager {
  private db: DbClient;
  private maxMemoriesPerUser: number;
  private relevanceDecayFactor: number;

  constructor(config: MemoryManagerConfig) {
    this.db = config.db;
    this.maxMemoriesPerUser = config.maxMemoriesPerUser ?? 1000;
    this.relevanceDecayFactor = config.relevanceDecayFactor ?? 0.95;
  }

  // ==========================================================================
  // Memory Storage
  // ==========================================================================

  /**
   * Store a new memory
   */
  async store(request: StoreMemoryRequest): Promise<Memory> {
    const { userId, type, content, entities = [], relevanceScore = 50 } = request;

    try {
      const { conversationMemory } = await import('@gtd/database/schema');

      const result = await this.db
        .insert(conversationMemory)
        .values({
          userId,
          memoryType: type,
          summary: content,
          keyEntities: entities,
          relevanceScore,
        })
        .returning();

      const record = result[0];
      if (!record) {
        throw new Error('Failed to store memory');
      }

      // Cleanup old memories if needed
      await this.cleanupOldMemories(userId);

      return {
        id: record.id,
        userId: record.userId,
        type: record.memoryType as MemoryType,
        content: record.summary,
        entities: record.keyEntities as MemoryEntity[],
        relevanceScore: record.relevanceScore,
        createdAt: record.createdAt,
        lastRetrievedAt: record.lastRetrievedAt ?? undefined,
        retrievalCount: record.retrievalCount,
      };
    } catch (error) {
      console.error('[MemoryManager] Failed to store memory:', error);
      throw error;
    }
  }

  /**
   * Store a memory only if it's significant enough
   */
  async maybeStore(
    userId: string,
    interaction: {
      message: string;
      response: string;
      toolCalls?: Array<{ tool: string; success: boolean }>;
    }
  ): Promise<Memory | null> {
    // Determine if this interaction is worth remembering
    const significance = this.assessSignificance(interaction);

    if (significance < 0.3) {
      return null; // Not significant enough
    }

    // Extract entities from the interaction
    const entities = this.extractEntities(interaction.message, interaction.response);

    // Create summary
    const content = this.createMemorySummary(interaction);

    // Determine type
    const type: MemoryType = significance >= 0.7 ? 'important' : 'interaction';

    return this.store({
      userId,
      type,
      content,
      entities,
      relevanceScore: Math.round(significance * 100),
    });
  }

  // ==========================================================================
  // Memory Retrieval
  // ==========================================================================

  /**
   * Retrieve relevant memories
   */
  async retrieve(request: RetrieveMemoryRequest): Promise<RetrievedMemory[]> {
    const {
      userId,
      query,
      types,
      entities,
      limit = 10,
      minRelevance = 30,
    } = request;

    try {
      const { conversationMemory } = await import('@gtd/database/schema');
      const { eq, gte, desc, and, inArray } = await import('drizzle-orm');

      // Build query conditions
      const conditions = [
        eq(conversationMemory.userId, userId),
        gte(conversationMemory.relevanceScore, minRelevance),
      ];

      if (types && types.length > 0) {
        conditions.push(inArray(conversationMemory.memoryType, types));
      }

      // Fetch memories
      const results = await this.db
        .select()
        .from(conversationMemory)
        .where(and(...conditions))
        .orderBy(desc(conversationMemory.relevanceScore), desc(conversationMemory.createdAt))
        .limit(limit * 2); // Fetch more for scoring

      // Score and filter memories
      const scored = results.map((record) => {
        const memory: Memory = {
          id: record.id,
          userId: record.userId,
          type: record.memoryType as MemoryType,
          content: record.summary,
          entities: record.keyEntities as MemoryEntity[],
          relevanceScore: record.relevanceScore,
          createdAt: record.createdAt,
          lastRetrievedAt: record.lastRetrievedAt ?? undefined,
          retrievalCount: record.retrievalCount,
        };

        const matchScore = this.scoreMemory(memory, query, entities);

        return {
          ...memory,
          matchScore,
        };
      });

      // Sort by match score and return top results
      const topResults = scored
        .filter((m) => m.matchScore > 0)
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, limit);

      // Update retrieval stats for returned memories
      await this.updateRetrievalStats(topResults.map((m) => m.id));

      return topResults;
    } catch (error) {
      console.error('[MemoryManager] Failed to retrieve memories:', error);
      return [];
    }
  }

  /**
   * Get memories relevant to a specific message
   */
  async getRelevantMemories(userId: string, message: string): Promise<RetrievedMemory[]> {
    // Extract potential entities from the message
    const potentialEntities = this.extractEntitiesFromText(message);

    return this.retrieve({
      userId,
      query: message,
      entities: potentialEntities,
      limit: 5,
      minRelevance: 40,
    });
  }

  // ==========================================================================
  // Memory Scoring
  // ==========================================================================

  /**
   * Score how well a memory matches a query
   */
  private scoreMemory(
    memory: Memory,
    query?: string,
    entities?: Partial<MemoryEntity>[]
  ): number {
    let score = memory.relevanceScore / 100; // Base score from relevance

    // Text similarity (simple keyword matching)
    if (query) {
      const queryWords = query.toLowerCase().split(/\s+/);
      const contentWords = memory.content.toLowerCase().split(/\s+/);

      const matchedWords = queryWords.filter((w) =>
        contentWords.some((c) => c.includes(w) || w.includes(c))
      );

      const textScore = matchedWords.length / queryWords.length;
      score += textScore * 0.3;
    }

    // Entity matching
    if (entities && entities.length > 0) {
      const matchedEntities = entities.filter((queryEntity) =>
        memory.entities.some(
          (memEntity) =>
            (queryEntity.type === undefined || queryEntity.type === memEntity.type) &&
            (queryEntity.name === undefined ||
              memEntity.name.toLowerCase().includes(queryEntity.name.toLowerCase()))
        )
      );

      const entityScore = matchedEntities.length / entities.length;
      score += entityScore * 0.3;
    }

    // Recency bonus
    const ageInDays = (Date.now() - memory.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-ageInDays / 30); // Decay over 30 days
    score += recencyScore * 0.1;

    // Retrieval frequency bonus (memories that were useful before)
    if (memory.retrievalCount > 0) {
      const usageScore = Math.min(memory.retrievalCount / 10, 1);
      score += usageScore * 0.1;
    }

    return Math.min(score, 1);
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Assess significance of an interaction
   */
  private assessSignificance(interaction: {
    message: string;
    response: string;
    toolCalls?: Array<{ tool: string; success: boolean }>;
  }): number {
    let score = 0;

    // Tool usage indicates meaningful interaction
    if (interaction.toolCalls && interaction.toolCalls.length > 0) {
      score += 0.3;

      // Successful tool calls are more significant
      const successRate =
        interaction.toolCalls.filter((t) => t.success).length / interaction.toolCalls.length;
      score += successRate * 0.2;
    }

    // Longer messages are often more significant
    const messageLength = interaction.message.length;
    if (messageLength > 50) score += 0.1;
    if (messageLength > 100) score += 0.1;

    // Check for important keywords
    const importantKeywords = [
      'always',
      'never',
      'prefer',
      'instead',
      'actually',
      'important',
      'remember',
    ];
    const hasImportantKeyword = importantKeywords.some((k) =>
      interaction.message.toLowerCase().includes(k)
    );
    if (hasImportantKeyword) score += 0.2;

    // Check for correction patterns
    const correctionPatterns = [
      /no,?\s+(put|move|change)/i,
      /actually,?\s+(put|it should|make it)/i,
      /wrong project/i,
      /should be/i,
    ];
    const isCorrection = correctionPatterns.some((p) => p.test(interaction.message));
    if (isCorrection) score += 0.3;

    return Math.min(score, 1);
  }

  /**
   * Extract entities from message and response
   */
  private extractEntities(message: string, response: string): MemoryEntity[] {
    const entities: MemoryEntity[] = [];
    const combined = `${message} ${response}`;

    // Extract project mentions
    const projectMatch = combined.match(/(?:project|in)\s+["']?([A-Z][a-zA-Z\s]+)["']?/i);
    if (projectMatch) {
      entities.push({
        type: 'project',
        name: projectMatch[1].trim(),
      });
    }

    // Extract task mentions
    const taskMatch = combined.match(/(?:task|added|created)\s+["']([^"']+)["']/i);
    if (taskMatch) {
      entities.push({
        type: 'task',
        name: taskMatch[1].trim(),
      });
    }

    // Extract person mentions (common names or with "with", "for", "to")
    const personMatch = combined.match(/(?:with|for|to)\s+([A-Z][a-z]+)\b/);
    if (personMatch) {
      entities.push({
        type: 'person',
        name: personMatch[1],
      });
    }

    return entities;
  }

  /**
   * Extract potential entities from text (for querying)
   */
  private extractEntitiesFromText(text: string): Partial<MemoryEntity>[] {
    const entities: Partial<MemoryEntity>[] = [];

    // Look for capitalized words (potential names/projects)
    const capitalizedWords = text.match(/\b[A-Z][a-z]+\b/g);
    if (capitalizedWords) {
      for (const word of capitalizedWords) {
        entities.push({ name: word });
      }
    }

    return entities;
  }

  /**
   * Create a summary of an interaction for storage
   */
  private createMemorySummary(interaction: {
    message: string;
    response: string;
    toolCalls?: Array<{ tool: string; success: boolean }>;
  }): string {
    const tools = interaction.toolCalls?.map((t) => t.tool).join(', ') ?? 'none';

    // Truncate if too long
    const maxLength = 500;
    let summary = `User: ${interaction.message.slice(0, 200)}`;
    summary += `\nTools: ${tools}`;
    summary += `\nResponse: ${interaction.response.slice(0, 200)}`;

    return summary.slice(0, maxLength);
  }

  /**
   * Update retrieval statistics for memories
   */
  private async updateRetrievalStats(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;

    try {
      const { conversationMemory } = await import('@gtd/database/schema');
      const { inArray, sql } = await import('drizzle-orm');

      await this.db
        .update(conversationMemory)
        .set({
          retrievalCount: sql`${conversationMemory.retrievalCount} + 1`,
          lastRetrievedAt: new Date(),
        })
        .where(inArray(conversationMemory.id, memoryIds));
    } catch (error) {
      console.error('[MemoryManager] Failed to update retrieval stats:', error);
    }
  }

  /**
   * Cleanup old memories to stay within limits
   */
  private async cleanupOldMemories(userId: string): Promise<void> {
    try {
      const { conversationMemory } = await import('@gtd/database/schema');
      const { eq, desc, lt, and } = await import('drizzle-orm');

      // Count existing memories
      const countResult = await this.db
        .select({ count: conversationMemory.id })
        .from(conversationMemory)
        .where(eq(conversationMemory.userId, userId));

      // If we're over the limit, delete oldest low-relevance memories
      const currentCount = countResult.length;
      if (currentCount <= this.maxMemoriesPerUser) return;

      const toDelete = currentCount - this.maxMemoriesPerUser + 10; // Delete a few extra

      // Find memories to delete (oldest, lowest relevance, not important)
      const oldMemories = await this.db
        .select({ id: conversationMemory.id })
        .from(conversationMemory)
        .where(
          and(
            eq(conversationMemory.userId, userId),
            lt(conversationMemory.relevanceScore, 50)
          )
        )
        .orderBy(
          conversationMemory.relevanceScore,
          conversationMemory.createdAt
        )
        .limit(toDelete);

      if (oldMemories.length > 0) {
        const { inArray } = await import('drizzle-orm');
        await this.db
          .delete(conversationMemory)
          .where(inArray(conversationMemory.id, oldMemories.map((m) => m.id)));

        console.log(`[MemoryManager] Cleaned up ${oldMemories.length} old memories for user ${userId}`);
      }
    } catch (error) {
      console.error('[MemoryManager] Failed to cleanup old memories:', error);
    }
  }

  /**
   * Decay relevance scores over time
   */
  async decayRelevanceScores(): Promise<void> {
    try {
      const { conversationMemory } = await import('@gtd/database/schema');
      const { sql, gt } = await import('drizzle-orm');

      // Apply decay to all memories with relevance > 20
      await this.db
        .update(conversationMemory)
        .set({
          relevanceScore: sql`GREATEST(20, FLOOR(${conversationMemory.relevanceScore} * ${this.relevanceDecayFactor}))`,
        })
        .where(gt(conversationMemory.relevanceScore, 20));

      console.log('[MemoryManager] Applied relevance decay');
    } catch (error) {
      console.error('[MemoryManager] Failed to decay relevance scores:', error);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a memory manager instance
 */
export function createMemoryManager(config: MemoryManagerConfig): MemoryManager {
  return new MemoryManager(config);
}
