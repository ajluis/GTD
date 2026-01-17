#!/usr/bin/env node
/**
 * Database schema push script
 * Run with: railway run --service Conversational node scripts/db-push.js
 */

const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL);

async function main() {
  console.log('Creating database tables...');

  // Create users table
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      notion_access_token TEXT,
      notion_workspace_id TEXT,
      notion_workspace_name TEXT,
      notion_bot_id TEXT,
      notion_tasks_database_id TEXT,
      notion_people_database_id TEXT,
      timezone VARCHAR(50) DEFAULT 'America/New_York',
      digest_time TIME DEFAULT '08:00',
      meeting_reminder_hours INTEGER DEFAULT 24,
      status VARCHAR(20) DEFAULT 'onboarding',
      onboarding_step VARCHAR(50) DEFAULT 'welcome',
      total_tasks_captured INTEGER DEFAULT 0,
      total_tasks_completed INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      last_message_at TIMESTAMPTZ
    )
  `;
  console.log('✅ users table created');

  // Create people table
  await sql`
    CREATE TABLE IF NOT EXISTS people (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notion_page_id TEXT,
      name VARCHAR(255) NOT NULL,
      aliases TEXT[],
      frequency VARCHAR(20) DEFAULT 'as_needed',
      day_of_week VARCHAR(10),
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      synced_at TIMESTAMPTZ
    )
  `;
  console.log('✅ people table created');

  // Create tasks table
  await sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      notion_page_id TEXT,
      raw_text TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      type VARCHAR(20) NOT NULL DEFAULT 'action',
      status VARCHAR(20) DEFAULT 'pending',
      context VARCHAR(20),
      priority VARCHAR(20),
      person_id UUID REFERENCES people(id) ON DELETE SET NULL,
      parent_project_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      due_date DATE,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      synced_at TIMESTAMPTZ
    )
  `;
  console.log('✅ tasks table created');

  // Create messages table
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sendblue_message_id TEXT,
      content TEXT NOT NULL,
      direction VARCHAR(10) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      classification JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ messages table created');

  // Create conversation_states table
  await sql`
    CREATE TABLE IF NOT EXISTS conversation_states (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      state_type TEXT NOT NULL,
      step TEXT,
      data JSONB DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `;
  console.log('✅ conversation_states table created');

  // Migrate existing conversation_states schema (if table already exists with old schema)
  console.log('🔄 Checking for schema migrations...');
  
  // Check if old 'state' column exists and migrate
  const stateColumnCheck = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'conversation_states' AND column_name = 'state'
  `;
  
  if (stateColumnCheck.length > 0) {
    console.log('  Migrating: state -> state_type');
    await sql`ALTER TABLE conversation_states RENAME COLUMN state TO state_type`;
  }

  // Check if old 'context' column exists and migrate
  const contextColumnCheck = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'conversation_states' AND column_name = 'context'
  `;
  
  if (contextColumnCheck.length > 0) {
    console.log('  Migrating: context -> data');
    await sql`ALTER TABLE conversation_states RENAME COLUMN context TO data`;
  }

  // Add step column if it doesn't exist
  const stepColumnCheck = await sql`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'conversation_states' AND column_name = 'step'
  `;
  
  if (stepColumnCheck.length === 0) {
    console.log('  Adding: step column');
    await sql`ALTER TABLE conversation_states ADD COLUMN step TEXT`;
  }

  // Create indexes if they don't exist
  await sql`
    CREATE INDEX IF NOT EXISTS idx_conversation_states_user 
    ON conversation_states(user_id)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_conversation_states_expires 
    ON conversation_states(expires_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_conversation_states_type 
    ON conversation_states(user_id, state_type)
  `;
  console.log('✅ conversation_states indexes created');

  console.log('\\n🎉 All tables created successfully!');
  await sql.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
