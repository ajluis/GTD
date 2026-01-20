# GTD - Project Context

> A GTD (Getting Things Done) assistant that works via SMS, using AI to classify messages and sync tasks to Todoist.

**IMPORTANT:** Update this file before every `git push` to keep context current for future sessions.

## Overview

GTD is an SMS-based task management system. Users text tasks to a phone number, and an AI (Gemini) classifies them into GTD categories, then syncs them to Todoist via the REST API.

**Core Flow:**
```
User texts SMS → Sendblue webhook → Redis queue → Worker classifies with Gemini AI →
Creates task in PostgreSQL → Syncs to Todoist → Sends confirmation SMS back
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
| Tasks | Todoist REST API |
| Deployment | Railway |

## Directory Structure

```
/Users/aluis/GTD/
├── apps/
│   ├── api/              # Fastify API server (webhooks)
│   ├── worker/           # BullMQ job processor (classification, sync)
│   └── scheduler/        # Cron jobs (daily digest, reminders)
├── packages/
│   ├── ai/               # Gemini AI classifier + LLM tools
│   ├── database/         # Drizzle schema + client
│   ├── gtd/              # GTD formatters + command parsing
│   ├── todoist/          # Todoist REST API client + task operations
│   ├── queue/            # BullMQ queue definitions
│   ├── sendblue/         # Sendblue SMS client
│   └── shared-types/     # TypeScript types shared across packages
├── Dockerfile            # Multi-stage Docker build
├── Dockerfile.worker     # Worker-specific Dockerfile for Railway
└── turbo.json            # Turborepo config
```

## Key Files

### AI Classification
> **Note:** These 4 files work together. When changing the classifier interface, update ALL of them:
- `packages/ai/src/index.ts` - Package exports (must export new types)
- `packages/ai/src/classifier.ts` - Main GTD classifier using Gemini
  - `classify(message, people, time, history, mode)` - mode: 'classify' | 'extract'
  - `cleanupTaskTitle()` - Defensive title cleanup
- `packages/ai/src/prompts/classify-task.ts` - LLM prompt with intent detection + types
  - Includes extraction mode instructions when `mode === 'extract'`
- `packages/ai/src/fuzzy-match.ts` - Levenshtein distance for name matching

### Message Processing
- `apps/worker/src/processors/classify.ts` - Main message processor (fetches conversation history)
- `apps/worker/src/handlers/intents.ts` - Intent router (35+ intent types) + HandlerContext interface
- `apps/worker/src/handlers/queries.ts` - Query handlers (today, actions, etc.) - uses Todoist queries
- `apps/worker/src/handlers/settings.ts` - Settings handlers (timezone, digest)
- `apps/worker/src/handlers/editing.ts` - Task editing (reschedule, rename, etc.) - uses Todoist API
- `apps/worker/src/handlers/people.ts` - People management (add, remove, alias)
- `apps/worker/src/handlers/completion.ts` - Task completion handlers - uses Todoist completeTask

### Todoist Integration
- `packages/todoist/src/client.ts` - REST API client with get/post/update/delete methods
- `packages/todoist/src/services/tasks.ts` - Task CRUD + queries (createTask, completeTask, updateTask, deleteTask)
- `packages/todoist/src/services/projects.ts` - Project queries (getProjects, findProject)
- `packages/todoist/src/services/queries.ts` - Filter-based queries:
  - `queryDueToday()` - Tasks due today
  - `queryByLabel(label)` - Tasks with specific label
  - `queryByContext(context)` - Tasks by GTD context label
  - `queryWaiting()` - Waiting tasks (by label)
  - `queryOverdueWaiting()` - Overdue waiting items
  - `queryHighPriority()` - p1/p2 priority tasks
  - `queryPersonAgenda(personLabel)` - Person's agenda items
  - `queryDueThisWeek()` - Tasks due within 7 days
  - `searchTasks(searchText)` - Full-text search

### Database Schema
- `packages/database/src/schema/users.ts` - User accounts + Todoist credentials
- `packages/database/src/schema/tasks.ts` - Local task records
- `packages/database/src/schema/people.ts` - People for agenda items
- `packages/database/src/schema/messages.ts` - SMS history (used for conversation context)
- `packages/database/src/schema/conversation-states.ts` - Multi-turn conversation state

## Database Schema

### users
```sql
- id (uuid, PK)
- phone_number (text, unique) -- E.164 format: +15551234567
-- Todoist Integration
- todoist_access_token (text)
- todoist_user_id (text)
-- Legacy Notion fields (kept for migration, not actively used)
- notion_access_token (text)
- notion_tasks_database_id (text)
- notion_people_database_id (text)
-- Preferences
- timezone (text, default: 'America/New_York')
- digest_time (text, default: '08:00')
- meeting_reminder_hours (int, default: 2)
- status (enum: 'onboarding', 'active', 'paused')
- total_tasks_captured (int)
- total_tasks_completed (int)
- weekly_review_day (text, default: 'sunday')
- weekly_review_time (text, default: '18:00')
```

### tasks
```sql
- id (uuid, PK)
- user_id (uuid, FK → users)
- raw_text (text) -- Original SMS
- title (text) -- Cleaned title
- type (enum: 'action', 'project', 'waiting', 'someday', 'agenda')
- status (enum: 'pending', 'synced', 'completed', 'failed')
- context (enum: 'computer', 'phone', 'home', 'outside')
- priority (enum: 'today', 'this_week', 'soon')
- person_id (uuid, FK → people)
- todoist_task_id (text, unique) -- Todoist task ID after sync
- notion_page_id (text) -- Legacy, kept for migration
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
- todoist_label (text) -- Todoist label for this person's agenda items
- notion_page_id (text) -- Legacy, kept for migration
- active (boolean)
```

### conversation_states
```sql
- id (uuid, PK)
- user_id (uuid, FK → users)
- state_type (text) -- 'task_clarification', 'batch_confirmation', 'post_meeting', etc.
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

