/**
 * Unified Agent
 *
 * The fully agentic architecture that brings together:
 * - MCP tools for Todoist operations (source of truth)
 * - Rich context for intelligent inference
 * - Memory for long-term learning
 * - Inference engine for smart defaults
 *
 * This is the "pure intelligence layer" described in the architecture:
 * SMS in → Agent reasons with context → MCP tools to Todoist → Response out
 */

import type { DbClient } from '@gtd/database';
import type { Tool, ToolContext, AgentResult, ConversationContext } from './tools/types.js';
import { runAgentLoop } from './agent/loop.js';
import { buildAgentSystemPrompt } from './agent/prompts.js';
import { allTools } from './tools/index.js';
import { createMCPTools, createUnifiedToolSet, type MCPClientLike } from './mcp-integration.js';
import { createInferenceEngine, type InferredTask, type InferenceContext } from './inference/index.js';
import { createGeminiClient } from './gemini-client.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Unified agent configuration
 */
export interface UnifiedAgentConfig {
  /** Database client */
  db: DbClient;
  /** User ID */
  userId: string;
  /** User's timezone */
  timezone: string;
  /** Todoist MCP client (optional, for MCP-based operations) */
  todoistMCP?: MCPClientLike;
  /** Enable inference engine */
  enableInference?: boolean;
  /** Enable memory storage */
  enableMemory?: boolean;
  /** Enable learning from corrections */
  enableLearning?: boolean;
  /** Maximum agent iterations */
  maxIterations?: number;
}

/**
 * Unified agent result
 */
export interface UnifiedAgentResult extends AgentResult {
  /** Inference that was applied */
  inference?: InferredTask;
  /** Memory that was stored */
  memoryStored?: boolean;
  /** Learning that occurred */
  learningApplied?: boolean;
}

/**
 * Context loaded for the agent
 */
interface LoadedContext {
  userContext: UserContextLike;
  conversationContext: ConversationContext;
  relevantMemories: MemoryLike[];
}

/**
 * Simplified user context interface
 */
interface UserContextLike {
  userId: string;
  preferences: {
    defaultProject?: string;
    labelMappings: Record<string, string[]>;
    projectMappings: Record<string, string>;
    priorityKeywords: { high: string[]; medium: string[]; low: string[] };
  };
  patterns: {
    frequentProjects: string[];
    wordAssociations: Array<{
      trigger: string;
      target: { project?: string; labels?: string[]; priority?: number };
      confidence: number;
    }>;
  };
  session: {
    recentProjects: string[];
    recentTasks: Array<{ title: string; project?: string }>;
  };
  entities: {
    people: Array<{ id: string; name: string; aliases: string[]; todoistLabel?: string }>;
    projects: Array<{ id: string; name: string; hierarchyName: string }>;
    labels: Array<{ name: string; isContext: boolean }>;
  };
}

/**
 * Simplified memory interface
 */
interface MemoryLike {
  content: string;
  type: string;
  relevanceScore: number;
}

// ============================================================================
// Unified Agent
// ============================================================================

/**
 * Unified Agent
 *
 * Orchestrates all components of the GTD agent system.
 */
export class UnifiedAgent {
  private config: UnifiedAgentConfig;
  private geminiClient = createGeminiClient();

  constructor(config: UnifiedAgentConfig) {
    this.config = {
      enableInference: true,
      enableMemory: true,
      enableLearning: true,
      maxIterations: 5,
      ...config,
    };
  }

  /**
   * Handle a user message
   *
   * This is the main entry point for processing user input.
   * It orchestrates context loading, inference, tool execution, and learning.
   */
  async handleMessage(message: string): Promise<UnifiedAgentResult> {
    const { db, userId, timezone, todoistMCP, maxIterations } = this.config;

    // 1. Load context
    const loadedContext = await this.loadContext(message);

    // 2. Build tools (MCP + internal)
    const tools = this.buildToolSet();

    // 3. Apply inference (if enabled)
    let inference: InferredTask | undefined;
    if (this.config.enableInference) {
      inference = await this.runInference(message, loadedContext.userContext);
    }

    // 4. Build system prompt with context
    const systemPrompt = this.buildEnhancedPrompt(
      tools,
      loadedContext,
      inference
    );

    // 5. Create tool context
    const toolContext: ToolContext = {
      userId,
      db,
      todoistClient: null, // We use MCP instead
      timezone,
      conversationContext: loadedContext.conversationContext,
    };

    // 6. Run agent loop
    const result = await runAgentLoop({
      message,
      tools,
      context: toolContext,
      maxIterations,
    });

    // 7. Post-processing (memory, learning)
    const enhancedResult = await this.postProcess(
      message,
      result,
      inference,
      loadedContext
    );

    return enhancedResult;
  }

