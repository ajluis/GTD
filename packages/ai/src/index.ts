export { GeminiClient, createGeminiClient, type GeminiClientConfig } from './gemini-client.js';
export { GTDClassifier, createClassifier } from './classifier.js';
export { buildClassificationPrompt, CLASSIFIER_SYSTEM_PROMPT, type ConversationMessage } from './prompts/classify-task.js';
export {
  levenshteinDistance,
  getMaxDistance,
  findFuzzyMatches,
  findBestFuzzyMatch,
  formatDidYouMean,
  extractPotentialNames,
  type FuzzyMatchResult,
} from './fuzzy-match.js';
