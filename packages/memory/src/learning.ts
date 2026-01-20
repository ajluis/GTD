/**
 * Learning Module
 *
 * Handles learning from user interactions and corrections.
 * Updates patterns in the context system based on observed behavior.
 */

import type { DbClient } from '@gtd/database';
import { userPatterns } from '@gtd/database/schema';
import { eq } from 'drizzle-orm';
import type {
  InteractionForLearning,
  LearningResult,
  LearnedAssociation,
  CorrectionLearning,
} from './types.js';

// ============================================================================
// Learning Engine
// ============================================================================

/**
 * Learning Engine Configuration
 */
export interface LearningEngineConfig {
  db: DbClient;
  /** Minimum occurrences before a pattern is considered learned */
  minOccurrences?: number;
  /** Initial confidence for new associations */
  initialConfidence?: number;
  /** Confidence boost per occurrence */
  confidenceBoostPerOccurrence?: number;
  /** Maximum confidence */
  maxConfidence?: number;
}

/**
 * Learning Engine
 *
 * Extracts patterns from user interactions and corrections
 * to improve future inference.
 */
export class LearningEngine {
  private db: DbClient;
  private minOccurrences: number;
  private initialConfidence: number;
  private confidenceBoostPerOccurrence: number;
  private maxConfidence: number;

  constructor(config: LearningEngineConfig) {
    this.db = config.db;
    this.minOccurrences = config.minOccurrences ?? 2;
    this.initialConfidence = config.initialConfidence ?? 0.5;
    this.confidenceBoostPerOccurrence = config.confidenceBoostPerOccurrence ?? 0.1;
    this.maxConfidence = config.maxConfidence ?? 0.95;
  }

  /**
   * Learn from an interaction
   *
   * This is the main entry point for learning from user behavior.
   */
  async learnFromInteraction(
    userId: string,
    interaction: InteractionForLearning
  ): Promise<LearningResult> {
    const newAssociations: LearnedAssociation[] = [];
    const updatedAssociations: LearnedAssociation[] = [];
    const summaryParts: string[] = [];

    // Learn from corrections
    if (interaction.correction) {
      const correctionResult = await this.learnFromCorrection(
        userId,
        {
          taskContent: interaction.message,
          original: interaction.inference ?? {},
          corrected: interaction.correction,
          keywords: this.extractKeywords(interaction.message),
          timestamp: interaction.timestamp,
        }
      );

      newAssociations.push(...correctionResult.newAssociations);
      updatedAssociations.push(...correctionResult.updatedAssociations);

      if (correctionResult.newAssociations.length > 0) {
        summaryParts.push(
          `Learned ${correctionResult.newAssociations.length} new pattern(s) from correction`
        );
      }
    }

    // Learn from successful outcomes
    if (interaction.outcome && !interaction.correction) {
      const usageResult = await this.learnFromUsage(userId, interaction);

      if (usageResult.updatedAssociations.length > 0) {
        updatedAssociations.push(...usageResult.updatedAssociations);
        summaryParts.push(
          `Reinforced ${usageResult.updatedAssociations.length} pattern(s) from usage`
        );
      }
    }

    return {
      newAssociations,
      updatedAssociations,
      summary: summaryParts.join('; ') || 'No significant patterns detected',
    };
  }

  /**
   * Learn from a user correction
   */
  async learnFromCorrection(
    userId: string,
    correction: CorrectionLearning
  ): Promise<LearningResult> {
    const newAssociations: LearnedAssociation[] = [];
    const updatedAssociations: LearnedAssociation[] = [];

    // Load existing patterns
    const existingPatterns = await this.loadUserPatterns(userId);

    // For each keyword, create or update an association
    for (const keyword of correction.keywords) {
      // Skip very short keywords
      if (keyword.length < 3) continue;

      // Check if we already have an association for this keyword
      const existingIndex = existingPatterns.wordAssociations.findIndex(
        (a) => a.trigger.toLowerCase() === keyword.toLowerCase()
      );

      if (existingIndex >= 0) {
        // Update existing association
        const existing = existingPatterns.wordAssociations[existingIndex];

        // Merge targets (corrections override)
        const updatedAssociation: LearnedAssociation = {
          trigger: existing.trigger,
          target: {
            project: correction.corrected.project ?? existing.target.project,
            labels: correction.corrected.labels ?? existing.target.labels,
            priority: correction.corrected.priority ?? existing.target.priority,
            context: correction.corrected.taskType ?? existing.target.context,
          },
          confidence: Math.min(
            existing.confidence + this.confidenceBoostPerOccurrence,
            this.maxConfidence
          ),
          occurrences: existing.occurrences + 1,
          lastUsed: new Date(),
          source: 'correction',
        };

        existingPatterns.wordAssociations[existingIndex] = updatedAssociation;
        updatedAssociations.push(updatedAssociation);
      } else {
        // Create new association
        const newAssociation: LearnedAssociation = {
          trigger: keyword.toLowerCase(),
          target: {
            project: correction.corrected.project,
            labels: correction.corrected.labels,
            priority: correction.corrected.priority,
            context: correction.corrected.taskType,
          },
          confidence: this.initialConfidence,
          occurrences: 1,
          lastUsed: new Date(),
          source: 'correction',
        };

        existingPatterns.wordAssociations.push(newAssociation);
        newAssociations.push(newAssociation);
      }
    }

    // Save updated patterns
    await this.saveUserPatterns(userId, existingPatterns);

    return {
      newAssociations,
      updatedAssociations,
      summary: `Learned from correction: ${correction.keywords.join(', ')}`,
    };
  }

