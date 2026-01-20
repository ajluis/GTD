/**
 * Todoist Discovery Service
 *
 * Queries Todoist to discover the current project and label structure.
 * This is called on each sync operation to ensure we always have the
 * latest structure and adapt to user reorganizations.
 *
 * KEY DESIGN PRINCIPLE: Todoist is the source of truth.
 * - We never cache project IDs in our database
 * - If user renames "Engineering" to "Dev", we adapt immediately
 * - Works with any project structure (freelancer, corporate, personal)
 */

import type { TodoistClient } from '../client.js';
import type { TodoistProject, TodoistLabel } from '../types.js';

/**
 * Project in the discovered structure
 */
export interface DiscoveredProject {
  id: string;
  name: string;
  parentId: string | null;
  isInbox: boolean;
  children: DiscoveredProject[];
}

/**
 * Full Todoist structure discovered at sync time
 */
export interface TodoistStructure {
  /** The user's Inbox project (always exists) */
  inbox: { id: string; name: string };
  /** All projects as a flat list */
  allProjects: DiscoveredProject[];
  /** Projects organized as a tree */
  projectTree: DiscoveredProject[];
  /** All labels */
  labels: Array<{ id: string; name: string }>;
}

/**
 * Discover the user's current Todoist structure
 *
 * Queries projects and labels from Todoist API.
 * Returns a structured view that the AI can use for routing.
 *
 * @param client - Authenticated Todoist client
 * @returns Current project and label structure
 */
export async function discoverTodoistStructure(
  client: TodoistClient
): Promise<TodoistStructure> {
  // Fetch projects and labels in parallel
  const [projectsRaw, labelsRaw] = await Promise.all([
    client.get<TodoistProject[]>('/projects'),
    client.get<TodoistLabel[]>('/labels'),
  ]);

  // Transform to our structure
  const allProjects = projectsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    parentId: (p as any).parent_id ?? null,
    isInbox: p.isInboxProject ?? (p as any).is_inbox_project ?? false,
    children: [] as DiscoveredProject[],
  }));

  // Find inbox
  const inbox = allProjects.find((p) => p.isInbox);
  if (!inbox) {
    // Fallback: use first project (shouldn't happen)
    console.warn('[Discovery] No inbox project found, using first project');
  }

  // Build tree structure
  const projectTree = buildProjectTree(allProjects);

  // Transform labels
  const labels = labelsRaw.map((l) => ({
    id: l.id,
    name: l.name,
  }));

  return {
    inbox: inbox
      ? { id: inbox.id, name: inbox.name }
      : { id: allProjects[0]?.id ?? '', name: 'Inbox' },
    allProjects,
    projectTree,
    labels,
  };
}

/**
 * Build a tree structure from flat project list
 */
function buildProjectTree(projects: DiscoveredProject[]): DiscoveredProject[] {
  const projectMap = new Map<string, DiscoveredProject>();
  const roots: DiscoveredProject[] = [];

  // First pass: index all projects
  for (const project of projects) {
    projectMap.set(project.id, { ...project, children: [] });
  }

  // Second pass: build tree
  for (const project of projects) {
    const node = projectMap.get(project.id)!;
    if (project.parentId) {
      const parent = projectMap.get(project.parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Get all project names as a flat list
 *
 * Used by the AI classifier to understand available routing targets.
 * Includes both parent and child project names.
 *
 * @param structure - Discovered Todoist structure
 * @returns Array of project names
 */
export function getProjectNames(structure: TodoistStructure): string[] {
  return structure.allProjects.map((p) => p.name);
}

/**
 * Get project names with hierarchy context
 *
 * Returns names like "Work > Engineering" to help AI understand structure.
 *
 * @param structure - Discovered Todoist structure
 * @returns Array of hierarchical project names
 */
export function getProjectNamesWithHierarchy(structure: TodoistStructure): string[] {
  const names: string[] = [];

  function addWithPath(project: DiscoveredProject, path: string[]) {
    const fullPath = [...path, project.name];
    if (path.length > 0) {
      names.push(fullPath.join(' > '));
    } else {
      names.push(project.name);
    }

    for (const child of project.children) {
      addWithPath(child, fullPath);
    }
  }

  for (const root of structure.projectTree) {
    addWithPath(root, []);
  }

  return names;
}

/**
 * Find a project ID by name (case-insensitive)
 *
 * Searches both top-level and nested projects.
 *
 * @param structure - Discovered Todoist structure
 * @param name - Project name to find
 * @returns Project ID or null if not found
 */
export function findProjectIdByName(
  structure: TodoistStructure,
  name: string | undefined
): string | null {
  if (!name) return null;

  const lowerName = name.toLowerCase();

  for (const project of structure.allProjects) {
    if (project.name.toLowerCase() === lowerName) {
      return project.id;
    }
  }

  return null;
}

/**
 * Find a label ID by name (case-insensitive)
 *
 * @param structure - Discovered Todoist structure
 * @param name - Label name to find
 * @returns Label ID or null if not found
 */
export function findLabelIdByName(
  structure: TodoistStructure,
  name: string | undefined
): string | null {
  if (!name) return null;

  const lowerName = name.toLowerCase();

  for (const label of structure.labels) {
    if (label.name.toLowerCase() === lowerName) {
      return label.id;
    }
  }

  return null;
}

/**
 * Check if a label exists
 */
export function hasLabel(structure: TodoistStructure, name: string): boolean {
  return findLabelIdByName(structure, name) !== null;
}

/**
 * Find projects that match a keyword/pattern
 *
 * Used for fuzzy matching when AI suggests a project that doesn't exist exactly.
 * For example, "engineering" might match "Software Engineering" or "Eng Team".
 *
 * @param structure - Discovered Todoist structure
 * @param keyword - Keyword to search for
 * @returns Array of matching projects
 */
export function findProjectsByKeyword(
  structure: TodoistStructure,
  keyword: string
): DiscoveredProject[] {
  const lowerKeyword = keyword.toLowerCase();

  return structure.allProjects.filter((p) =>
    p.name.toLowerCase().includes(lowerKeyword)
  );
}
