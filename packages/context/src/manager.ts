/**
 * Context Manager
 *
 * Aggregates and manages user context from multiple sources:
 * - Database (preferences, learned patterns)
 * - Session cache (recent activity)
 * - Todoist (projects, labels)
 *
 * The Context Manager is the central hub for all context-related operations.
 * It provides a unified interface for retrieving and updating user context.
 */

import type { DbClient } from '@gtd/database';
import type {
  UserContext,
  UserPreferences,
  LearnedPatterns,
  SessionContext,
  UserEntities,
  ContextUpdate,
  TaskRef,
  PersonRef,
  WordAssociation,
  PersonEntity,
  ProjectEntity,
  LabelEntity,
} from './types.js';
import {
  DEFAULT_PREFERENCES,
  DEFAULT_PATTERNS,
  createEmptySession,
  createEmptyEntities,
} from './types.js';

// ============================================================================
// Context Manager
// ============================================================================

/**
 * Context Manager Configuration
 */
export interface ContextManagerConfig {
  /** Database client */
  db: DbClient;
  /** Session TTL in milliseconds (default: 1 hour) */
  sessionTTL?: number;
  /** Entity cache TTL in milliseconds (default: 5 minutes) */
  entityCacheTTL?: number;
}

/**
 * Context Manager
 *
 * Manages user context for intelligent task inference.
 */
export class ContextManager {
  private db: DbClient;
  private sessionTTL: number;
  private entityCacheTTL: number;

  // In-memory caches
  private sessionCache = new Map<string, SessionContext>();
  private preferencesCache = new Map<string, { data: UserPreferences; loadedAt: Date }>();
  private patternsCache = new Map<string, { data: LearnedPatterns; loadedAt: Date }>();
  private entitiesCache = new Map<string, { data: UserEntities; loadedAt: Date }>();

  constructor(config: ContextManagerConfig) {
    this.db = config.db;
    this.sessionTTL = config.sessionTTL ?? 60 * 60 * 1000; // 1 hour
    this.entityCacheTTL = config.entityCacheTTL ?? 5 * 60 * 1000; // 5 minutes
  }

  // ==========================================================================
  // Context Retrieval
  // ==========================================================================

  /**
   * Get complete user context
   *
   * This is the primary method for retrieving context before agent execution.
   * It aggregates data from all sources into a unified context object.
   */
  async getContext(userId: string): Promise<UserContext> {
    const [preferences, patterns, session, entities] = await Promise.all([
      this.getPreferences(userId),
      this.getPatterns(userId),
      this.getSession(userId),
      this.getEntities(userId),
    ]);

    return {
      userId,
      preferences,
      patterns,
      session,
      entities,
      updatedAt: new Date(),
    };
  }

  /**
   * Get user preferences (with caching)
   */
  async getPreferences(userId: string): Promise<UserPreferences> {
    const cached = this.preferencesCache.get(userId);
    if (cached && Date.now() - cached.loadedAt.getTime() < this.entityCacheTTL) {
      return cached.data;
    }

    // Load from database
    const prefs = await this.loadPreferencesFromDb(userId);
    this.preferencesCache.set(userId, { data: prefs, loadedAt: new Date() });
    return prefs;
  }

  /**
   * Get learned patterns (with caching)
   */
  async getPatterns(userId: string): Promise<LearnedPatterns> {
    const cached = this.patternsCache.get(userId);
    if (cached && Date.now() - cached.loadedAt.getTime() < this.entityCacheTTL) {
      return cached.data;
    }

    // Load from database
    const patterns = await this.loadPatternsFromDb(userId);
    this.patternsCache.set(userId, { data: patterns, loadedAt: new Date() });
    return patterns;
  }

  /**
   * Get current session context
   */
  async getSession(userId: string): Promise<SessionContext> {
    let session = this.sessionCache.get(userId);

    // Check if session is expired
    if (session && Date.now() - session.lastActivityAt.getTime() > this.sessionTTL) {
      this.sessionCache.delete(userId);
      session = undefined;
    }

    if (!session) {
      session = createEmptySession();
      this.sessionCache.set(userId, session);
    }

    return session;
  }

