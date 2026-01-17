import type { Client } from '@notionhq/client';
import {
  TASKS_DATABASE_PROPERTIES,
  PEOPLE_DATABASE_PROPERTIES,
} from '@gtd/shared-types';

/**
 * Database setup result
 */
export interface DatabaseSetupResult {
  tasksDbId: string;
  peopleDbId: string;
  parentPageId: string;
}

/**
 * Find or create a page to house GTD databases
 *
 * Looks for an existing "GTD" page, or creates one if not found.
 * This page will contain the Tasks and People databases.
 *
 * @param notion - Notion client
 * @returns Page ID
 */
async function findOrCreateGTDPage(notion: Client): Promise<string> {
  // Search for existing GTD page
  const searchResponse = await notion.search({
    query: 'GTD',
    filter: { property: 'object', value: 'page' },
    page_size: 10,
  });

  // Check if we found a matching page
  for (const result of searchResponse.results) {
    if (result.object === 'page' && 'properties' in result) {
      const titleProp = (result.properties as any)?.title;
      if (titleProp?.title?.[0]?.plain_text === 'GTD') {
        return result.id;
      }
    }
  }

  // Create new page in user's workspace
  // We need to create it under a parent page that the integration has access to
  // For simplicity, we'll create in the workspace root by using a "parent" page_id
  // In practice, users grant access to specific pages during OAuth

  // Try to find any page we have access to
  const anyPage = await notion.search({
    filter: { property: 'object', value: 'page' },
    page_size: 1,
  });

  if (anyPage.results.length === 0) {
    throw new Error(
      'No pages accessible. Please share at least one page with GTD during Notion authorization.'
    );
  }

  const parentId = anyPage.results[0]!.id;

  // Create the GTD page
  const page = await notion.pages.create({
    parent: { page_id: parentId },
    properties: {
      title: {
        title: [{ text: { content: 'GTD' } }],
      },
    },
    children: [
      {
        object: 'block',
        type: 'callout',
        callout: {
          rich_text: [
            {
              type: 'text',
              text: {
                content:
                  'This page contains your GTD system managed by GTD. Text your tasks and they appear here!',
              },
            },
          ],
          icon: { emoji: '✨' },
          color: 'blue_background',
        },
      },
    ],
  });

  return page.id;
}

/**
 * Create the Tasks database with GTD schema
 */
async function createTasksDatabase(
  notion: Client,
  parentPageId: string,
  peopleDbId: string
): Promise<string> {
  // Build properties with Person relation pointing to People database
  const properties: any = { ...TASKS_DATABASE_PROPERTIES };

  // Add Person relation
  properties['Person'] = {
    relation: {
      database_id: peopleDbId,
      single_property: {},
    },
  };

  const database = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ type: 'text', text: { content: '📋 Tasks' } }],
    is_inline: true,
    properties,
  });

  return database.id;
}

/**
 * Create the People database for agenda routing
 */
async function createPeopleDatabase(
  notion: Client,
  parentPageId: string
): Promise<string> {
  const database = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ type: 'text', text: { content: '👥 People' } }],
    is_inline: true,
    properties: PEOPLE_DATABASE_PROPERTIES as any,
  });

  return database.id;
}

/**
 * Set up GTD databases in user's Notion workspace
 *
 * Creates:
 * 1. A "GTD" page to contain everything
 * 2. A "📋 Tasks" database with full GTD schema
 * 3. A "👥 People" database for agenda routing
 *
 * @param notion - Authenticated Notion client
 * @returns Database IDs for storing in user record
 */
export async function setupNotionDatabases(
  notion: Client
): Promise<DatabaseSetupResult> {
  // Find or create the parent page
  const parentPageId = await findOrCreateGTDPage(notion);

  // Create People database first (Tasks will reference it)
  const peopleDbId = await createPeopleDatabase(notion, parentPageId);

  // Create Tasks database with relation to People
  const tasksDbId = await createTasksDatabase(notion, parentPageId, peopleDbId);

  return {
    tasksDbId,
    peopleDbId,
    parentPageId,
  };
}
