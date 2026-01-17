# Clarity GTD - Project Context

> A GTD (Getting Things Done) assistant that works via SMS, using AI to classify messages and sync tasks to Notion.

## Overview

Clarity is an SMS-based task management system. Users text tasks to a phone number, and an AI (Gemini) classifies them into GTD categories, then syncs them to the user's Notion workspace.

**Core Flow:**
```
User texts SMS → Sendblue webhook → Redis queue → Worker classifies with Gemini AI →
Creates task in PostgreSQL → Syncs to Notion → Sends confirmation SMS back
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+ with TypeScript |
| Monorepo | Turborepo + pnpm workspaces |
| API | Fastify |
| Queue | BullMQ + Redis |
| Database | PostgreSQL + Drizzle ORM |
| AI | Google Gemini (via @google/generative-ai) |
| SMS | Sendblue API |
| Tasks | Notion API |
| Deployment | Railway |

## Directory Structure

```
/Users/aluis/GTD/
├── apps/
│   ├── api/              # Fastify API server (webhooks, OAuth)
│   ├── worker/           # BullMQ job processor (classification, sync)
│   └── scheduler/        # Cron jobs (daily digest, reminders) [NEW]
├── packages/
│   ├── ai/               # Gemini AI classifier + fuzzy matching
│   ├── database/         # Drizzle schema + client
│   ├── gtd/              # GTD formatters + command parsing
│   ├── notion/           # Notion API client + task operations
│   ├── queue/            # BullMQ queue definitions
│   ├── sendblue/         # Sendblue SMS client
│   ├── shared-types/     # TypeScript types shared across packages
│   └── todoist/          # (Legacy - not actively used)
├── Dockerfile            # Multi-stage Docker build
├── Dockerfile.worker     # Worker-specific Dockerfile for Railway
└── turbo.json            # Turborepo config
```

## Key Files

### AI Classification
> **Note:** These 4 files work together. When changing the classifier interface, update ALL of them:
- `packages/ai/src/index.ts` - Package exports (must export new types)
- `packages/ai/src/classifier.ts` - Main GTD classifier using Gemini
- `packages/ai/src/prompts/classify-task.ts` - LLM prompt with intent detection + types
- `packages/ai/src/fuzzy-match.ts` - Levenshtein distance for name matching

### Message Processing
- `apps/worker/src/processors/classify.ts` - Main message processor (fetches conversation history)
- `apps/worker/src/handlers/intents.ts` - Intent router (35+ intent types)
- `apps/worker/src/handlers/queries.ts` - Query handlers (today, actions, etc.)
- `apps/worker/src/handlers/settings.ts` - Settings handlers (timezone, digest)
- `apps/worker/src/handlers/editing.ts` - Task editing (reschedule, rename, etc.)
- `apps/worker/src/handlers/people.ts` - People management (add, remove, alias)
- `apps/worker/src/handlers/completion.ts` - Task completion handlers

### Notion Integration
- `packages/notion/src/services/tasks.ts` - Task CRUD + queries
- `packages/notion/src/services/setup.ts` - Database creation during onboarding

### Database Schema
- `packages/database/src/schema/users.ts` - User accounts + Notion credentials
- `packages/database/src/schema/tasks.ts` - Local task records
- `packages/database/src/schema/people.ts` - People for agenda items
- `packages/database/src/schema/messages.ts` - SMS history (used for conversation context)
- `packages/database/src/schema/conversation-states.ts` - Multi-turn conversation state

## Database Schema

### users
```sql
- id (uuid, PK)
- phone_number (text, unique) -- E.164 format: +15551234567
- notion_access_token (text)
- notion_tasks_database_id (text)
- notion_people_database_id (text)
- timezone (text, default: 'America/New_York')
- digest_time (text, default: '08:00')
- meeting_reminder_hours (int, default: 2)
- status (enum: 'onboarding', 'active', 'paused')
- total_tasks_captured (int)
- total_tasks_completed (int)
```

### tasks
```sql
- id (uuid, PK)
- user_id (uuid, FK → users)
- raw_text (text) -- Original SMS
- title (text) -- Cleaned title
- type (enum: 'action', 'project', 'waiting', 'someday', 'agenda')
- status (enum: 'pending', 'synced', 'completed', 'failed')
- context (enum: 'work', 'home', 'errands', 'calls', 'computer', 'anywhere')
- priority (enum: 'today', 'this_week', 'soon')
- person_id (uuid, FK → people)
- notion_page_id (text) -- After sync
- due_date (text) -- ISO format
```

### people
```sql
- id (uuid, PK)
- user_id (uuid, FK → users)
- name (text)
- aliases (text[]) -- Alternative names
- frequency (enum: 'daily', 'weekly', 'biweekly', 'monthly', 'as_needed')
- day_of_week (enum: 'monday'...'sunday')
- notion_page_id (text) -- Synced to Notion People database
- active (boolean)
```

### conversation_states
```sql
- id (uuid, PK)
- user_id (uuid, FK → users)
- state_type (text) -- 'task_clarification', 'post_meeting', etc.
- step (text)
- data (jsonb) -- State-specific data
- expires_at (timestamp)
```

## LLM Intent System

The classifier detects 35+ intent types organized into categories:

### Query Intents
- `query_today` - "what's on my plate today?"
- `query_actions` - "show me my next actions"
- `query_projects` - "what projects am I working on?"
- `query_waiting` - "what am I waiting on?"
- `query_someday` - "show my someday list"
- `query_context` - "what can I do @home?"
- `query_people` - "who do I meet with?"
- `query_person_agenda` - "what's on my plate for Sarah?"

### Completion Intents
- `complete_task` - "done call dentist"
- `complete_recent` - "that's done"
- `complete_person_agenda` - "done with Sarah"

### People Management
- `add_person` - "add John to my people"
- `remove_person` - "remove Sarah"
- `set_alias` - "call him Johnny"
- `set_schedule` - "I meet with John weekly on Tuesdays"

### Settings
- `set_digest_time` - "send my digest at 7am"
- `set_timezone` - "I'm in Pacific time"
- `set_reminder_hours` - "remind me 3 hours before meetings"
- `pause_account` / `resume_account`
- `show_settings`

### Task Editing
- `reschedule_task` - "move dentist to Friday"
- `set_task_priority` - "make proposal urgent"
- `set_task_context` - "groceries is an errand"
- `add_task_note` - "add note to dentist: bring insurance"
- `rename_task` - "rename dentist to 'Call Dr. Smith'"
- `delete_task` - "delete the gym task"

### Task Capture (when not an intent)
- `action` - Single next step
- `project` - Multi-step outcome
- `waiting` - Delegated/expecting from someone
- `someday` - Future idea
- `agenda` - Discussion topic for a person

### Clarification Flow
When a task is vague (e.g., "call Rob"), the system:
1. Returns `needs_clarification` with a follow-up question
2. Stores partial task in `conversation_states`
3. Asks: "What do you need to discuss with Rob? And by when?"
4. Merges user's response with partial task

### Conversation History
The AI receives the last 6 messages for context resolution:
- Fetched from `messages` table (both inbound and outbound)
- Passed to classifier as `conversationHistory`
- Used to resolve pronouns: "that", "it", "the first one"
- Example: User asks "what's on my plate today?" → sees "Call Rob" → says "finished that"
  → AI sees the previous exchange and returns `complete_task` with `taskText: "Call Rob"`

## Notion Database Structure

The system auto-creates two databases during onboarding:

### Tasks Database
| Property | Type | Values |
|----------|------|--------|
| Task | title | Task name |
| Type | select | Action, Project, Waiting, Someday, Agenda |
| Status | select | To Do, Done, Discussed |
| Context | select | @work, @home, @errands, @calls, @computer |
| Priority | select | 🔥 Today, 📅 This Week, 🔜 Soon |
| Due | date | Due date |
| Person | relation | → People database |
| Notes | rich_text | Additional notes |
| Created | date | When captured |
| Completed | date | When marked done |

### People Database
| Property | Type |
|----------|------|
| Name | title |
| Frequency | select |
| Day | select |

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_URL=redis://localhost:6379

# Sendblue SMS
SENDBLUE_API_KEY=...
SENDBLUE_API_SECRET=...

# Notion OAuth
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
NOTION_REDIRECT_URI=https://your-api.railway.app/auth/notion/callback

# Google Gemini AI
GEMINI_API_KEY=...

# API
PORT=3000
API_URL=https://your-api.railway.app
```

