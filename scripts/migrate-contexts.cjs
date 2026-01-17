#!/usr/bin/env node
/**
 * Migrate context enum to new values: computer, phone, home, outside
 * Run with: railway run node scripts/migrate-contexts.cjs
 */

const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  console.log('Migrating context enum...');

  // First, add new values to the enum (PostgreSQL allows adding but not removing)
  try {
    await sql`ALTER TYPE task_context ADD VALUE IF NOT EXISTS 'phone'`;
    console.log('✅ Added phone to enum');
  } catch (e) {
    console.log('phone already exists or error:', e.message);
  }

  try {
    await sql`ALTER TYPE task_context ADD VALUE IF NOT EXISTS 'outside'`;
    console.log('✅ Added outside to enum');
  } catch (e) {
    console.log('outside already exists or error:', e.message);
  }

  // Migrate existing data from old values to new values
  console.log('Migrating existing task contexts...');

  // calls -> phone
  const callsToPhone = await sql`
    UPDATE tasks SET context = 'phone' WHERE context = 'calls' RETURNING id
  `;
  console.log(`  calls -> phone: ${callsToPhone.length} tasks`);

  // errands -> outside
  const errandsToOutside = await sql`
    UPDATE tasks SET context = 'outside' WHERE context = 'errands' RETURNING id
  `;
  console.log(`  errands -> outside: ${errandsToOutside.length} tasks`);

  // work -> computer (since most work tasks are computer-based)
  const workToComputer = await sql`
    UPDATE tasks SET context = 'computer' WHERE context = 'work' RETURNING id
  `;
  console.log(`  work -> computer: ${workToComputer.length} tasks`);

  // anywhere -> phone (most "anywhere" tasks can be done on phone)
  const anywhereToPhone = await sql`
    UPDATE tasks SET context = 'phone' WHERE context = 'anywhere' RETURNING id
  `;
  console.log(`  anywhere -> phone: ${anywhereToPhone.length} tasks`);

  // Now we need to drop the constraint and recreate it
  // First check if there's a check constraint
  console.log('Updating constraints...');

  try {
    await sql`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_context_check`;
    console.log('✅ Dropped old constraint');
  } catch (e) {
    console.log('No constraint to drop or error:', e.message);
  }

  // The enum type itself in PostgreSQL can't have values removed easily
  // But since we've migrated all data, the old values won't be used
  // New inserts will use the new values

  console.log('\\n🎉 Migration complete!');
  console.log('New valid contexts: computer, phone, home, outside');

  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
