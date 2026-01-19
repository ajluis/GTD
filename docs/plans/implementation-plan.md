# Hybrid LLM Architecture - Implementation Plan

## Overview

This document outlines the implementation plan for the hybrid LLM architecture with all conversational features.

---

## Architecture Components

### 1. Core Infrastructure

```
packages/ai/
├── src/
│   ├── tools/
│   │   ├── index.ts              # Tool registry & types
│   │   ├── types.ts              # Tool interfaces
│   │   ├── executor.ts           # Safe tool execution
│   │   ├── lookup/
│   │   │   ├── people.ts         # lookup_people
│   │   │   ├── tasks.ts          # lookup_tasks
│   │   │   ├── messages.ts       # lookup_messages
│   │   │   └── settings.ts       # get_user_settings
│   │   └── actions/
│   │       ├── tasks.ts          # create/update/complete/delete task
│   │       ├── people.ts         # create/update person
│   │       └── batch.ts          # batch operations
│   ├── agent/
│   │   ├── loop.ts               # Agent execution loop
│   │   ├── context.ts            # Conversation context tracking
│   │   └── prompts.ts            # Agent system prompts
│   ├── classifier/
│   │   ├── fast.ts               # Fast classifier (minimal context)
│   │   └── prompts.ts            # Fast classify prompts
│   └── index.ts                  # Updated exports
```

### 2. Database Changes

```sql
-- New table for conversation context (replaces conversation_states)
CREATE TABLE conversation_context (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),

  -- Last referenced entities (for "the first one", "that task", etc.)
  last_tasks JSONB DEFAULT '[]',
  last_people JSONB DEFAULT '[]',
  last_created_task_id UUID,

  -- Undo stack
  undo_stack JSONB DEFAULT '[]',

  -- Active flow (weekly review, bulk operation, etc.)
  active_flow VARCHAR(50),
  flow_state JSONB,

  -- Timestamps
  updated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);
```

---

## Feature Implementation Matrix

| # | Feature | Tools Required | Priority | Complexity |
|---|---------|---------------|----------|------------|
| 0 | Meeting Brain Dump | batch_create_tasks | P0 | Medium |
| 1 | Natural Language Queries | lookup_tasks, lookup_people | P0 | Medium |
| 2 | Contextual Follow-ups | context tracking + all tools | P0 | High |
| 3 | Smart Task Editing | update_task, change_task_type | P1 | Low |
| 4 | Undo & Corrections | undo_last_action | P0 | Medium |
| 5 | Bulk Operations | bulk_complete, bulk_delete | P1 | Medium |
| 6 | Cross-Entity Queries | lookup_tasks + lookup_people | P2 | Medium |
| 7 | Proactive Suggestions | lookup_schedule, lookup_tasks | P2 | High |
| 8 | Weekly Review Assistant | multiple lookups + flow state | P1 | High |
| 9 | Delegation & Handoff | update_task, create_person | P3 | Medium |
| 10 | Natural Capture w/ Clarification | create_task + context | P0 | Medium |
| 11 | Statistics & Insights | get_stats, lookup_task_history | P2 | Medium |
| 12 | Context-Aware Recommendations | lookup_tasks + time context | P2 | Medium |

---

## Implementation Phases

### Phase 1: Core Infrastructure (Foundation)

**Goal:** Build the tool system and agent loop

#### 1.1 Tool Types & Registry
```typescript
// packages/ai/src/tools/types.ts
export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  userId: string;
  db: DbClient;
  notionClient: NotionClient | null;
  conversationContext: ConversationContext;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  // For undo support
  undoAction?: UndoAction;
}
```

#### 1.2 Tool Executor
```typescript
// packages/ai/src/tools/executor.ts
export async function executeTool(
  tool: Tool,
  params: unknown,
  context: ToolContext
): Promise<ToolResult> {
  // Validate params against schema
  // Execute with error handling
  // Track for undo if applicable
  // Update conversation context
}
```

#### 1.3 Agent Loop
```typescript
// packages/ai/src/agent/loop.ts
export async function runAgentLoop(options: {
  message: string;
  tools: Tool[];
  context: ToolContext;
  systemPrompt: string;
  maxIterations?: number;
}): Promise<AgentResult> {
  // Initialize conversation
  // Loop: LLM call → tool execution → repeat
  // Return final response
}
```

### Phase 2: Lookup Tools (Read Operations)