  /**
   * Learn from successful usage (reinforce patterns)
   */
  async learnFromUsage(
    userId: string,
    interaction: InteractionForLearning
  ): Promise<LearningResult> {
    const updatedAssociations: LearnedAssociation[] = [];

    if (!interaction.outcome) {
      return { newAssociations: [], updatedAssociations: [], summary: '' };
    }

    const keywords = this.extractKeywords(interaction.message);
    const existingPatterns = await this.loadUserPatterns(userId);

    // Reinforce existing associations that match this usage
    for (const keyword of keywords) {
      const existingIndex = existingPatterns.wordAssociations.findIndex(
        (a) => a.trigger.toLowerCase() === keyword.toLowerCase()
      );

      if (existingIndex >= 0) {
        const existing = existingPatterns.wordAssociations[existingIndex];

        // Only reinforce if the outcome matches the learned pattern
        const projectMatches =
          !existing.target.project ||
          existing.target.project === interaction.outcome.project;
        const labelsMatch =
          !existing.target.labels ||
          existing.target.labels.some((l) => interaction.outcome?.labels?.includes(l));

        if (projectMatches && labelsMatch) {
          // Reinforce with smaller boost than corrections
          existing.occurrences++;
          existing.confidence = Math.min(
            existing.confidence + this.confidenceBoostPerOccurrence * 0.5,
            this.maxConfidence
          );
          existing.lastUsed = new Date();

          updatedAssociations.push(existing);
        }
      }
    }

    // Update project frequency
    if (interaction.outcome.project) {
      const projectIndex = existingPatterns.frequentProjects.indexOf(interaction.outcome.project);
      if (projectIndex > 0) {
        // Move to front
        existingPatterns.frequentProjects.splice(projectIndex, 1);
      }
      if (projectIndex !== 0) {
        existingPatterns.frequentProjects.unshift(interaction.outcome.project);
        existingPatterns.frequentProjects = existingPatterns.frequentProjects.slice(0, 10);
      }
    }

    // Update label frequency
    if (interaction.outcome.labels) {
      for (const label of interaction.outcome.labels) {
        if (!existingPatterns.commonLabels.includes(label)) {
          existingPatterns.commonLabels.unshift(label);
          existingPatterns.commonLabels = existingPatterns.commonLabels.slice(0, 20);
        }
      }
    }

    await this.saveUserPatterns(userId, existingPatterns);

    return {
      newAssociations: [],
      updatedAssociations,
      summary: updatedAssociations.length > 0
        ? `Reinforced ${updatedAssociations.length} pattern(s)`
        : '',
    };
  }

