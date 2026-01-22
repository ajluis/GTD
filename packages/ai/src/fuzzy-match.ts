/**
 * Fuzzy Matching Utilities
 *
 * Implements Levenshtein distance-based fuzzy matching for:
 * - Person name typo correction
 * - Alias suggestions
 * - "Did you mean?" confirmations
 */

/**
 * Person entity for fuzzy matching
 */
export interface PersonForFuzzyMatch {
  id: string;
  name: string;
  aliases: string[];
}

/**
 * Result of a fuzzy person match
 */
export interface FuzzyMatchResult {
  person: PersonForFuzzyMatch;
  matchedOn: 'name' | 'alias';
  distance: number;
  confidence: number;
}

/**
 * Calculate Levenshtein distance between two strings
 *
 * This measures the minimum number of single-character edits
 * (insertions, deletions, or substitutions) needed to change
 * one string into another.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Number of edits required
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  // Base cases
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Create matrix of distances
  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= aLen; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= bLen; j++) {
    matrix[0]![j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= aLen; i++) {
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,      // deletion
        matrix[i]![j - 1]! + 1,      // insertion
        matrix[i - 1]![j - 1]! + cost // substitution
      );
    }
  }

  return matrix[aLen]![bLen]!;
}

/**
 * Calculate maximum allowed distance based on string length
 *
 * Shorter strings need stricter matching to avoid false positives:
 * - 1-4 chars: allow 1 edit (e.g., "Sara" -> "Sarah")
 * - 5-8 chars: allow 2 edits (e.g., "Michael" -> "Micheal")
 * - 9+ chars: allow 3 edits
 */
export function getMaxDistance(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
}

/**
 * Find fuzzy matches for a name against a list of people
 *
 * @param input - The potentially misspelled name
 * @param people - List of people to match against
 * @param threshold - Optional custom max distance (default: auto based on length)
 * @returns Array of matches sorted by distance (best first)
 */
export function findFuzzyMatches(
  input: string,
  people: PersonForFuzzyMatch[],
  threshold?: number
): FuzzyMatchResult[] {
  const inputLower = input.toLowerCase().trim();
  const maxDistance = threshold ?? getMaxDistance(inputLower.length);
  const matches: FuzzyMatchResult[] = [];

  for (const person of people) {
    // Check against main name
    const nameLower = person.name.toLowerCase();
    const nameDistance = levenshteinDistance(inputLower, nameLower);

    if (nameDistance <= maxDistance) {
      matches.push({
        person,
        matchedOn: 'name',
        distance: nameDistance,
        confidence: 1 - nameDistance / Math.max(inputLower.length, nameLower.length),
      });
      continue; // Found a match, no need to check aliases
    }

    // Check against first name only
    const firstName = nameLower.split(' ')[0]!;
    const firstNameDistance = levenshteinDistance(inputLower, firstName);

    if (firstNameDistance <= maxDistance) {
      matches.push({
        person,
        matchedOn: 'name',
        distance: firstNameDistance,
        confidence: 1 - firstNameDistance / Math.max(inputLower.length, firstName.length),
      });
      continue;
    }

    // Check against aliases
    for (const alias of person.aliases) {
      const aliasLower = alias.toLowerCase();
      const aliasDistance = levenshteinDistance(inputLower, aliasLower);

      if (aliasDistance <= maxDistance) {
        matches.push({
          person,
          matchedOn: 'alias',
          distance: aliasDistance,
          confidence: 1 - aliasDistance / Math.max(inputLower.length, aliasLower.length),
        });
        break; // Found alias match, move to next person
      }
    }
  }

  // Sort by distance (best matches first)
  return matches.sort((a, b) => a.distance - b.distance);
}

/**
 * Find the best fuzzy match, if one exists above confidence threshold
 *
 * @param input - The potentially misspelled name
 * @param people - List of people to match against
 * @param minConfidence - Minimum confidence to return a match (default: 0.6)
 * @returns Best match or null
 */
export function findBestFuzzyMatch(
  input: string,
  people: PersonForFuzzyMatch[],
  minConfidence = 0.6
): FuzzyMatchResult | null {
  const matches = findFuzzyMatches(input, people);

  if (matches.length === 0) {
    return null;
  }

  const best = matches[0]!;
  return best.confidence >= minConfidence ? best : null;
}

/**
 * Format "Did you mean?" suggestion message
 */
export function formatDidYouMean(match: FuzzyMatchResult): string {
  return `Did you mean "${match.person.name}"?\n\nReply 'yes' to confirm, or 'no' to skip.`;
}

/**
 * Extract potential person names from text
 *
 * Looks for capitalized words or words after prepositions like "with", "for"
 * that might be person names.
 *
 * @param text - Input text to scan
 * @returns Array of potential name strings
 */
export function extractPotentialNames(text: string): string[] {
  const names: string[] = [];

  // Pattern: "with [Name]", "for [Name]", "from [Name]"
  const prepPatterns = [
    /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /\bfrom\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /\bto\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
    /\@([A-Za-z]+)/g, // @mentions
  ];

  for (const pattern of prepPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) {
        names.push(match[1]);
      }
    }
  }

  return [...new Set(names)]; // Dedupe
}
