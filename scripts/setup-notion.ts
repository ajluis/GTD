#!/usr/bin/env npx tsx
/**
 * Notion Database Setup Script
 *
 * Run this script to create the required Notion databases for Clarity.
 * Requires NOTION_ACCESS_TOKEN environment variable.
 *
 * Usage:
 *   NOTION_ACCESS_TOKEN=your_token npx tsx scripts/setup-notion.ts
 */

import { Client } from '@notionhq/client';

// Database property definitions
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
    status: {},  // Status property is created with default options by Notion
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

const PEOPLE_DATABASE_PROPERTIES = {
  Name: { title: {} },
  Aliases: { rich_text: {} },
  Frequency: {
    select: {
      options: [
        { name: 'Daily', color: 'red' },
        { name: 'Weekly', color: 'orange' },
        { name: 'Biweekly', color: 'yellow' },
        { name: 'Monthly', color: 'green' },
        { name: 'As Needed', color: 'gray' },
      ],
    },
  },
  Day: {
    select: {
      options: [
        { name: 'Monday', color: 'default' },
        { name: 'Tuesday', color: 'default' },
        { name: 'Wednesday', color: 'default' },
        { name: 'Thursday', color: 'default' },
        { name: 'Friday', color: 'default' },
        { name: 'Saturday', color: 'default' },
        { name: 'Sunday', color: 'default' },
      ],
    },
  },
  Active: { checkbox: {} },
};

async function main() {
  const token = process.env['NOTION_ACCESS_TOKEN'];

  if (!token) {
    console.error('❌ Missing NOTION_ACCESS_TOKEN environment variable');
    console.error('');
    console.error('Usage:');
    console.error('  NOTION_ACCESS_TOKEN=your_token npx tsx scripts/setup-notion.ts');
    process.exit(1);
  }

  console.log('🚀 Setting up Notion databases for Clarity...\n');

  const notion = new Client({ auth: token });

  // Step 1: Find a page we have access to
  console.log('📖 Searching for accessible pages...');
  const searchResponse = await notion.search({
    filter: { property: 'object', value: 'page' },
    page_size: 5,
  });

  if (searchResponse.results.length === 0) {
    console.error('❌ No pages found. Make sure your integration has access to at least one page.');
    console.error('   In Notion: Open a page → Click "..." → "Add connections" → Select your integration');
    process.exit(1);
  }

  const parentPage = searchResponse.results[0]!;
  console.log(`✅ Found accessible page: ${parentPage.id}\n`);

  // Step 2: Create Clarity GTD page
  console.log('📝 Creating "Clarity GTD" page...');
  const clarityPage = await notion.pages.create({
    parent: { page_id: parentPage.id },
    properties: {
      title: {
        title: [{ text: { content: 'Clarity GTD' } }],
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
                content: 'This page contains your GTD system managed by Clarity. Text your tasks and they appear here! ✨',
              },
            },
          ],
          icon: { emoji: '✨' },
          color: 'blue_background',
        },
      },
    ],
  });
  console.log(`✅ Created page: ${clarityPage.id}\n`);

  // Step 3: Create People database
  console.log('👥 Creating "People" database...');
  const peopleDb = await notion.databases.create({
    parent: { page_id: clarityPage.id },
    title: [{ type: 'text', text: { content: '👥 People' } }],
    is_inline: true,
    properties: PEOPLE_DATABASE_PROPERTIES as any,
  });
  console.log(`✅ Created People database: ${peopleDb.id}\n`);

  // Step 4: Create Tasks database with Person relation
  console.log('📋 Creating "Tasks" database...');
  const tasksProperties: any = { ...TASKS_DATABASE_PROPERTIES };
  tasksProperties['Person'] = {
    relation: {
      database_id: peopleDb.id,
      single_property: {},
    },
  };

  const tasksDb = await notion.databases.create({
    parent: { page_id: clarityPage.id },
    title: [{ type: 'text', text: { content: '📋 Tasks' } }],
    is_inline: true,
    properties: tasksProperties,
  });
  console.log(`✅ Created Tasks database: ${tasksDb.id}\n`);

  // Summary
  console.log('═'.repeat(60));
  console.log('🎉 Notion setup complete!\n');
  console.log('Add these to your Railway environment variables:\n');
  console.log(`NOTION_TASKS_DATABASE_ID=${tasksDb.id}`);
  console.log(`NOTION_PEOPLE_DATABASE_ID=${peopleDb.id}`);
  console.log('');
  console.log('Or run:');
  console.log(`railway variables --set NOTION_TASKS_DATABASE_ID=${tasksDb.id}`);
  console.log(`railway variables --set NOTION_PEOPLE_DATABASE_ID=${peopleDb.id}`);
  console.log('═'.repeat(60));
}

main().catch((error) => {
  console.error('❌ Setup failed:', error.message);
  process.exit(1);
});