#### 2.1 lookup_people
```typescript
{
  name: 'lookup_people',
  description: 'Search contacts by name or criteria',
  parameters: {
    query?: string,      // Name search
    meetingDay?: string, // Filter by meeting day
    limit?: number       // Max results (default 10)
  }
}
```

#### 2.2 lookup_tasks
```typescript
{
  name: 'lookup_tasks',
  description: 'Query tasks with filters',
  parameters: {
    search?: string,           // Text search in title
    type?: TaskType,           // action, project, waiting, etc.
    status?: 'active' | 'completed',
    context?: Context,         // computer, phone, home, outside
    personId?: string,         // Tasks for specific person
    dueBefore?: string,        // ISO date
    dueAfter?: string,         // ISO date
    createdAfter?: string,     // For "added last week"
    limit?: number
  }
}
```

#### 2.3 lookup_messages
```typescript
{
  name: 'lookup_messages',
  description: 'Get conversation history',
  parameters: {
    limit?: number,     // Default 10
    before?: string     // ISO timestamp
  }
}
```

#### 2.4 get_user_settings
```typescript
{
  name: 'get_user_settings',
  description: 'Get user preferences and schedule',
  parameters: {} // No params needed
}
```

### Phase 3: Action Tools (Write Operations)

#### 3.1 create_task
```typescript
{
  name: 'create_task',
  description: 'Create a new task',
  parameters: {
    title: string,
    type: TaskType,
    context?: Context,
    priority?: Priority,
    dueDate?: string,
    personId?: string,
    personName?: string,  // Will resolve to ID
    notes?: string
  }
}
```

#### 3.2 batch_create_tasks
```typescript
{
  name: 'batch_create_tasks',
  description: 'Create multiple tasks from brain dump',
  parameters: {
    tasks: Array<{
      title: string,
      type: TaskType,
      context?: Context,
      priority?: Priority,
      dueDate?: string,
      personName?: string
    }>
  }
}
```

#### 3.3 update_task
```typescript
{
  name: 'update_task',
  description: 'Update an existing task',
  parameters: {
    taskId: string,
    title?: string,
    type?: TaskType,
    context?: Context,
    priority?: Priority,
    dueDate?: string,
    personId?: string,
    notes?: string
  }
}
```

#### 3.4 complete_task
```typescript
{
  name: 'complete_task',
  description: 'Mark a task as complete',
  parameters: {
    taskId: string
  }
}
```

#### 3.5 delete_task
```typescript
{
  name: 'delete_task',
  description: 'Delete a task',
  parameters: {
    taskId: string
  }
}
```

#### 3.6 undo_last_action
```typescript
{
  name: 'undo_last_action',
  description: 'Undo the most recent action',
  parameters: {} // Uses context
}
```

### Phase 4: Fast Classifier

#### 4.1 Fast Classify Function
```typescript
// packages/ai/src/classifier/fast.ts
export async function fastClassify(options: {
  message: string;
  timezone: string;
  currentTime: Date;
  recentMessages?: string[];  // Last 2-3 only
}): Promise<FastClassifyResult> {
  // Lightweight classification without people list
  // Returns needsDataLookup flag
}
```

#### 4.2 Fast Classify Result
```typescript
interface FastClassifyResult {
  type: 'intent' | 'task' | 'multi_item' | 'needs_clarification' | 'unknown';
  needsDataLookup: boolean;

  // For direct execution
  intent?: IntentType;
  taskCapture?: TaskCaptureData;
  items?: TaskCaptureData[];  // For multi-item

  // For tool-enabled path
  requiredLookups?: LookupRequest[];
}
```

### Phase 5: Hybrid Processor

#### 5.1 Updated Classify Processor
```typescript
// apps/worker/src/processors/classify.ts
export function createClassifyProcessor(db, messageQueue) {
  return async (job) => {
    const { userId, messageId, content } = job.data;

    // 1. Fast classify
    const classification = await fastClassify({...});

    // 2. Route
    if (classification.type === 'multi_item') {
      return handleMultiItem(classification, ...);
    }

    if (!classification.needsDataLookup) {
      return handleDirectExecution(classification, ...);
    }

    return handleWithTools(content, classification, ...);
  };
}
```

### Phase 6: Conversation Context

