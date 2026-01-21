-- Manual Migration: Convert varchar columns to enums and create new tables
-- Run this against your Railway PostgreSQL database
--
-- Usage: psql "postgresql://postgres:xxx@host:port/railway" -f manual-enum-migration.sql

BEGIN;

-- ============================================================================
-- 1. Create enum types (if they don't exist)
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE message_status AS ENUM ('pending', 'sent', 'delivered', 'failed', 'received');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('onboarding', 'active', 'paused');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE meeting_frequency AS ENUM ('daily', 'weekly', 'biweekly', 'monthly', 'as_needed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE day_of_week AS ENUM ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('action', 'project', 'waiting', 'someday', 'agenda', 'reference');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('pending', 'synced', 'completed', 'failed', 'deleted');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('today', 'this_week', 'soon', 'someday');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE task_context AS ENUM ('computer', 'phone', 'home', 'outside');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- 2. Convert messages table columns (drop defaults first, then convert, then re-add)
-- ============================================================================

-- Drop defaults
ALTER TABLE messages ALTER COLUMN direction DROP DEFAULT;
ALTER TABLE messages ALTER COLUMN status DROP DEFAULT;

-- Convert types
ALTER TABLE messages
  ALTER COLUMN direction TYPE message_direction USING direction::message_direction,
  ALTER COLUMN status TYPE message_status USING status::message_status;

-- Re-add defaults
ALTER TABLE messages ALTER COLUMN status SET DEFAULT 'pending'::message_status;

-- ============================================================================
-- 3. Convert users table columns
-- ============================================================================

-- Drop defaults first
ALTER TABLE users ALTER COLUMN status DROP DEFAULT;

-- Convert types
ALTER TABLE users
  ALTER COLUMN phone_number TYPE text,
  ALTER COLUMN timezone TYPE text,
  ALTER COLUMN digest_time TYPE text,
  ALTER COLUMN status TYPE user_status USING status::user_status,
  ALTER COLUMN onboarding_step TYPE text;

-- Re-add defaults
ALTER TABLE users ALTER COLUMN status SET DEFAULT 'onboarding'::user_status;

-- ============================================================================
-- 4. Convert people table columns
-- ============================================================================

-- Drop defaults first
ALTER TABLE people ALTER COLUMN frequency DROP DEFAULT;

-- Convert types
ALTER TABLE people
  ALTER COLUMN name TYPE text,
  ALTER COLUMN frequency TYPE meeting_frequency USING frequency::meeting_frequency,
  ALTER COLUMN day_of_week TYPE day_of_week USING day_of_week::day_of_week;

-- Re-add defaults
ALTER TABLE people ALTER COLUMN frequency SET DEFAULT 'as_needed'::meeting_frequency;

-- Drop deprecated columns if they exist
ALTER TABLE people DROP COLUMN IF EXISTS synced_at;
ALTER TABLE people DROP COLUMN IF EXISTS meeting_days;

-- ============================================================================
-- 5. Convert tasks table columns
-- ============================================================================

-- First, normalize non-standard context values to valid enum values
UPDATE tasks SET context = 'phone' WHERE context = 'calls';
UPDATE tasks SET context = 'outside' WHERE context = 'errands';
UPDATE tasks SET context = 'computer' WHERE context NOT IN ('computer', 'phone', 'home', 'outside') AND context IS NOT NULL;

-- Drop defaults first
ALTER TABLE tasks ALTER COLUMN context DROP DEFAULT;
ALTER TABLE tasks ALTER COLUMN priority DROP DEFAULT;

-- Convert types
ALTER TABLE tasks
  ALTER COLUMN context TYPE task_context USING context::task_context,
  ALTER COLUMN priority TYPE task_priority USING priority::task_priority;

-- ============================================================================
-- 6. Create new context/memory tables
-- ============================================================================

-- User Preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_project text,
  working_hours jsonb,
  label_mappings jsonb DEFAULT '{}'::jsonb NOT NULL,
  project_mappings jsonb DEFAULT '{}'::jsonb NOT NULL,
  priority_keywords jsonb DEFAULT '{"high":[],"medium":[],"low":[]}'::jsonb NOT NULL,
  default_context text,
  date_aliases jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- User Patterns (learned behaviors)
CREATE TABLE IF NOT EXISTS user_patterns (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  typical_task_times jsonb DEFAULT '{}'::jsonb NOT NULL,
  common_labels jsonb DEFAULT '[]'::jsonb NOT NULL,
  frequent_projects jsonb DEFAULT '[]'::jsonb NOT NULL,
  word_associations jsonb DEFAULT '[]'::jsonb NOT NULL,
  task_type_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
  person_patterns jsonb DEFAULT '[]'::jsonb NOT NULL,
  total_corrections integer DEFAULT 0 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Conversation Memory
CREATE TABLE IF NOT EXISTS conversation_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  summary text NOT NULL,
  key_entities jsonb DEFAULT '[]'::jsonb NOT NULL,
  memory_type text DEFAULT 'interaction' NOT NULL,
  relevance_score integer DEFAULT 50 NOT NULL,
  retrieval_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_retrieved_at timestamp with time zone
);

CREATE INDEX IF NOT EXISTS idx_conversation_memory_user ON conversation_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_type ON conversation_memory(user_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_relevance ON conversation_memory(user_id, relevance_score);
CREATE INDEX IF NOT EXISTS idx_conversation_memory_created ON conversation_memory(user_id, created_at);

-- Todoist Entity Cache
CREATE TABLE IF NOT EXISTS todoist_entity_cache (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  projects jsonb DEFAULT '[]'::jsonb NOT NULL,
  labels jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL
);

-- ============================================================================
-- 7. Add unique constraint to messages (if not exists)
-- ============================================================================

DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_sendblue_message_id_unique UNIQUE (sendblue_message_id);
EXCEPTION
  WHEN duplicate_table THEN null;
  WHEN duplicate_object THEN null;
END $$;

COMMIT;

-- Report success
SELECT 'Migration completed successfully!' as status;