  /**
   * Get user entities (people, projects, labels)
   */
  async getEntities(userId: string): Promise<UserEntities> {
    const cached = this.entitiesCache.get(userId);
    if (cached && Date.now() - cached.loadedAt.getTime() < this.entityCacheTTL) {
      return cached.data;
    }

    // Load from database
    const entities = await this.loadEntitiesFromDb(userId);
    this.entitiesCache.set(userId, { data: entities, loadedAt: new Date() });
    return entities;
  }

  // ==========================================================================
  // Context Updates
  // ==========================================================================

  /**
   * Update context after an interaction
   *
   * This should be called after each agent execution to:
   * 1. Update session state (recent tasks, people)
   * 2. Learn from corrections
   * 3. Update pattern frequencies
   */
  async updateFromInteraction(userId: string, update: ContextUpdate): Promise<void> {
    // Update session
    await this.updateSession(userId, update);

    // Handle corrections (for learning)
    if (update.correction) {
      await this.learnFromCorrection(userId, update.correction);
    }

    // Update pattern usage
    if (update.entities?.projects) {
      await this.updateProjectFrequency(userId, update.entities.projects);
    }
  }

  /**
   * Update session context
   */
  async updateSession(userId: string, update: ContextUpdate): Promise<void> {
    const session = await this.getSession(userId);

    // Update recent tasks
    if (update.entities?.tasks) {
      session.recentTasks = [
        ...update.entities.tasks,
        ...session.recentTasks.slice(0, 9), // Keep last 10
      ];

      // Track last created task
      const createdTask = update.entities.tasks.find((t) => t.createdAt);
      if (createdTask) {
        session.lastCreatedTaskId = createdTask.id;
      }
    }

    // Update recent projects
    if (update.entities?.projects) {
      const newProjects = update.entities.projects.filter(
        (p) => !session.recentProjects.includes(p)
      );
      session.recentProjects = [...newProjects, ...session.recentProjects].slice(0, 5);
    }

    // Update mentioned people
    if (update.entities?.people) {
      for (const person of update.entities.people) {
        if (!session.mentionedPeople.find((p) => p.id === person.id)) {
          session.mentionedPeople.push(person);
        }
      }
      session.mentionedPeople = session.mentionedPeople.slice(0, 10);
    }

    // Update last activity
    session.lastActivityAt = new Date();

    this.sessionCache.set(userId, session);
  }

  /**
   * Add to undo stack
   */
  async pushUndo(
    userId: string,
    undo: {
      type: 'create' | 'update' | 'delete' | 'complete';
      taskId: string;
      todoistId?: string;
      previousState?: unknown;
    }
  ): Promise<void> {
    const session = await this.getSession(userId);

    session.undoStack.unshift({
      ...undo,
      timestamp: new Date(),
    });

    // Keep only last 5 undo actions
    session.undoStack = session.undoStack.slice(0, 5);

    this.sessionCache.set(userId, session);
  }

  /**
   * Pop from undo stack
   */
  async popUndo(userId: string): Promise<{
    type: 'create' | 'update' | 'delete' | 'complete';
    taskId: string;
    todoistId?: string;
    previousState?: unknown;
  } | null> {
    const session = await this.getSession(userId);

    if (session.undoStack.length === 0) {
      return null;
    }

    const undo = session.undoStack.shift()!;
    this.sessionCache.set(userId, session);

    return undo;
  }

  // ==========================================================================
  // Preference Management
  // ==========================================================================

  /**
   * Set a user preference
   */
  async setPreference<K extends keyof UserPreferences>(
    userId: string,
    key: K,
    value: UserPreferences[K]
  ): Promise<void> {
    const prefs = await this.getPreferences(userId);
    prefs[key] = value;

    await this.savePreferencesToDb(userId, prefs);
    this.preferencesCache.set(userId, { data: prefs, loadedAt: new Date() });
  }

  /**
   * Add a label mapping
   */
  async addLabelMapping(userId: string, trigger: string, labels: string[]): Promise<void> {
    const prefs = await this.getPreferences(userId);
    prefs.labelMappings[trigger.toLowerCase()] = labels;

    await this.savePreferencesToDb(userId, prefs);
    this.preferencesCache.set(userId, { data: prefs, loadedAt: new Date() });
  }

