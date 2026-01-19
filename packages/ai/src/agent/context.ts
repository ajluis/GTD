/**
 * Conversation Context Manager
 * Tracks entity references and undo stack for multi-turn conversations
 */

import type { DbClient } from '@gtd/database';
import type {
  ConversationContext,
  TaskReference,
  PersonReference,
  UndoAction,
} from '../tools/types.js';

// In-memory cache for conversation context
// In production, this could be Redis or database-backed
const contextCache = new Map<string, ConversationContext>();

// Context expiration time (1 hour)
const CONTEXT_TTL_MS = 60 * 60 * 1000;

/**
 * Conversation Context Manager
 */
export class ConversationContextManager {
  private db: DbClient;

  constructor(db: DbClient) {
    this.db = db;
  }

  /**
   * Get or create conversation context for a user
   */
  async get(userId: string): Promise<ConversationContext> {
    // Check cache first
    const cached = contextCache.get(userId);
    if (cached && cached.expiresAt > new Date()) {
      return cached;
    }

    // Create new context
    const context = this.createEmptyContext(userId);
    contextCache.set(userId, context);
    return context;
  }

  /**
   * Update conversation context
   */
  async update(
    userId: string,
    updates: Partial<ConversationContext>
  ): Promise<ConversationContext> {
    const context = await this.get(userId);

    // Apply updates
    if (updates.lastTasks !== undefined) {
      context.lastTasks = updates.lastTasks;
    }
    if (updates.lastPeople !== undefined) {
      context.lastPeople = updates.lastPeople;
    }
    if (updates.lastCreatedTaskId !== undefined) {
      context.lastCreatedTaskId = updates.lastCreatedTaskId;
    }
    if (updates.undoStack !== undefined) {
      context.undoStack = updates.undoStack;
    }
    if (updates.activeFlow !== undefined) {
      context.activeFlow = updates.activeFlow;
    }
    if (updates.flowState !== undefined) {
      context.flowState = updates.flowState;
    }

    // Update timestamps
    context.updatedAt = new Date();
    context.expiresAt = new Date(Date.now() + CONTEXT_TTL_MS);

    // Save to cache
    contextCache.set(userId, context);

    return context;
  }

  /**
   * Set last referenced tasks
   */
  async setLastTasks(userId: string, tasks: TaskReference[]): Promise<void> {
    await this.update(userId, { lastTasks: tasks.slice(0, 10) });
  }

  /**
   * Set last referenced people
   */
  async setLastPeople(userId: string, people: PersonReference[]): Promise<void> {
    await this.update(userId, { lastPeople: people.slice(0, 10) });
  }

  /**
   * Push an action to the undo stack
   */
  async pushUndo(userId: string, action: UndoAction): Promise<void> {
    const context = await this.get(userId);
    const newStack = [action, ...context.undoStack.slice(0, 4)]; // Keep last 5
    await this.update(userId, { undoStack: newStack });
  }

  /**
   * Pop and return the most recent undo action
   */
  async popUndo(userId: string): Promise<UndoAction | null> {
    const context = await this.get(userId);
    if (context.undoStack.length === 0) {
      return null;
    }

    const [action, ...rest] = context.undoStack;
    await this.update(userId, { undoStack: rest });
    return action!;
  }

  /**
   * Start a multi-turn flow
   */
  async startFlow(
    userId: string,
    flow: ConversationContext['activeFlow'],
    initialState?: unknown
  ): Promise<void> {
    await this.update(userId, {
      activeFlow: flow,
      flowState: initialState,
    });
  }

  /**
   * End the active flow
   */
  async endFlow(userId: string): Promise<void> {
    await this.update(userId, {
      activeFlow: undefined,
      flowState: undefined,
    });
  }

  /**
   * Clear context for a user
   */
  async clear(userId: string): Promise<void> {
    contextCache.delete(userId);
  }

  /**
   * Create empty context
   */
  private createEmptyContext(userId: string): ConversationContext {
    const now = new Date();
    return {
      userId,
      lastTasks: [],
      lastPeople: [],
      undoStack: [],
      updatedAt: now,
      expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS),
    };
  }
}

/**
 * Clean up expired contexts (call periodically)
 */
export function cleanupExpiredContexts(): void {
  const now = new Date();
  for (const [userId, context] of contextCache) {
    if (context.expiresAt <= now) {
      contextCache.delete(userId);
    }
  }
}

/**
 * Create context manager instance
 */
export function createContextManager(db: DbClient): ConversationContextManager {
  return new ConversationContextManager(db);
}