  /**
   * Load context for the agent
   */
  private async loadContext(message: string): Promise<LoadedContext> {
    // Try to load context from the context manager
    // If not available, use defaults
    let userContext: UserContextLike;
    let relevantMemories: MemoryLike[] = [];

    try {
      // Dynamic import to avoid circular dependencies
      const { createContextManager } = await import('@gtd/context');
      const contextManager = createContextManager({ db: this.config.db });
      const ctx = await contextManager.getContext(this.config.userId);

      userContext = {
        userId: ctx.userId,
        preferences: ctx.preferences,
        patterns: {
          frequentProjects: ctx.patterns.frequentProjects,
          wordAssociations: ctx.patterns.wordAssociations.map((a: { trigger: string; target: { project?: string; labels?: string[]; priority?: number }; confidence: number }) => ({
            trigger: a.trigger,
            target: a.target,
            confidence: a.confidence,
          })),
        },
        session: {
          recentProjects: ctx.session.recentProjects,
          recentTasks: ctx.session.recentTasks.map((t: { title: string; project?: string }) => ({
            title: t.title,
            project: t.project,
          })),
        },
        entities: {
          people: ctx.entities.people.map((p: { id: string; name: string; aliases: string[]; todoistLabel?: string }) => ({
            id: p.id,
            name: p.name,
            aliases: p.aliases,
            todoistLabel: p.todoistLabel,
          })),
          projects: ctx.entities.projects.map((p: { id: string; name: string; hierarchyName: string }) => ({
            id: p.id,
            name: p.name,
            hierarchyName: p.hierarchyName,
          })),
          labels: ctx.entities.labels.map((l: { name: string; isContext: boolean }) => ({
            name: l.name,
            isContext: l.isContext,
          })),
        },
      };
    } catch (error) {
      console.log('[UnifiedAgent] Using default context:', error);
      userContext = this.getDefaultUserContext();
    }

    // Load relevant memories
    if (this.config.enableMemory) {
      try {
        const { createMemoryManager } = await import('@gtd/memory');
        const memoryManager = createMemoryManager({ db: this.config.db });
        const memories = await memoryManager.getRelevantMemories(
          this.config.userId,
          message
        );
        relevantMemories = memories.map((m: { content: string; type: string; relevanceScore: number }) => ({
          content: m.content,
          type: m.type,
          relevanceScore: m.relevanceScore,
        }));
      } catch (error) {
        console.log('[UnifiedAgent] Could not load memories:', error);
      }
    }

    // Build conversation context
    const conversationContext: ConversationContext = {
      userId: this.config.userId,
      lastTasks: userContext.session.recentTasks.map((t, i) => ({
        id: `recent-${i}`,
        title: t.title,
      })),
      lastPeople: userContext.entities.people.slice(0, 5).map((p) => ({
        id: p.id,
        name: p.name,
      })),
      undoStack: [],
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    };

    return { userContext, conversationContext, relevantMemories };
  }

  /**
   * Build the unified tool set
   */
  private buildToolSet(): Tool[] {
    const { todoistMCP } = this.config;

    if (todoistMCP) {
      // Use MCP tools for Todoist + internal tools for DB
      const toolSet = createUnifiedToolSet({
        internal: allTools,
        mcpClient: todoistMCP,
      });
      return toolSet.all;
    }

    // Fall back to internal tools only
    return allTools;
  }