  /**
   * Add a project mapping
   */
  async addProjectMapping(userId: string, trigger: string, project: string): Promise<void> {
    const prefs = await this.getPreferences(userId);
    prefs.projectMappings[trigger.toLowerCase()] = project;

    await this.savePreferencesToDb(userId, prefs);
    this.preferencesCache.set(userId, { data: prefs, loadedAt: new Date() });
  }

  // ==========================================================================
  // Learning
  // ==========================================================================

  /**
   * Learn from a user correction
   *
   * When a user corrects an inference (e.g., "no, put that in Apollo"),
   * we extract patterns to improve future inferences.
   */
  async learnFromCorrection(
    userId: string,
    correction: ContextUpdate['correction']
  ): Promise<void> {
    if (!correction) return;

    const patterns = await this.getPatterns(userId);

    // Extract potential triggers from the task content
    const triggers = correction.potentialTriggers;

    for (const trigger of triggers) {
      // Find existing association or create new one
      let association = patterns.wordAssociations.find(
        (a) => a.trigger.toLowerCase() === trigger.toLowerCase()
      );

      if (association) {
        // Update existing association
        association.target = {
          project: correction.corrected.project ?? association.target.project,
          labels: correction.corrected.labels ?? association.target.labels,
          priority: correction.corrected.priority ?? association.target.priority,
          context: correction.corrected.taskType ?? association.target.context,
        };
        association.occurrences++;
        association.confidence = Math.min(1, association.confidence + 0.1);
        association.lastUsed = new Date();
      } else {
        // Create new association
        const newAssociation: WordAssociation = {
          trigger: trigger.toLowerCase(),
          target: {
            project: correction.corrected.project,
            labels: correction.corrected.labels,
            priority: correction.corrected.priority,
            context: correction.corrected.taskType,
          },
          confidence: 0.5, // Start at medium confidence
          occurrences: 1,
          lastUsed: new Date(),
        };
        patterns.wordAssociations.push(newAssociation);
      }
    }

    await this.savePatternsToDb(userId, patterns);
    this.patternsCache.set(userId, { data: patterns, loadedAt: new Date() });
  }

  /**
   * Update project frequency based on usage
   */
  async updateProjectFrequency(userId: string, projects: string[]): Promise<void> {
    const patterns = await this.getPatterns(userId);

    // Add to frequent projects, keeping most used at front
    for (const project of projects) {
      const index = patterns.frequentProjects.indexOf(project);
      if (index > -1) {
        // Move to front
        patterns.frequentProjects.splice(index, 1);
      }
      patterns.frequentProjects.unshift(project);
    }

    // Keep only top 10
    patterns.frequentProjects = patterns.frequentProjects.slice(0, 10);

    await this.savePatternsToDb(userId, patterns);
    this.patternsCache.set(userId, { data: patterns, loadedAt: new Date() });
  }

  // ==========================================================================
  // Entity Management
  // ==========================================================================

  /**
   * Sync entities from Todoist
   *
   * This should be called periodically or when entities might have changed.
   */
  async syncEntitiesFromTodoist(
    userId: string,
    todoistData: {
      projects: Array<{
        id: string;
        name: string;
        parent_id?: string | null;
        is_inbox_project?: boolean;
      }>;
      labels: Array<{ id: string; name: string }>;
    }
  ): Promise<void> {
    const entities = await this.getEntities(userId);

    // Build project hierarchy names
    const projectMap = new Map(todoistData.projects.map((p) => [p.id, p]));
    const getHierarchyName = (project: { id: string; name: string; parent_id?: string | null }): string => {
      if (!project.parent_id) return project.name;
      const parent = projectMap.get(project.parent_id);
      if (!parent) return project.name;
      return `${getHierarchyName(parent)} / ${project.name}`;
    };

    // Update projects
    entities.projects = todoistData.projects.map((p) => ({
      id: p.id,
      name: p.name,
      hierarchyName: getHierarchyName(p),
      parentId: p.parent_id ?? undefined,
      isInbox: p.is_inbox_project ?? false,
    }));

    // Update labels
    entities.labels = todoistData.labels.map((l) => ({
      id: l.id,
      name: l.name,
      isContext: l.name.startsWith('@') || ['computer', 'phone', 'home', 'outside', 'errands', 'calls'].includes(l.name.toLowerCase()),
      isPerson: false, // Will be updated when syncing people
    }));

    entities.lastSyncedAt = new Date();

    await this.saveEntitiesToDb(userId, entities);
    this.entitiesCache.set(userId, { data: entities, loadedAt: new Date() });
  }

