#!/usr/bin/env npx tsx
/**
 * Create Tasks Database Only
 *
 * Use this if People database already exists.
 *
 * Usage:
 *   NOTION_ACCESS_TOKEN=xxx PARENT_PAGE_ID=xxx PEOPLE_DB_ID=xxx npx tsx scripts/create-tasks-db.ts
 */

import { Client } from '@notionhq/client';

const TASKS_DATABASE_PROPERTIES = {
  Task: { title: {} },
  Type: {
    select: {
      options: [
        { name: 'Action', color: 'green' },
        { name: 'Project', color: 'blue' },
        { name: 'Waiting', color: 'yellow' },
        { name: 'Someday', color: 'gray' },
        { name: 'Agenda', color: 'purple' },
      ],
    },
  },
  Status: {
    status: {},  // Notion creates default status options
  },
  Context: {
    select: {
      options: [
        { name: '@work', color: 'blue' },
        { name: '@home', color: 'green' },
        { name: '@errands', color: 'orange' },
        { name: '@calls', color: 'pink' },
        { name: '@computer', color: 'purple' },
        { name: '@anywhere', color: 'gray' },
      ],
    },
  },
  Priority: {
    select: {
      options: [
        { name: '🔥 Today', color: 'red' },
        { name: '⚡ This week', color: 'yellow' },
        { name: '📋 Soon', color: 'gray' },
      ],
    },
  },
  Due: { date: {} },
  Created: { created_time: {} },
  Completed: { date: {} },
  Notes: { rich_text: {} },
};

async function main() {
  const token = process.env['NOTION_ACCESS_TOKEN'];
  const parentPageId = process.env['PARENT_PAGE_ID'];
  const peopleDbId = process.env['PEOPLE_DB_ID'];

  if (!token || !parentPageId || !peopleDbId) {
    console.error('Missing required environment variables:');
    console.error('  NOTION_ACCESS_TOKEN - Your Notion integration token');
    console.error('  PARENT_PAGE_ID - The GTD page ID');
    console.error('  PEOPLE_DB_ID - The People database ID');
    process.exit(1);
  }

  const notion = new Client({ auth: token });

  console.log('📋 Creating "Tasks" database...');

  const tasksProperties: any = { ...TASKS_DATABASE_PROPERTIES };
  tasksProperties['Person'] = {
    relation: {
      database_id: peopleDbId,
      single_property: {},
    },
  };

  const tasksDb = await notion.databases.create({
    parent: { page_id: parentPageId },
    title: [{ type: 'text', text: { content: '📋 Tasks' } }],
    is_inline: true,
    properties: tasksProperties,
  });

  console.log(`✅ Created Tasks database: ${tasksDb.id}\n`);
  console.log('Add to Railway:');
  console.log(`railway variables --set NOTION_TASKS_DATABASE_ID=${tasksDb.id}`);
  console.log(`railway variables --set NOTION_PEOPLE_DATABASE_ID=${peopleDbId}`);
}

main().catch((error) => {
  console.error('❌ Failed:', error.message);
  process.exit(1);
});
