#!/usr/bin/env node
/**
 * Fix conversation_states table schema
 * Run with: railway run --service API node scripts/fix-conversation-states-schema.cjs
 */

const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  console.log('Fixing conversation_states table schema...\n');

  try {
    // Rename 'state' column to 'state_type'
    console.log('1. Renaming "state" column to "state_type"...');
    await sql`
      ALTER TABLE conversation_states 
      RENAME COLUMN state TO state_type;
    `;
    console.log('✅ Renamed state -> state_type');

    // Rename 'context' column to 'data'
    console.log('\n2. Renaming "context" column to "data"...');
    await sql`
      ALTER TABLE conversation_states 
      RENAME COLUMN context TO data;
    `;
    console.log('✅ Renamed context -> data');

    // Add 'step' column
    console.log('\n3. Adding "step" column...');
    await sql`
      ALTER TABLE conversation_states 
      ADD COLUMN IF NOT EXISTS step TEXT;
    `;
    console.log('✅ Added step column');

    // Add indexes if they don't exist
    console.log('\n4. Adding indexes...');
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversation_states_user 
      ON conversation_states(user_id);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversation_states_expires 
      ON conversation_states(expires_at);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_conversation_states_type 
      ON conversation_states(user_id, state_type);
    `;
    console.log('✅ Indexes created');

    console.log('\n🎉 Schema migration completed successfully!');
    
  } catch (err) {
    console.error('❌ Error during migration:', err.message);
    throw err;
  } finally {
    await sql.end();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
