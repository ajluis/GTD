// Core Gemini client
export { GeminiClient, createGeminiClient, type GeminiClientConfig } from './gemini-client.js';

// Legacy classifier (kept for backwards compatibility)
export { GTDClassifier, createClassifier } from './classifier.js';
export { buildClassificationPrompt, CLASSIFIER_SYSTEM_PROMPT, type ConversationMessage } from './prompts/classify-task.js';

// Fuzzy matching utilities
export {
  levenshteinDistance,
  getMaxDistance,
  findFuzzyMatches,
  findBestFuzzyMatch,
  formatDidYouMean,
  extractPotentialNames,
  type FuzzyMatchResult,
} from './fuzzy-match.js';

// === NEW HYBRID ARCHITECTURE ===

// Fast classifier
export { FastClassifier, createFastClassifier, type FastClassifyOptions } from './classifier/fast.js';
export { FAST_CLASSIFY_SYSTEM, buildFastClassifyPrompt, INTENT_TYPES } from './classifier/prompts.js';

// Tools
export * from './tools/index.js';

// Agent
export { runAgentLoop, createAgentRunner, type AgentLoopOptions } from './agent/loop.js';
export { ConversationContextManager, createContextManager, cleanupExpiredContexts } from './agent/context.js';
export { buildAgentSystemPrompt, buildToolResultsPrompt } from './agent/prompts.js';