#### 6.1 Context Schema
```typescript
interface ConversationContext {
  userId: string;

  // Entity references
  lastTasks: Array<{ id: string; title: string }>;
  lastPeople: Array<{ id: string; name: string }>;
  lastCreatedTaskId?: string;

  // Undo stack (last 5 actions)
  undoStack: UndoAction[];

  // Flow state
  activeFlow?: 'weekly_review' | 'bulk_confirm' | 'clarification';
  flowState?: any;
}
```

#### 6.2 Context Manager
```typescript
// packages/ai/src/agent/context.ts
export class ConversationContextManager {
  async get(userId: string): Promise<ConversationContext>;
  async update(userId: string, updates: Partial<ConversationContext>): Promise<void>;
  async pushUndo(userId: string, action: UndoAction): Promise<void>;
  async popUndo(userId: string): Promise<UndoAction | null>;
  async setLastTasks(userId: string, tasks: TaskRef[]): Promise<void>;
}
```

---

## Feature Implementation Details

### Feature 0: Meeting Brain Dump

**Trigger:** Multi-line message or bullet points detected

**Flow:**
1. Fast classifier detects `type: 'multi_item'`
2. For each item, classify independently
3. Create all tasks via `batch_create_tasks`
4. If any items ambiguous, ask targeted questions
5. Return summary of all created items

**Example prompt addition:**
```
MULTI-ITEM DETECTION:

If message contains multiple items (bullets, line breaks, "also", "and"),
return type: "multi_item" with items array.

For each item, determine type independently.
Flag ambiguous items with needsClarification: true.
```

### Feature 1: Natural Language Queries

**Trigger:** Query-like message needing dynamic data

**Flow:**
1. Fast classifier detects query intent with `needsDataLookup: true`
2. Agent loop with lookup tools
3. LLM formulates query, executes tools, generates response

**Examples:**
- "What did I add last week?" → `lookup_tasks({ createdAfter: "..." })`
- "Tasks for John due this week" → `lookup_people` + `lookup_tasks`

### Feature 2: Contextual Follow-ups

**Trigger:** Reference to previous items ("that", "first one", etc.)

**Flow:**
1. Context manager provides `lastTasks`, `lastPeople`
2. LLM resolves references using context
3. Executes appropriate action

**Key:** System prompt includes conversation context

### Feature 3: Smart Task Editing

**Trigger:** Edit intent detected

**Flow:**
1. If task reference ambiguous → `lookup_tasks` to find
2. Execute `update_task` with changes
3. Push to undo stack

### Feature 4: Undo & Corrections

**Trigger:** "undo", "never mind", "wrong person"

**Flow:**
1. Pop from undo stack
2. Execute reverse action
3. Confirm to user

**Undo Action Types:**
```typescript
type UndoAction =
  | { type: 'delete_task'; taskId: string; taskData: Task }
  | { type: 'restore_task'; taskId: string }
  | { type: 'update_task'; taskId: string; previousData: Partial<Task> }
  | { type: 'uncomplete_task'; taskId: string };
```

### Feature 5: Bulk Operations

**Trigger:** "complete all", "clear all", "delete old"

**Flow:**
1. Query items to be affected
2. Show confirmation with count
3. Store in `flowState` as `bulk_confirm`
4. On "yes", execute bulk operation

### Feature 6: Cross-Entity Queries

**Trigger:** Query spanning multiple entity types

**Flow:**
1. Execute multiple lookups
2. LLM aggregates and analyzes
3. Generates insight response

### Feature 7: Proactive Suggestions

**Trigger:** Task creation or completion

**Flow:**
1. After action, check for relevant context
2. If relevant info found, append suggestion
3. User can act on suggestion or ignore

### Feature 8: Weekly Review Assistant

**Trigger:** "weekly review", "let's review"

**Flow:**
1. Set `activeFlow: 'weekly_review'`
2. Guide through: Projects → Waiting → Someday → Calendar
3. Track progress in `flowState`
4. Allow exit at any point

### Feature 9: Delegation & Handoff

**Trigger:** "delegate to", "assign to"

**Flow:**
1. Find or create person
2. Update task type to "waiting"
3. Set person relationship

### Feature 10: Natural Capture with Clarification

**Trigger:** Vague task capture

**Flow:**
1. Create task with partial info
2. Ask targeted follow-up
3. On response, update task via context

### Feature 11: Statistics & Insights

**Trigger:** "how am I doing", "stats", "productivity"

**Flow:**
1. Query completion stats
2. Query task age/staleness
3. Generate insight summary

### Feature 12: Context-Aware Recommendations

