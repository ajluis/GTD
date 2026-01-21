# GTD - Project Context

> A GTD (Getting Things Done) assistant that works via SMS, using AI to manage tasks directly in Todoist (source of truth).

**IMPORTANT:** Update this file before every `git push` to keep context current for future sessions.

## Overview

GTD is an SMS-based task management system. Users text tasks to a phone number, and a UnifiedAgent (powered by Gemini) classifies messages, executes actions using 23 specialized tools, and manages tasks directly in Todoist (the source of truth).

**Core Flow:**
```
User texts SMS → Sendblue webhook → Redis queue → UnifiedAgent:
  1. Load context (preferences, learned patterns)
  2. Retrieve relevant memories
  3. Run agent loop with tools (max 5 iterations)
  4. Tools query/update Todoist directly (source of truth)
  5. Send confirmation SMS back
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
│   ├── worker/           # BullMQ job processor (runs UnifiedAgent)
│   └── scheduler/        # Cron jobs (daily digest, reminders)
├── packages/
│   ├── ai/               # UnifiedAgent + tool system + Gemini client
│   ├── mcp/              # MCP client for Todoist integration
│   ├── context/          # User context management (preferences, patterns)
│   ├── memory/           # Long-term memory & learning (corrections → patterns)
│   ├── database/         # Drizzle schema + client
│   ├── gtd/              # GTD formatters + command parsing
│   ├── todoist/          # Todoist REST API client (source of truth)
│   ├── queue/            # BullMQ queue definitions
│   ├── sendblue/         # Sendblue SMS client
│   └── shared-types/     # TypeScript types shared across packages
├── Dockerfile            # Multi-stage Docker build
├── Dockerfile.worker     # Worker-specific Dockerfile for Railway
└── turbo.json            # Turborepo config
```

## Key Files

### UnifiedAgent System
> **Note:** The AI system uses a unified agent architecture with tool-based execution.
- `packages/ai/src/unified-agent.ts` - Main agent orchestrator
  - Loads context, retrieves memories, runs agent loop
  - Handles tool execution and response generation
- `packages/ai/src/agent/loop.ts` - Multi-turn agent loop
  - Max 5 iterations with graceful fallbacks
  - Robust response parsing (handles JSON arrays, objects, plain text)
- `packages/ai/src/agent/prompts.ts` - System prompts for the agent
- `packages/ai/src/agent/context.ts` - Agent context building
- `packages/ai/src/tools/` - Specialized tools organized by function:
  - `lookup/` - Query tools (getTasks, searchTasks, etc.)
  - `actions/` - Modification tools (createTask, completeTask, etc.)
  - `types.ts` - Tool type definitions
  - `executor.ts` - Tool execution engine

### Context & Memory
- `packages/context/src/index.ts` - Context loader
  - User preferences (label mappings, project defaults)
  - Learned patterns (word associations from corrections)
  - Session state (recent tasks, active people)
- `packages/memory/src/index.ts` - Memory system
  - Stores relevant past interactions
  - Correction patterns become learning (user corrections → future defaults)

### Message Processing
- `apps/worker/src/processors/classify.ts` - Main message processor
  - Fetches conversation history
  - Invokes UnifiedAgent with context
  - Handles response and sends SMS

### Todoist Integration (Source of Truth)
> **Important:** Todoist is the single source of truth for all task data. No local task sync - tools query Todoist directly.
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
- `packages/mcp/` - MCP client for structured Todoist tool interactions

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
- [x] **UnifiedAgent architecture** - Tool-based agent with 23 specialized tools
- [x] **Todoist as source of truth** - No local task sync, direct API queries
- [x] **Context system** (@gtd/context) - User preferences, learned patterns
- [x] **Memory system** (@gtd/memory) - Correction learning, relevant retrieval
- [x] **MCP package** (@gtd/mcp) - Structured Todoist tool interactions
- [x] **Robust response parsing** - Handles JSON arrays, objects, plain text from Gemini
- [x] Fuzzy name matching with Levenshtein distance
- [x] Task editing commands (reschedule, rename, delete, etc.)
- [x] Follow-up questions for vague tasks
- [x] Scheduler app for daily digest/reminders
- [x] Conversation history for AI context (resolves "that", "it", "the first one")
- [x] Defensive title cleanup (removes "Let's", "I need to", etc.)
- [x] Auto-create people when user provides info about unknown person
- [x] Professional WAITING task titles (e.g., "Person to deliver X")
- [x] Context guidance in prompt (calls for quick phone tasks, computer for dense work)
- [x] Weekly review feature (scheduled SMS + interactive REVIEW command)

### Agent Architecture Details
The UnifiedAgent replaces the old intent-based handler system:
- **Agent Loop**: Up to 5 iterations with tool calls
- **Response Parsing**: Handles multiple JSON formats from Gemini (arrays, objects, wrapped objects)
- **Tool System**: 23 tools across categories (lookup, action, people, settings)
- **Graceful Fallbacks**: Falls back to text response if parsing fails

### Known Issues
1. Legacy Notion columns still in database (kept for data preservation)
2. MCP client initialization can be slow on cold starts

### TODOs
- [ ] Implement Todoist OAuth flow for multi-user support
- [ ] Project health tracking
- [ ] Improve cold start performance for MCP client
- [ ] Add more learning signals to memory system

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

*Last updated: January 20, 2026 (UnifiedAgent architecture, Todoist as source of truth, added mcp/context/memory packages)*
