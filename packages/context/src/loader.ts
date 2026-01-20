/**
 * Context Loader
 *
 * Formats user context into prompts for the LLM.
 * This is the bridge between the context system and the agent.
 *
 * The loader creates a structured context section that helps the LLM:
 * 1. Know the user's preferences (default projects, label rules)
 * 2. Reference recent tasks (for "that", "the first one")
 * 3. Know about people (for agenda items)
 * 4. Apply learned patterns (word associations)
 */

import type {
  UserContext,
  UserPreferences,
  LearnedPatterns,
  SessionContext,
  UserEntities,
  PersonEntity,
  ProjectEntity,
} from './types.js';

// ============================================================================
// Context Formatting
// ============================================================================

/**
 * Format user context for inclusion in system prompt
 */
export function formatContextForPrompt(context: UserContext): string {
  const sections: string[] = [];

  // Format preferences
  const prefsSection = formatPreferences(context.preferences);
  if (prefsSection) {
    sections.push(prefsSection);
  }

  // Format learned patterns
  const patternsSection = formatPatterns(context.patterns);
  if (patternsSection) {
    sections.push(patternsSection);
  }

  // Format session context
  const sessionSection = formatSession(context.session);
  if (sessionSection) {
    sections.push(sessionSection);
  }

  // Format entities
  const entitiesSection = formatEntities(context.entities);
  if (entitiesSection) {
    sections.push(entitiesSection);
  }

  if (sections.length === 0) {
    return '';
  }

  return `
═══════════════════════════════════════════════════════════════
USER CONTEXT
═══════════════════════════════════════════════════════════════

${sections.join('\n\n')}
`;
}

/**
 * Format user preferences
 */
function formatPreferences(prefs: UserPreferences): string {
  const lines: string[] = [];

  // Default project
  if (prefs.defaultProject) {
    lines.push(`Default project: ${prefs.defaultProject}`);
  }

  // Working hours
  if (prefs.workingHours) {
    lines.push(
      `Working hours: ${prefs.workingHours.start} - ${prefs.workingHours.end} (${prefs.workingHours.timezone})`
    );
  }

  // Label mappings (only show if non-default)
  const customMappings = Object.entries(prefs.labelMappings).filter(
    ([key]) => !['call', 'email', 'buy', 'fix', 'review', 'read', 'write'].includes(key)
  );
  if (customMappings.length > 0) {
    lines.push('Custom label rules:');
    for (const [trigger, labels] of customMappings) {
      lines.push(`  - "${trigger}" → ${labels.join(', ')}`);
    }
  }

  // Project mappings
  if (Object.keys(prefs.projectMappings).length > 0) {
    lines.push('Project rules:');
    for (const [trigger, project] of Object.entries(prefs.projectMappings)) {
      lines.push(`  - "${trigger}" → ${project}`);
    }
  }

  if (lines.length === 0) return '';

  return `PREFERENCES
${lines.join('\n')}`;
}

/**
 * Format learned patterns
 */
function formatPatterns(patterns: LearnedPatterns): string {
  const lines: string[] = [];

  // Frequent projects (top 3)
  if (patterns.frequentProjects.length > 0) {
    lines.push(`Frequently used projects: ${patterns.frequentProjects.slice(0, 3).join(', ')}`);
  }

  // High-confidence word associations
  const strongAssociations = patterns.wordAssociations.filter((a) => a.confidence >= 0.7);
  if (strongAssociations.length > 0) {
    lines.push('Learned patterns:');
    for (const assoc of strongAssociations.slice(0, 5)) {
      const targets: string[] = [];
      if (assoc.target.project) targets.push(`project: ${assoc.target.project}`);
      if (assoc.target.labels?.length) targets.push(`labels: ${assoc.target.labels.join(', ')}`);
      if (targets.length > 0) {
        lines.push(`  - "${assoc.trigger}" → ${targets.join(', ')}`);
      }
    }
  }

  // Common labels
  if (patterns.commonLabels.length > 0) {
    lines.push(`Commonly used labels: ${patterns.commonLabels.slice(0, 5).join(', ')}`);
  }

  if (lines.length === 0) return '';

  return `LEARNED PATTERNS
${lines.join('\n')}`;
}

/**
 * Format session context
 */
function formatSession(session: SessionContext): string {
  const lines: string[] = [];

  // Recent tasks
  if (session.recentTasks.length > 0) {
    lines.push('Recent tasks (for context references like "that", "the first one"):');
    for (let i = 0; i < Math.min(5, session.recentTasks.length); i++) {
      const task = session.recentTasks[i];
      const marker = task.id === session.lastCreatedTaskId ? ' (just created)' : '';
      lines.push(`  ${i + 1}. "${task.title}"${task.project ? ` [${task.project}]` : ''}${marker}`);
    }
  }

  // Recent projects
  if (session.recentProjects.length > 0) {
    lines.push(`Recently used projects: ${session.recentProjects.join(', ')}`);
  }

  // Mentioned people
  if (session.mentionedPeople.length > 0) {
    lines.push(
      `People mentioned in this conversation: ${session.mentionedPeople.map((p) => p.name).join(', ')}`
    );
  }

  // Active flow
  if (session.activeFlow) {
    lines.push(`Active flow: ${session.activeFlow.type}`);
  }

  // Undo available
  if (session.undoStack.length > 0) {
    lines.push(`Undo available: ${session.undoStack.length} action(s)`);
  }

  if (lines.length === 0) return '';

  return `SESSION CONTEXT
${lines.join('\n')}`;
}

/**
 * Format entities
 */