  /**
   * Run inference on the message
   */
  private async runInference(
    message: string,
    userContext: UserContextLike
  ): Promise<InferredTask | undefined> {
    try {
      const inferenceEngine = createInferenceEngine(this.geminiClient);

      const inferenceContext: InferenceContext = {
        preferences: userContext.preferences,
        patterns: userContext.patterns,
        session: userContext.session,
        entities: userContext.entities,
        currentTime: new Date(),
        timezone: this.config.timezone,
      };

      return await inferenceEngine.inferTaskDetails(
        message,
        inferenceContext,
        { useLLM: false } // Use rule-based only for speed
      );
    } catch (error) {
      console.error('[UnifiedAgent] Inference failed:', error);
      return undefined;
    }
  }

  /**
   * Build enhanced system prompt with context
   */
  private buildEnhancedPrompt(
    tools: Tool[],
    loadedContext: LoadedContext,
    inference?: InferredTask
  ): string {
    // Start with base prompt
    let prompt = buildAgentSystemPrompt(
      tools,
      this.config.timezone,
      new Date(),
      loadedContext.conversationContext
    );

    // Add context section
    const contextSection = this.formatContextSection(loadedContext);
    if (contextSection) {
      prompt += `\n\n${contextSection}`;
    }

    // Add inference hints
    if (inference && inference.overallConfidence > 0.5) {
      prompt += `\n\n${this.formatInferenceHints(inference)}`;
    }

    // Add relevant memories
    if (loadedContext.relevantMemories.length > 0) {
      prompt += `\n\n${this.formatMemoriesSection(loadedContext.relevantMemories)}`;
    }

    return prompt;
  }

  /**
   * Format context section for prompt
   */
  private formatContextSection(context: LoadedContext): string {
    const lines: string[] = [];

    const { userContext } = context;

    // Frequent projects
    if (userContext.patterns.frequentProjects.length > 0) {
      lines.push(
        `Frequently used projects: ${userContext.patterns.frequentProjects.slice(0, 3).join(', ')}`
      );
    }

    // Recent activity
    if (userContext.session.recentTasks.length > 0) {
      lines.push(`Recent tasks: ${userContext.session.recentTasks.slice(0, 3).map((t) => t.title).join(', ')}`);
    }

    // Known people
    if (userContext.entities.people.length > 0) {
      lines.push(
        `Known people: ${userContext.entities.people.slice(0, 5).map((p) => p.name).join(', ')}`
      );
    }

    if (lines.length === 0) return '';

    return `
═══════════════════════════════════════════════════════════════
USER CONTEXT
═══════════════════════════════════════════════════════════════
${lines.join('\n')}
`;
  }

  /**
   * Format inference hints for prompt
   */
  private formatInferenceHints(inference: InferredTask): string {
    const hints: string[] = [];

    if (inference.project?.confidence && inference.project.confidence > 0.6) {
      hints.push(`Suggested project: ${inference.project.value} (${inference.project.reason})`);
    }

    if (inference.labels?.value.length && inference.labels.confidence > 0.6) {
      hints.push(`Suggested labels: ${inference.labels.value.join(', ')} (${inference.labels.reason})`);
    }

    if (inference.dueDate?.confidence && inference.dueDate.confidence > 0.7) {
      hints.push(`Detected due date: ${inference.dueDate.value}`);
    }

    if (inference.priority?.confidence && inference.priority.confidence > 0.6) {
      hints.push(`Suggested priority: ${inference.priority.value}`);
    }

    if (hints.length === 0) return '';

    return `
═══════════════════════════════════════════════════════════════
INFERENCE HINTS (use if appropriate)
═══════════════════════════════════════════════════════════════
${hints.join('\n')}
`;
  }

  /**
   * Format memories section for prompt
   */
  private formatMemoriesSection(memories: MemoryLike[]): string {
    if (memories.length === 0) return '';

    const memoryLines = memories.map((m) => `- ${m.content.slice(0, 100)}...`).join('\n');

    return `
═══════════════════════════════════════════════════════════════
RELEVANT MEMORIES
═══════════════════════════════════════════════════════════════
${memoryLines}
`;
  }