  /**
   * Sync people from database
   */
  async syncPeople(userId: string, people: PersonEntity[]): Promise<void> {
    const entities = await this.getEntities(userId);
    entities.people = people;

    // Mark labels that are for people
    const personLabels = new Set(people.filter((p) => p.todoistLabel).map((p) => p.todoistLabel!.toLowerCase()));
    for (const label of entities.labels) {
      label.isPerson = personLabels.has(label.name.toLowerCase());
    }

    await this.saveEntitiesToDb(userId, entities);
    this.entitiesCache.set(userId, { data: entities, loadedAt: new Date() });
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Clear all caches for a user
   */
  clearUserCache(userId: string): void {
    this.sessionCache.delete(userId);
    this.preferencesCache.delete(userId);
    this.patternsCache.delete(userId);
    this.entitiesCache.delete(userId);
  }

  /**
   * Clear expired sessions
   */
  cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [userId, session] of this.sessionCache) {
      if (now - session.lastActivityAt.getTime() > this.sessionTTL) {
        this.sessionCache.delete(userId);
      }
    }
  }

  // ==========================================================================
  // Database Operations
  // ==========================================================================

  /**
   * Load preferences from database
   */
  private async loadPreferencesFromDb(userId: string): Promise<UserPreferences> {
    try {
      // Dynamic import to avoid circular dependencies
      const { userPreferences } = await import('@gtd/database/schema');
      const { eq } = await import('drizzle-orm');

      const result = await this.db.query.userPreferences.findFirst({
        where: eq(userPreferences.userId, userId),
      });

      if (!result) {
        return { ...DEFAULT_PREFERENCES };
      }

      return {
        defaultProject: result.defaultProject ?? undefined,
        workingHours: result.workingHours ?? undefined,
        labelMappings: {
          ...DEFAULT_PREFERENCES.labelMappings,
          ...result.labelMappings,
        },
        projectMappings: result.projectMappings,
        priorityKeywords: {
          ...DEFAULT_PREFERENCES.priorityKeywords,
          ...result.priorityKeywords,
        },
        defaultContext: result.defaultContext ?? undefined,
        dateAliases: {
          ...DEFAULT_PREFERENCES.dateAliases,
          ...result.dateAliases,
        },
      };
    } catch (error) {
      console.error('[ContextManager] Error loading preferences:', error);
      return { ...DEFAULT_PREFERENCES };
    }
  }

  /**
   * Save preferences to database
   */
  private async savePreferencesToDb(userId: string, prefs: UserPreferences): Promise<void> {
    try {
      const { userPreferences } = await import('@gtd/database/schema');

      await this.db
        .insert(userPreferences)
        .values({
          userId,
          defaultProject: prefs.defaultProject ?? null,
          workingHours: prefs.workingHours ?? null,
          labelMappings: prefs.labelMappings,
          projectMappings: prefs.projectMappings,
          priorityKeywords: prefs.priorityKeywords,
          defaultContext: prefs.defaultContext ?? null,
          dateAliases: prefs.dateAliases,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: {
            defaultProject: prefs.defaultProject ?? null,
            workingHours: prefs.workingHours ?? null,
            labelMappings: prefs.labelMappings,
            projectMappings: prefs.projectMappings,
            priorityKeywords: prefs.priorityKeywords,
            defaultContext: prefs.defaultContext ?? null,
            dateAliases: prefs.dateAliases,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      console.error('[ContextManager] Error saving preferences:', error);
    }
  }

  /**
   * Load patterns from database
   */
  private async loadPatternsFromDb(userId: string): Promise<LearnedPatterns> {
    try {
      const { userPatterns } = await import('@gtd/database/schema');
      const { eq } = await import('drizzle-orm');

      const result = await this.db.query.userPatterns.findFirst({
        where: eq(userPatterns.userId, userId),
      });

      if (!result) {
        return { ...DEFAULT_PATTERNS };
      }

      return {
        typicalTaskTimes: result.typicalTaskTimes,
        commonLabels: result.commonLabels,
        frequentProjects: result.frequentProjects,
        wordAssociations: result.wordAssociations.map((a) => ({
          ...a,
          lastUsed: new Date(a.lastUsed),
        })),
        taskTypePatterns: result.taskTypePatterns,
        personPatterns: result.personPatterns,
      };
    } catch (error) {
      console.error('[ContextManager] Error loading patterns:', error);
      return { ...DEFAULT_PATTERNS };
    }
  }

  /**
   * Save patterns to database
   */
  private async savePatternsToDb(userId: string, patterns: LearnedPatterns): Promise<void> {
    try {
      const { userPatterns } = await import('@gtd/database/schema');

      // Convert dates to ISO strings for storage
      const wordAssociationsForDb = patterns.wordAssociations.map((a) => ({
        ...a,
        lastUsed: a.lastUsed.toISOString(),
      }));

      await this.db
        .insert(userPatterns)
        .values({
          userId,
          typicalTaskTimes: patterns.typicalTaskTimes,
          commonLabels: patterns.commonLabels,
          frequentProjects: patterns.frequentProjects,
          wordAssociations: wordAssociationsForDb,
          taskTypePatterns: patterns.taskTypePatterns,
          personPatterns: patterns.personPatterns,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPatterns.userId,
          set: {
            typicalTaskTimes: patterns.typicalTaskTimes,
            commonLabels: patterns.commonLabels,
            frequentProjects: patterns.frequentProjects,
            wordAssociations: wordAssociationsForDb,
            taskTypePatterns: patterns.taskTypePatterns,
            personPatterns: patterns.personPatterns,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      console.error('[ContextManager] Error saving patterns:', error);
    }
  }

  /**
   * Load entities from database
   */
  private async loadEntitiesFromDb(userId: string): Promise<UserEntities> {
    try {
      const { todoistEntityCache, people } = await import('@gtd/database/schema');
      const { eq } = await import('drizzle-orm');

      // Load cached Todoist entities
      const cached = await this.db.query.todoistEntityCache.findFirst({
        where: eq(todoistEntityCache.userId, userId),
      });

      // Load people from database
      const peopleResult = await this.db.query.people.findMany({
        where: eq(people.userId, userId),
      });

      const personEntities: PersonEntity[] = peopleResult.map((p) => ({
        id: p.id,
        name: p.name,
        aliases: p.aliases ?? [],
        frequency: p.frequency ?? undefined,
        dayOfWeek: p.dayOfWeek ?? undefined,
        todoistLabel: p.todoistLabel ?? undefined,
        active: p.active ?? true,
      }));

      // Return entities
      if (cached && cached.expiresAt > new Date()) {
        return {
          people: personEntities,
          projects: cached.projects,
          labels: cached.labels,
          recurringPatterns: [],
          lastSyncedAt: cached.updatedAt,
        };
      }

      // Cache expired or missing - return with empty projects/labels
      // (will be synced from Todoist)
      return {
        people: personEntities,
        projects: [],
        labels: [],
        recurringPatterns: [],
        lastSyncedAt: new Date(0),
      };
    } catch (error) {
      console.error('[ContextManager] Error loading entities:', error);
      return createEmptyEntities();
    }
  }

  /**
   * Save entities to database
   */
  private async saveEntitiesToDb(userId: string, entities: UserEntities): Promise<void> {
    try {
      const { todoistEntityCache } = await import('@gtd/database/schema');

      // Save Todoist entity cache
      // Expires in 5 minutes
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await this.db
        .insert(todoistEntityCache)
        .values({
          userId,
          projects: entities.projects,
          labels: entities.labels,
          updatedAt: new Date(),
          expiresAt,
        })
        .onConflictDoUpdate({
          target: todoistEntityCache.userId,
          set: {
            projects: entities.projects,
            labels: entities.labels,
            updatedAt: new Date(),
            expiresAt,
          },
        });

      // Note: People are managed separately via the people table
    } catch (error) {
      console.error('[ContextManager] Error saving entities:', error);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a context manager instance
 */
export function createContextManager(config: ContextManagerConfig): ContextManager {
  return new ContextManager(config);
}
