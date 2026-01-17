-- Clarity GTD Database Schema
-- Run this to create all required tables

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL UNIQUE,
  notion_access_token TEXT,
  notion_workspace_id TEXT,
  notion_workspace_name TEXT,
  notion_tasks_database_id TEXT,
  notion_people_database_id TEXT,
  notion_bot_id TEXT,
  timezone VARCHAR(50) DEFAULT 'America/New_York',
  digest_time TIME DEFAULT '08:00',
  meeting_reminder_hours INTEGER DEFAULT 2,
  status VARCHAR(20) DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'paused')),
  onboarding_step VARCHAR(50) DEFAULT 'welcome',
  total_tasks_captured INTEGER DEFAULT 0,
  total_tasks_completed INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE
);

-- People table (for agenda items)
CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notion_page_id TEXT,
  name VARCHAR(255) NOT NULL,
  aliases TEXT[], -- Array of alternative names
  frequency VARCHAR(20) DEFAULT 'as_needed' CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'as_needed')),
  day_of_week VARCHAR(10) CHECK (day_of_week IN ('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')),
  active BOOLEAN DEFAULT true,
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notion_page_id TEXT,
  raw_text TEXT NOT NULL,
  title VARCHAR(500) NOT NULL,
  notes TEXT,
  type VARCHAR(20) DEFAULT 'action' CHECK (type IN ('action', 'project', 'waiting', 'someday', 'agenda')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'discussed')),
  context VARCHAR(20) CHECK (context IN ('work', 'home', 'errands', 'calls', 'computer', 'anywhere')),
  priority VARCHAR(20) CHECK (priority IN ('today', 'this_week', 'soon')),
  person_id UUID REFERENCES people(id) ON DELETE SET NULL,
  parent_project_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  due_date DATE,
  completed_at TIMESTAMP WITH TIME ZONE,
  synced_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sendblue_message_id TEXT,
  content TEXT NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'processing', 'sent', 'delivered', 'failed')),
  classification JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Conversation states table (for multi-turn conversations)
CREATE TABLE IF NOT EXISTS conversation_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state VARCHAR(50) NOT NULL,
  context JSONB DEFAULT '{}',
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_type ON tasks(user_id, type);
CREATE INDEX IF NOT EXISTS idx_tasks_person ON tasks(person_id);
CREATE INDEX IF NOT EXISTS idx_people_user ON people(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_conversation_states_user ON conversation_states(user_id);

-- Success message
SELECT 'Database schema created successfully!' as result;