  /**
   * Detect and parse corrections from user messages
   */
  detectCorrection(message: string): {
    isCorrection: boolean;
    correctedProject?: string;
    correctedLabels?: string[];
    correctedPriority?: number;
  } {
    const result: {
      isCorrection: boolean;
      correctedProject?: string;
      correctedLabels?: string[];
      correctedPriority?: number;
    } = { isCorrection: false };

    // Patterns for detecting corrections
    const projectCorrectionPatterns = [
      /(?:no,?\s+)?(?:put|move)\s+(?:it|that)\s+(?:in|to)\s+["']?([A-Za-z][A-Za-z\s]+)["']?/i,
      /(?:actually|no),?\s+(?:it should be|make it)\s+(?:in|project)?\s*["']?([A-Za-z][A-Za-z\s]+)["']?/i,
      /wrong project,?\s+(?:it's|should be)\s+["']?([A-Za-z][A-Za-z\s]+)["']?/i,
    ];

    const priorityCorrectionPatterns = [
      /(?:make|set)\s+(?:it|that)\s+(?:priority|p)\s*([1-4])/i,
      /(?:it's|should be)\s+(?:priority|p)\s*([1-4])/i,
      /(?:make|set)\s+(?:it|that)\s+(urgent|high priority)/i,
    ];

    // Check for project corrections
    for (const pattern of projectCorrectionPatterns) {
      const match = message.match(pattern);
      if (match) {
        result.isCorrection = true;
        result.correctedProject = match[1]?.trim();
        break;
      }
    }

    // Check for priority corrections
    for (const pattern of priorityCorrectionPatterns) {
      const match = message.match(pattern);
      if (match) {
        result.isCorrection = true;
        if (match[1]) {
          const priorityStr = match[1].toLowerCase();
          if (priorityStr === 'urgent' || priorityStr === 'high priority') {
            result.correctedPriority = 4;
          } else {
            result.correctedPriority = parseInt(priorityStr, 10);
          }
        }
        break;
      }
    }

    // Check for label corrections
    const labelPattern = /(?:add|set|with)\s+(?:label|tag)s?\s+(@?[A-Za-z][A-Za-z_-]*)/gi;
    const labelMatches = [...message.matchAll(labelPattern)];
    if (labelMatches.length > 0) {
      result.isCorrection = true;
      result.correctedLabels = labelMatches.map((m) => m[1] ?? '').filter((l) => l.length > 0);
    }

    return result;
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  /**
   * Extract meaningful keywords from text
   */
  private extractKeywords(text: string): string[] {
    // Common stop words to exclude
    const stopWords = new Set([
      'a', 'an', 'the', 'to', 'in', 'on', 'at', 'for', 'of', 'with',
      'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might',
      'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'their',
      'this', 'that', 'it', 'and', 'or', 'but', 'if', 'then',
      'add', 'create', 'new', 'make', 'task', 'todo', 'please',
    ]);

    // Extract words
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !stopWords.has(word));

    // Also extract multi-word phrases
    const phrases: string[] = [];
    const wordArray = text.toLowerCase().split(/\s+/);

    for (let i = 0; i < wordArray.length - 1; i++) {
      const twoWord = `${wordArray[i]} ${wordArray[i + 1]}`;
      if (!stopWords.has(wordArray[i] ?? '') && !stopWords.has(wordArray[i + 1] ?? '')) {
        phrases.push(twoWord);
      }
    }

    return [...new Set([...words, ...phrases])];
  }

  /**
   * Load user patterns from database
   */
  private async loadUserPatterns(userId: string): Promise<{
    wordAssociations: LearnedAssociation[];
    frequentProjects: string[];
    commonLabels: string[];
  }> {
    try {
      const result = await this.db.query.userPatterns.findFirst({
        where: eq(userPatterns.userId, userId),
      });

      if (!result) {
        return {
          wordAssociations: [],
          frequentProjects: [],
          commonLabels: [],
        };
      }

      return {
        wordAssociations: result.wordAssociations.map((a) => ({
          trigger: a.trigger,
          target: a.target,
          confidence: a.confidence,
          occurrences: a.occurrences,
          lastUsed: new Date(a.lastUsed),
          source: 'correction' as const,
        })),
        frequentProjects: result.frequentProjects,
        commonLabels: result.commonLabels,
      };
    } catch (error) {
      console.error('[LearningEngine] Failed to load patterns:', error);
      return {
        wordAssociations: [],
        frequentProjects: [],
        commonLabels: [],
      };
    }
  }

  /**
   * Save user patterns to database
   */
  private async saveUserPatterns(
    userId: string,
    patterns: {
      wordAssociations: LearnedAssociation[];
      frequentProjects: string[];
      commonLabels: string[];
    }
  ): Promise<void> {
    try {
      // Convert for storage
      const wordAssociationsForDb = patterns.wordAssociations.map((a) => ({
        trigger: a.trigger,
        target: a.target,
        confidence: a.confidence,
        occurrences: a.occurrences,
        lastUsed: a.lastUsed.toISOString(),
      }));

      await this.db
        .insert(userPatterns)
        .values({
          userId,
          wordAssociations: wordAssociationsForDb,
          frequentProjects: patterns.frequentProjects,
          commonLabels: patterns.commonLabels,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userPatterns.userId,
          set: {
            wordAssociations: wordAssociationsForDb,
            frequentProjects: patterns.frequentProjects,
            commonLabels: patterns.commonLabels,
            updatedAt: new Date(),
          },
        });
    } catch (error) {
      console.error('[LearningEngine] Failed to save patterns:', error);
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a learning engine instance
 */
export function createLearningEngine(config: LearningEngineConfig): LearningEngine {
  return new LearningEngine(config);
}