  /**
   * Post-process agent result (memory, learning)
   */
  private async postProcess(
    message: string,
    result: AgentResult,
    inference: InferredTask | undefined,
    loadedContext: LoadedContext
  ): Promise<UnifiedAgentResult> {
    const enhancedResult: UnifiedAgentResult = {
      ...result,
      inference,
      memoryStored: false,
      learningApplied: false,
    };

    // Update context with results
    try {
      const { createContextManager } = await import('@gtd/context');
      const contextManager = createContextManager({ db: this.config.db });

      await contextManager.updateFromInteraction(this.config.userId, {
        type: result.toolCalls.some((tc) => tc.tool.includes('create'))
          ? 'task_created'
          : 'task_updated',
        message,
        toolCalls: result.toolCalls.map((tc) => ({
          tool: tc.tool,
          params: tc.params,
          success: tc.result.success,
        })),
        response: result.response,
        entities: {
          tasks: result.updatedContext.lastTasks?.map((t) => ({
            id: t.id,
            title: t.title,
            createdAt: new Date(),
          })),
          people: result.updatedContext.lastPeople,
        },
        timestamp: new Date(),
      });
    } catch (error) {
      console.log('[UnifiedAgent] Could not update context:', error);
    }

    // Store memory if significant
    if (this.config.enableMemory) {
      try {
        const { createMemoryManager } = await import('@gtd/memory');
        const memoryManager = createMemoryManager({ db: this.config.db });

        const stored = await memoryManager.maybeStore(this.config.userId, {
          message,
          response: result.response,
          toolCalls: result.toolCalls.map((tc) => ({
            tool: tc.tool,
            success: tc.result.success,
          })),
        });

        enhancedResult.memoryStored = stored !== null;
      } catch (error) {
        console.log('[UnifiedAgent] Could not store memory:', error);
      }
    }

    // Apply learning if enabled
    if (this.config.enableLearning) {
      try {
        const { createLearningEngine } = await import('@gtd/memory');
        const learningEngine = createLearningEngine({ db: this.config.db });

        // Check for corrections
        const correction = learningEngine.detectCorrection(message);

        if (correction.isCorrection) {
          await learningEngine.learnFromInteraction(this.config.userId, {
            message,
            inference: inference
              ? {
                  project: inference.project?.value,
                  labels: inference.labels?.value,
                  priority: inference.priority?.value,
                }
              : undefined,
            correction: {
              project: correction.correctedProject,
              labels: correction.correctedLabels,
              priority: correction.correctedPriority,
            },
            timestamp: new Date(),
          });

          enhancedResult.learningApplied = true;
        } else if (result.toolCalls.length > 0) {
          // Learn from successful usage
          const taskCreated = result.toolCalls.find(
            (tc) => tc.tool.includes('create') && tc.result.success
          );

          if (taskCreated) {
            await learningEngine.learnFromInteraction(this.config.userId, {
              message,
              outcome: {
                project: taskCreated.params['project'] as string | undefined,
                labels: taskCreated.params['labels'] as string[] | undefined,
                taskId: (taskCreated.result.data as { id?: string })?.id,
              },
              timestamp: new Date(),
            });
          }
        }
      } catch (error) {
        console.log('[UnifiedAgent] Could not apply learning:', error);
      }
    }

    return enhancedResult;
  }

  /**
   * Get default user context
   */
  private getDefaultUserContext(): UserContextLike {
    return {
      userId: this.config.userId,
      preferences: {
        labelMappings: {},
        projectMappings: {},
        priorityKeywords: { high: ['urgent', 'asap'], medium: ['soon'], low: ['someday'] },
      },
      patterns: {
        frequentProjects: [],
        wordAssociations: [],
      },
      session: {
        recentProjects: [],
        recentTasks: [],
      },
      entities: {
        people: [],
        projects: [],
        labels: [],
      },
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a unified agent instance
 */
export function createUnifiedAgent(config: UnifiedAgentConfig): UnifiedAgent {
  return new UnifiedAgent(config);
}

/**
 * Quick handler for simple message processing
 */
export async function handleGTDMessage(
  db: DbClient,
  userId: string,
  message: string,
  options: {
    timezone?: string;
    todoistMCP?: MCPClientLike;
  } = {}
): Promise<UnifiedAgentResult> {
  const agent = createUnifiedAgent({
    db,
    userId,
    timezone: options.timezone ?? 'America/New_York',
    todoistMCP: options.todoistMCP,
  });

  return agent.handleMessage(message);
}