## Railway Deployment

Three services:
1. **api** - Uses `Dockerfile` (default target)
2. **worker** - Uses `Dockerfile.worker`
3. **scheduler** - Uses `Dockerfile` with `--target scheduler` (optional)

Both Dockerfiles need the scheduler's package.json in the deps stage for the monorepo build to work.

## Current State & Known Issues

### Recently Implemented
- [x] LLM-driven intent system (35+ intents)
- [x] Fuzzy name matching with Levenshtein distance
- [x] Task editing commands (reschedule, rename, delete, etc.)
- [x] Follow-up questions for vague tasks
- [x] Scheduler app for daily digest/reminders
- [x] Conversation history for AI context (resolves "that", "it", "the first one")

### Known Issues
1. **conversation_states table** - Missing `state_type` column in production. Run:
   ```sql
   ALTER TABLE conversation_states
   ADD COLUMN IF NOT EXISTS state_type TEXT NOT NULL DEFAULT 'unknown';
   ```

2. **Notion Status filter** - Uses `select` type, not native `status` type

### TODOs
- [ ] Implement undo functionality (needs action history)
- [ ] Implement `change_task_type` (needs last task tracking)
- [ ] Add conversation state for post-meeting flow
- [ ] Weekly review feature
- [ ] Project health tracking

## Testing Locally

```bash
# Install dependencies
pnpm install

# Run database migrations
cd packages/database
DATABASE_URL="..." pnpm drizzle-kit push

# Start Redis (Docker)
docker run -d -p 6379:6379 redis

# Start API
pnpm --filter @clarity/api dev

# Start Worker
pnpm --filter @clarity/worker dev

# Build all
pnpm build
```

## Adding a New User

```sql
INSERT INTO users (
  phone_number, status, notion_access_token,
  notion_tasks_database_id, notion_people_database_id,
  timezone, digest_time
) VALUES (
  '+15551234567', 'active', 'ntn_xxx...',
  'database-id-1', 'database-id-2',
  'America/New_York', '08:00'
);
```

## Useful Commands

```bash
# Check git status
git status

# Build all packages
pnpm build

# Run specific package
pnpm --filter @clarity/worker dev

# Push database schema
cd packages/database && DATABASE_URL="..." pnpm drizzle-kit push

# View Railway logs
railway logs
```

---

*Last updated: January 17, 2026*