**Trigger:** "I have 30 minutes", "what should I do"

**Flow:**
1. Query tasks by context and time estimate
2. Filter by priority
3. Suggest top options

---

## Agent System Prompt

```typescript
export const AGENT_SYSTEM_PROMPT = `You are a GTD assistant with access to tools.

CURRENT CONTEXT:
- User timezone: {{timezone}}
- Current time: {{currentTime}}
- Last referenced tasks: {{lastTasks}}
- Last referenced people: {{lastPeople}}

TOOLS AVAILABLE:
{{toolDescriptions}}

GUIDELINES:

1. MULTI-ITEM MESSAGES
   If user sends multiple items (bullets, line breaks, "also"), parse each separately.
   Create all tasks in one batch_create_tasks call.

2. CONTEXTUAL REFERENCES
   "that", "it", "the first one" → use lastTasks/lastPeople from context
   "them", "their agenda" → use lastPeople from context

3. CLARIFICATION
   Only ask if truly ambiguous. Prefer smart defaults.
   If asking, be specific about what you need.

4. RESPONSES
   Keep SMS-friendly (under 320 chars when possible).
   Use emojis sparingly: ✅ ⏳ 👤 📁 💭 🔥
   Confirm actions taken, don't repeat back verbatim.

5. UNDO SUPPORT
   After create/update/complete/delete, action is undoable.
   Tell user "undo" if they made a mistake.

6. ERROR HANDLING
   If tool fails, apologize briefly and suggest retry.
   Never expose technical errors to user.
`;
```

---

## Testing Strategy

### Unit Tests
- Each tool function
- Fast classifier accuracy
- Context manager operations
- Undo/redo logic

### Integration Tests
- Full message flow through classify processor
- Multi-item parsing and creation
- Contextual follow-ups
- Weekly review flow

### E2E Tests
- SMS → Response for all feature types
- Error recovery scenarios
- Concurrent message handling

---

## Rollout Plan

### Stage 1: Shadow Mode
- Run new classifier alongside old
- Log differences, don't affect production
- Measure accuracy and latency

### Stage 2: Feature Flag
- `HYBRID_ARCHITECTURE_ENABLED=true`
- Opt-in for testing users
- Monitor closely

### Stage 3: Gradual Rollout
- 10% → 50% → 100%
- Quick rollback capability
- Monitor error rates and latency

### Stage 4: Deprecation
- Remove old classifier
- Clean up conversation_states table
- Remove legacy intent handlers

---

## Railway Configuration

### Environment Variables (New)
```
# Feature flags
HYBRID_ARCHITECTURE_ENABLED=true

# Agent settings
AGENT_MAX_ITERATIONS=5
AGENT_MAX_TOKENS=2048

# Tool settings
TOOL_TIMEOUT_MS=10000
```

### Resource Considerations
- **Memory:** Agent loop may hold more context → monitor worker memory
- **Latency:** Multiple LLM calls → may need to increase timeouts
- **Costs:** More API calls → monitor Gemini usage

### No Infrastructure Changes Required
- Same worker architecture
- Same queue system
- Same database (minor schema addition)

---

## Files to Create/Modify

### New Files
```
packages/ai/src/tools/types.ts
packages/ai/src/tools/index.ts
packages/ai/src/tools/executor.ts
packages/ai/src/tools/lookup/people.ts
packages/ai/src/tools/lookup/tasks.ts
packages/ai/src/tools/lookup/messages.ts
packages/ai/src/tools/lookup/settings.ts
packages/ai/src/tools/actions/tasks.ts
packages/ai/src/tools/actions/people.ts
packages/ai/src/tools/actions/batch.ts
packages/ai/src/agent/loop.ts
packages/ai/src/agent/context.ts
packages/ai/src/agent/prompts.ts
packages/ai/src/classifier/fast.ts
packages/ai/src/classifier/prompts.ts
packages/database/src/schema/conversation-context.ts
```

### Modified Files
```
packages/ai/src/index.ts                    # Export new modules
packages/ai/src/gemini-client.ts            # Add tool calling support
apps/worker/src/processors/classify.ts      # Hybrid routing
packages/database/src/schema/index.ts       # Add conversation_context
```

### Deprecated (Phase 4)
```
packages/ai/src/prompts/classify-task.ts    # Old large prompt
apps/worker/src/handlers/intents.ts         # Most handlers
packages/database/src/schema/conversation-states.ts  # Replaced
```