## Todoist Structure

Tasks are organized in Todoist using:

### Labels (for GTD metadata)
| Label | Purpose |
|-------|---------|
| `gtd_action` | Next actions |
| `gtd_project` | Multi-step projects |
| `gtd_waiting` | Waiting for items |
| `gtd_someday` | Someday/maybe items |
| `gtd_agenda` | Agenda items |
| `@computer` / `@phone` / `@home` / `@outside` | Context labels |
| `Person: John` | Person-specific labels for agenda items |

### Priority Mapping
| GTD Priority | Todoist Priority |
|--------------|------------------|
| today | p1 (highest) |
| this_week | p2 |
| soon | p3 |
| (none) | p4 (default) |

### Projects
Tasks are placed in the user's Inbox by default. The AI can route to specific projects based on context.

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db

# Redis
REDIS_URL=redis://localhost:6379

# Sendblue SMS
SENDBLUE_API_KEY=...
SENDBLUE_API_SECRET=...

# Todoist (for development/testing)
TODOIST_API_TOKEN=...

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
- [x] Todoist migration (replaced Notion)
- [x] LLM-driven intent system (35+ intents)
- [x] Fuzzy name matching with Levenshtein distance
- [x] Task editing commands (reschedule, rename, delete, etc.)
- [x] Follow-up questions for vague tasks
- [x] Scheduler app for daily digest/reminders
- [x] Conversation history for AI context (resolves "that", "it", "the first one")
- [x] Extraction mode for re-classification after clarification
- [x] Defensive title cleanup (removes "Let's", "I need to", etc.)
- [x] Auto-create people when user provides info about unknown person
- [x] Professional WAITING task titles (e.g., "Person to deliver X")
- [x] Context guidance in prompt (calls for quick phone tasks, computer for dense work)
- [x] Required context/priority with smart defaults (no null values)
- [x] Weekly review feature (scheduled SMS + interactive REVIEW command)
- [x] Batch operations with confirmation flow

### Classifier Modes
The classifier has two modes (passed as 5th parameter):
- `'classify'` (default) - Normal classification, may return `needs_clarification`
- `'extract'` - Used after user clarification, ALWAYS returns task type, extracts all fields

This prevents re-classification from returning `needs_clarification` with undefined fields.

### Title Cleanup
The `cleanupTaskTitle()` function in `classifier.ts` defensively strips casual prefixes:
- "Let's ask Sam..." → "Ask Sam..."
- "I need to call dentist" → "Call dentist"
- "Can you add..." → removes prefix

Applied in `normalizeTaskResult()` even if LLM ignores prompt instructions.

### Known Issues
1. Legacy Notion columns still in database (kept for data preservation)

### TODOs
- [ ] Implement Todoist OAuth flow for multi-user support
- [ ] Add two-way sync (Todoist changes → local DB)
- [ ] Project health tracking
- [ ] Implement `change_task_type` (needs last task tracking)
- [ ] Add conversation state for post-meeting flow

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
pnpm --filter @gtd/api dev

# Start Worker
pnpm --filter @gtd/worker dev

# Build all
pnpm build
```

## Adding a New User

```sql
INSERT INTO users (
  phone_number, status, todoist_access_token,
  timezone, digest_time
) VALUES (
  '+15551234567', 'active', 'your_todoist_api_token',
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
pnpm --filter @gtd/worker dev

# Push database schema
cd packages/database && DATABASE_URL="..." pnpm drizzle-kit push

# View Railway logs
railway logs
```

---

*Last updated: January 20, 2026 (Todoist migration - replaced Notion with Todoist REST API)*