function formatEntities(entities: UserEntities): string {
  const lines: string[] = [];

  // People (for agenda items)
  if (entities.people.length > 0) {
    const activePeople = entities.people.filter((p) => p.active);
    if (activePeople.length > 0) {
      lines.push('Known people (for agenda/waiting items):');
      for (const person of activePeople.slice(0, 10)) {
        const aliases = person.aliases.length > 0 ? ` (aliases: ${person.aliases.join(', ')})` : '';
        const frequency = person.frequency ? ` [${person.frequency}]` : '';
        lines.push(`  - ${person.name}${aliases}${frequency}`);
      }
    }
  }

  // Projects (summarized)
  if (entities.projects.length > 0) {
    const topLevel = entities.projects.filter((p) => !p.parentId && !p.isInbox);
    if (topLevel.length > 0) {
      lines.push(`Available projects: ${topLevel.map((p) => p.name).join(', ')}`);
    }
  }

  // Labels (summarized)
  if (entities.labels.length > 0) {
    const contextLabels = entities.labels.filter((l) => l.isContext);
    if (contextLabels.length > 0) {
      lines.push(`GTD context labels: ${contextLabels.map((l) => '@' + l.name).join(', ')}`);
    }
  }

  if (lines.length === 0) return '';

  return `KNOWN ENTITIES
${lines.join('\n')}`;
}

// ============================================================================
// Context-Aware Inference Helpers
// ============================================================================

/**
 * Get suggested project based on context
 */
export function suggestProject(
  content: string,
  context: UserContext
): { project: string; confidence: number; reason: string } | null {
  const lowerContent = content.toLowerCase();

  // Check explicit project mappings first
  for (const [trigger, project] of Object.entries(context.preferences.projectMappings)) {
    if (lowerContent.includes(trigger)) {
      return { project, confidence: 0.9, reason: `keyword "${trigger}"` };
    }
  }

  // Check learned word associations
  for (const assoc of context.patterns.wordAssociations) {
    if (assoc.target.project && lowerContent.includes(assoc.trigger)) {
      return {
        project: assoc.target.project,
        confidence: assoc.confidence,
        reason: `learned from "${assoc.trigger}"`,
      };
    }
  }

  // Check if any mentioned people suggest a project
  for (const person of context.session.mentionedPeople) {
    if (lowerContent.includes(person.name.toLowerCase())) {
      // If this person has recent activity in a project, suggest it
      const recentWithPerson = context.session.recentTasks.find(
        (t) => t.title.toLowerCase().includes(person.name.toLowerCase()) && t.project
      );
      if (recentWithPerson?.project) {
        return {
          project: recentWithPerson.project,
          confidence: 0.6,
          reason: `recent task with ${person.name}`,
        };
      }
    }
  }

  // Check recent project usage
  if (context.session.recentProjects.length > 0) {
    // If the content seems related to recent topics, use recent project
    const recentProject = context.session.recentProjects[0];
    return {
      project: recentProject,
      confidence: 0.4,
      reason: 'recently used project',
    };
  }

  // Default project
  if (context.preferences.defaultProject) {
    return {
      project: context.preferences.defaultProject,
      confidence: 0.3,
      reason: 'default project',
    };
  }

  return null;
}

/**
 * Get suggested labels based on context
 */
export function suggestLabels(
  content: string,
  context: UserContext
): Array<{ label: string; confidence: number; reason: string }> {
  const suggestions: Array<{ label: string; confidence: number; reason: string }> = [];
  const lowerContent = content.toLowerCase();

  // Check explicit label mappings
  for (const [trigger, labels] of Object.entries(context.preferences.labelMappings)) {
    if (lowerContent.includes(trigger)) {
      for (const label of labels) {
        suggestions.push({
          label,
          confidence: 0.9,
          reason: `keyword "${trigger}"`,
        });
      }
    }
  }

  // Check learned word associations
  for (const assoc of context.patterns.wordAssociations) {
    if (assoc.target.labels && lowerContent.includes(assoc.trigger)) {
      for (const label of assoc.target.labels) {
        if (!suggestions.find((s) => s.label === label)) {
          suggestions.push({
            label,
            confidence: assoc.confidence,
            reason: `learned from "${assoc.trigger}"`,
          });
        }
      }
    }
  }

  // Check for person mentions
  for (const person of context.entities.people) {
    const personMentioned =
      lowerContent.includes(person.name.toLowerCase()) ||
      person.aliases.some((a) => lowerContent.includes(a.toLowerCase()));

    if (personMentioned && person.todoistLabel) {
      suggestions.push({
        label: person.todoistLabel,
        confidence: 0.85,
        reason: `person: ${person.name}`,
      });
    }
  }

  return suggestions;
}

/**
 * Find person by name or alias
 */
export function findPerson(
  nameOrAlias: string,
  context: UserContext
): PersonEntity | null {
  const lower = nameOrAlias.toLowerCase();

  for (const person of context.entities.people) {
    if (person.name.toLowerCase() === lower) {
      return person;
    }
    if (person.aliases.some((a) => a.toLowerCase() === lower)) {
      return person;
    }
  }

  // Fuzzy match - check if name starts with or contains
  for (const person of context.entities.people) {
    if (
      person.name.toLowerCase().startsWith(lower) ||
      person.aliases.some((a) => a.toLowerCase().startsWith(lower))
    ) {
      return person;
    }
  }

  return null;
}

/**
 * Find project by name (supports partial matching)
 */
export function findProject(
  name: string,
  context: UserContext
): ProjectEntity | null {
  const lower = name.toLowerCase();

  // Exact match first
  const exact = context.entities.projects.find(
    (p) => p.name.toLowerCase() === lower || p.hierarchyName.toLowerCase() === lower
  );
  if (exact) return exact;

  // Partial match
  const partial = context.entities.projects.find(
    (p) => p.name.toLowerCase().includes(lower) || p.hierarchyName.toLowerCase().includes(lower)
  );
  return partial ?? null;
}
