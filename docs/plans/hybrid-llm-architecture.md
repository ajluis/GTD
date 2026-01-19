# Hybrid LLM Architecture

## Overview

The hybrid approach keeps the **fast, single-call classification** for simple operations while adding **tool-based lookups** only when dynamic data is needed. This gives the benefits of agentic architecture without the latency/cost penalty for common operations.

---

## Architecture Comparison

### Current: Everything Pre-Fetched

```
Message → Fetch ALL data → Single LLM call → Route → Template response
          (people, history,
           settings, states)
```

**Problem:** Pre-fetching 500+ people for every message, even "show today"

### Full Agentic: Multiple Round-Trips

```
Message → LLM → Tool call → Execute → LLM → Tool call → Execute → LLM → Response
```

**Problem:** 3-5 LLM calls per message, high latency/cost

### Hybrid: Smart Routing

```
                    ┌─────────────────────────┐
                    │                         │
Message ──────────▶ │  Fast Classification    │ ──▶ Simple intent? ──▶ Execute directly
                    │  (minimal context)      │           │
                    │                         │           │ No
                    └─────────────────────────┘           ▼
                                                  ┌───────────────┐
                                                  │ Tool-enabled  │
                                                  │ LLM call with │──▶ Response
                                                  │ data lookups  │
                                                  └───────────────┘
```

---

## How It Works

### Step 1: Fast Classification (Always)

A lightweight first LLM call that only receives:
- The message text
- User's timezone
- Last 2-3 messages (for context, not full 10)

**Output:** Classification with `needsDataLookup: boolean`

```typescript
interface HybridClassification {
  // Standard classification fields
  type: 'intent' | 'task' | 'needs_clarification' | 'unknown';
  intent?: IntentType;
  confidence: number;

  // NEW: Does this need dynamic data?
  needsDataLookup: boolean;

  // If needsDataLookup is false, we have everything we need
  taskCapture?: {
    title: string;
    type: TaskType;
    context?: Context;
    priority?: Priority;
    dueDate?: string;
    personName?: string;  // Raw name, not ID
  };

  // If needsDataLookup is true, what data is needed?
  requiredLookups?: Array<
    | { type: 'tasks'; filter: TaskFilter }
    | { type: 'people'; query: string }
    | { type: 'person_agenda'; personName: string }
    | { type: 'notion_query'; queryType: string }
  >;
}
```

### Step 2: Route Based on Classification

```typescript
async function processMessage(message: string, userId: string) {
  // Step 1: Fast classify (minimal context)
  const classification = await fastClassify(message, userId);

  // Step 2: Route based on complexity
  if (!classification.needsDataLookup) {
    // FAST PATH: Direct execution
    return handleDirectly(classification, userId);
  } else {
    // SLOW PATH: Tool-enabled processing
    return handleWithTools(message, classification, userId);
  }
}
```

### Step 3a: Fast Path (No Data Lookup Needed)

These operations execute immediately without additional LLM calls:

| Intent | What Happens |
|--------|--------------|
| Task capture | Create task directly (resolve person name later) |
| `query_today` | Direct Notion query, template response |
| `query_actions` | Direct Notion query, template response |
| `complete_recent` | Complete last task, template response |
| `set_timezone` | Update setting, template response |
| `show_help` | Return help text |

**Example: Task Capture**
```
User: "Call mom tomorrow"

Fast Classification:
{
  type: 'task',
  needsDataLookup: false,
  taskCapture: {
    title: "Call mom",
    type: "action",
    dueDate: "2026-01-20",
    personName: "mom"  // Will resolve to person ID in worker
  }
}

→ Create task immediately
→ Async worker resolves "mom" → person ID (or creates person)
→ Template response: "✅ Captured: Call mom (due tomorrow)"
```

### Step 3b: Slow Path (Needs Data Lookup)

These operations require a second LLM call with tools:

| Scenario | Why Tools Needed |
|----------|------------------|
| `query_person_agenda` with ambiguous name | Need to search people |
| `complete_task` with partial title | Need to find matching tasks |
| Complex query ("tasks for John due this week") | Dynamic filter building |
| Bulk operations | Need to enumerate items first |

**Example: Ambiguous Person Query**
```
User: "What's on my list for Mike?"

Fast Classification:
{
  type: 'intent',
  intent: 'query_person_agenda',
  needsDataLookup: true,
  requiredLookups: [
    { type: 'people', query: 'Mike' }
  ]
}

→ Tool-enabled LLM call
→ LLM calls: lookup_people("Mike")
→ Worker returns: [{ id: "123", name: "Mike Smith" }, { id: "456", name: "Mike Jones" }]
→ LLM sees multiple matches → asks for clarification OR picks best match
→ LLM generates response
```

---

## Detailed Flow Diagrams

### Fast Path: Simple Task Capture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  User: "Buy groceries @errands"                                     │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ FAST CLASSIFY (1 LLM call, ~500ms)                            │  │
│  │                                                                │  │
│  │ Input:                                                         │  │
│  │   - message: "Buy groceries @errands"                         │  │
│  │   - timezone: "America/New_York"                              │  │
│  │   - currentTime: "2026-01-19 10:30 AM"                        │  │
│  │                                                                │  │
│  │ Output:                                                        │  │
│  │   {                                                            │  │
│  │     type: "task",                                              │  │
│  │     needsDataLookup: false,                                   │  │
│  │     taskCapture: {                                             │  │
│  │       title: "Buy groceries",                                  │  │
│  │       type: "action",                                          │  │
│  │       context: "errands"                                       │  │
│  │     }                                                          │  │
│  │   }                                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ DIRECT EXECUTION (no additional LLM)                          │  │
│  │                                                                │  │
│  │ 1. Insert task into DB                                         │  │
│  │ 2. Queue Notion sync                                           │  │
│  │ 3. Return template response                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  Response: "✅ Captured: Buy groceries (@errands)"                  │
│                                                                      │
│  Total time: ~800ms                                                  │
│  LLM calls: 1                                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Fast Path: Simple Query

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  User: "What's due today?"                                          │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ FAST CLASSIFY                                                  │  │
│  │                                                                │  │
│  │ Output:                                                        │  │
│  │   {                                                            │  │
│  │     type: "intent",                                            │  │
│  │     intent: "query_today",                                     │  │
│  │     needsDataLookup: false  // We know exactly what to query  │  │
│  │   }                                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ DIRECT EXECUTION                                               │  │
│  │                                                                │  │
│  │ 1. queryTasksDueToday(notion, dbId, timezone)                  │  │
│  │ 2. Format with template                                        │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  Response:                                                           │
│  "🔥 TODAY:                                                          │
│   • Call dentist                                                     │
│   • Submit expense report                                            │
│   • Review PR #123"                                                  │
│                                                                      │
│  Total time: ~1.2s                                                   │
│  LLM calls: 1                                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Slow Path: Ambiguous Query

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  User: "Complete the design task"                                   │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ FAST CLASSIFY                                                  │  │
│  │                                                                │  │
│  │ Output:                                                        │  │
│  │   {                                                            │  │
│  │     type: "intent",                                            │  │
│  │     intent: "complete_task",                                   │  │
│  │     needsDataLookup: true,  // "design task" is ambiguous     │  │
│  │     requiredLookups: [                                         │  │
│  │       { type: "tasks", filter: { search: "design" } }         │  │
│  │     ]                                                          │  │
│  │   }                                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ TOOL-ENABLED LLM CALL                                          │  │
│  │                                                                │  │
│  │ System: "You have access to these tools: lookup_tasks, ..."   │  │
│  │ User: "Complete the design task"                               │  │
│  │                                                                │  │
│  │ LLM: lookup_tasks({ search: "design", status: "active" })     │  │
│  │                                                                │  │
│  │ Tool Result:                                                   │  │
│  │   [                                                            │  │
│  │     { id: "abc", title: "Design homepage mockup" },           │  │
│  │     { id: "def", title: "Design API schema" },                │  │
│  │     { id: "ghi", title: "Review design feedback" }            │  │
│  │   ]                                                            │  │
│  │                                                                │  │
│  │ LLM: "I found 3 design tasks. Which one?"                     │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  Response:                                                           │
│  "I found 3 tasks matching 'design':                                │
│   1. Design homepage mockup                                          │
│   2. Design API schema                                               │
│   3. Review design feedback                                          │
│                                                                      │
│   Which one did you complete? (Reply with number)"                  │
│                                                                      │
│  Total time: ~3s                                                     │
│  LLM calls: 2                                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Slow Path: Complex Dynamic Query

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  User: "What do I need to discuss with Sarah before Friday?"        │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ FAST CLASSIFY                                                  │  │
│  │                                                                │  │
│  │ Output:                                                        │  │
│  │   {                                                            │  │
│  │     type: "intent",                                            │  │
│  │     intent: "query_person_agenda",                             │  │
│  │     needsDataLookup: true,                                    │  │
│  │     requiredLookups: [                                         │  │
│  │       { type: "people", query: "Sarah" },                     │  │
│  │       { type: "person_agenda", personName: "Sarah",           │  │
│  │         filter: { dueBefore: "2026-01-24" } }                 │  │
│  │     ]                                                          │  │
│  │   }                                                            │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ TOOL-ENABLED LLM CALL                                          │  │
│  │                                                                │  │
│  │ LLM: lookup_people({ query: "Sarah" })                        │  │
│  │ Result: [{ id: "123", name: "Sarah Chen" }]                   │  │
│  │                                                                │  │
│  │ LLM: lookup_person_agenda({                                    │  │
│  │   personId: "123",                                             │  │
│  │   dueBefore: "2026-01-24"                                      │  │
│  │ })                                                             │  │
│  │ Result: [                                                      │  │
│  │   { title: "Discuss Q2 budget", dueDate: "2026-01-22" },      │  │
│  │   { title: "Review project timeline", dueDate: null }         │  │
│  │ ]                                                              │  │
│  │                                                                │  │
│  │ LLM generates natural response with context                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                          │
│                           ▼                                          │
│  Response:                                                           │
│  "You have 2 items to discuss with Sarah Chen before Friday:        │
│                                                                      │
│   • Discuss Q2 budget (due Wed)                                      │
│   • Review project timeline                                          │
│                                                                      │
│   Her next scheduled meeting is Tuesday."                           │
│                                                                      │
│  Total time: ~4s                                                     │
│  LLM calls: 2                                                        │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Changes

### 1. New Classifier Mode

```typescript
// packages/ai/src/classifier.ts

interface FastClassifyOptions {
  message: string;
  timezone: string;
  currentTime: Date;
  recentContext?: string[];  // Last 2-3 messages only
}

interface FastClassifyResult {
  type: 'intent' | 'task' | 'needs_clarification' | 'unknown';
  intent?: IntentType;
  confidence: number;
  needsDataLookup: boolean;

  // For direct execution (when needsDataLookup = false)
  taskCapture?: TaskCaptureData;
  intentEntities?: IntentEntities;

  // For tool-enabled path (when needsDataLookup = true)
  requiredLookups?: LookupRequest[];
}

// NEW: Lightweight classification without people list
async function fastClassify(options: FastClassifyOptions): Promise<FastClassifyResult> {
  const prompt = buildFastClassifyPrompt(options);
  return gemini.generateJSON<FastClassifyResult>(prompt, FAST_CLASSIFY_SYSTEM);
}
```

### 2. Tool Definitions

```typescript
// packages/ai/src/tools/index.ts

export const tools: Tool[] = [
  {
    name: 'lookup_people',
    description: 'Search for people by name. Returns matching contacts.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or partial name to search' },
        limit: { type: 'number', default: 5 }
      },
      required: ['query']
    }
  },
  {
    name: 'lookup_tasks',
    description: 'Search for tasks with filters.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Text to search in task titles' },
        type: { type: 'string', enum: ['action', 'project', 'waiting', 'someday', 'agenda'] },
        status: { type: 'string', enum: ['active', 'completed'] },
        context: { type: 'string', enum: ['computer', 'phone', 'home', 'outside'] },
        personId: { type: 'string' },
        dueBefore: { type: 'string', format: 'date' },
        dueAfter: { type: 'string', format: 'date' },
        limit: { type: 'number', default: 10 }
      }
    }
  },
  {
    name: 'lookup_person_agenda',
    description: 'Get agenda items for a specific person.',
    parameters: {
      type: 'object',
      properties: {
        personId: { type: 'string', description: 'Person ID from lookup_people' },
        includeCompleted: { type: 'boolean', default: false }
      },
      required: ['personId']
    }
  },
  {
    name: 'complete_task',
    description: 'Mark a task as complete.',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID from lookup_tasks' }
      },
      required: ['taskId']
    }
  },
  {
    name: 'create_task',
    description: 'Create a new task.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        type: { type: 'string', enum: ['action', 'project', 'waiting', 'someday', 'agenda'] },
        context: { type: 'string', enum: ['computer', 'phone', 'home', 'outside'] },
        priority: { type: 'string', enum: ['today', 'this_week', 'soon'] },
        dueDate: { type: 'string', format: 'date' },
        personId: { type: 'string' }
      },
      required: ['title', 'type']
    }
  }
];
```

### 3. Updated Processor

```typescript
// apps/worker/src/processors/classify.ts

export function createClassifyProcessor(db: DbClient, messageQueue: Queue) {
  return async (job: Job<ClassifyJobData>) => {
    const { userId, messageId, content } = job.data;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });

    // STEP 1: Fast classification (no people list needed)
    const classification = await fastClassify({
      message: content,
      timezone: user.timezone,
      currentTime: new Date(),
      recentContext: await getRecentContext(db, userId, 3)
    });

    // STEP 2: Route based on complexity
    let response: string;

    if (!classification.needsDataLookup) {
      // FAST PATH
      response = await handleDirectExecution(classification, user, db, messageQueue);
    } else {
      // SLOW PATH: Tool-enabled
      response = await handleWithTools(content, classification, user, db);
    }

    // STEP 3: Send response
    await enqueueOutboundMessage(messageQueue, {
      userId,
      toNumber: user.phoneNumber,
      content: response,
      inReplyTo: messageId
    });
  };
}

async function handleDirectExecution(
  classification: FastClassifyResult,
  user: User,
  db: DbClient,
  messageQueue: Queue
): Promise<string> {

  if (classification.type === 'task' && classification.taskCapture) {
    // Direct task creation - resolve person name asynchronously
    const task = classification.taskCapture;

    // If there's a person name, try to resolve it
    let personId: string | null = null;
    if (task.personName) {
      personId = await resolvePersonName(db, user.id, task.personName);
    }

    // Create task
    const [created] = await db.insert(tasks).values({
      userId: user.id,
      title: task.title,
      type: task.type,
      context: task.context,
      priority: task.priority,
      dueDate: task.dueDate,
      personId,
      status: 'pending'
    }).returning();

    // Queue Notion sync
    await enqueueNotionSync(messageQueue, { userId: user.id, taskId: created.id });

    return formatTaskCapture(task.title, task.type, task.context, task.priority, task.dueDate);
  }

  if (classification.type === 'intent') {
    // Direct intent execution (existing handlers)
    return await handleIntent(classification.intent, classification.intentEntities, user, db);
  }

  return formatHelp();
}

async function handleWithTools(
  message: string,
  classification: FastClassifyResult,
  user: User,
  db: DbClient
): Promise<string> {

  // Create tool execution context
  const toolContext: ToolContext = {
    userId: user.id,
    notionClient: user.notionAccessToken
      ? createNotionClient(user.notionAccessToken)
      : null,
    db
  };

  // Run agent loop with tools
  const result = await runAgentLoop({
    message,
    tools: getToolsForIntent(classification.intent),
    context: toolContext,
    systemPrompt: TOOL_AGENT_SYSTEM_PROMPT,
    maxIterations: 3
  });

  return result.response;
}
```

### 4. Prompt Changes

```typescript
// packages/ai/src/prompts/fast-classify.ts

export const FAST_CLASSIFY_SYSTEM = `You are a GTD task classifier.

Your job is to quickly classify user messages and determine if additional data lookups are needed.

IMPORTANT: You do NOT have access to the user's people list or task list.
You must determine if the message requires looking up this data.

## When needsDataLookup should be FALSE:

1. Simple task capture: "Buy milk", "Call mom tomorrow", "Project: redesign website"
   → Can create task directly, person names resolved later

2. Simple queries with clear targets:
   - "What's due today?" → query_today
   - "Show my actions" → query_actions
   - "Show projects" → query_projects

3. Settings changes: "Set timezone to PST"

4. Help requests: "help", "what can you do?"

## When needsDataLookup should be TRUE:

1. Person-specific queries where person might not exist:
   - "What's on my agenda for Mike?" → need to find Mike first

2. Task completion with partial match:
   - "Done with the design task" → need to search tasks

3. Complex/compound queries:
   - "Show tasks for Sarah due this week" → need person + filtered tasks

4. Bulk operations:
   - "Complete all my errands tasks" → need to enumerate first

Return JSON with this structure:
{
  "type": "intent" | "task" | "needs_clarification" | "unknown",
  "intent": "intent_name if type=intent",
  "confidence": 0.0-1.0,
  "needsDataLookup": true/false,
  "taskCapture": { ... } // if type=task and needsDataLookup=false
  "intentEntities": { ... } // if type=intent and needsDataLookup=false
  "requiredLookups": [ ... ] // if needsDataLookup=true
}`;
```

---

## What Changes vs Current

| Component | Current | Hybrid |
|-----------|---------|--------|
| **Classifier prompt** | Includes full people list (500+ entries) | No people list, just message + timezone |
| **Classification output** | Task details + person match | Task details + `needsDataLookup` flag |
| **Person matching** | In LLM prompt | Deferred to worker (fast path) or tools (slow path) |
| **Query execution** | After classification, in intent handlers | Direct (fast) or via tools (slow) |
| **Response generation** | Templates only | Templates (fast) or LLM (slow) |
| **LLM calls** | 1 per message | 1 (fast path) or 2 (slow path) |

---

## Expected Performance

| Message Type | Current | Hybrid | Improvement |
|--------------|---------|--------|-------------|
| Simple task capture | ~2s | ~1s | 50% faster (smaller prompt) |
| "Show today" | ~2s | ~1.2s | 40% faster |
| "What's on Mike's agenda?" | ~2s | ~3s | Slower but more accurate |
| Complex query | ~2s + follow-up | ~4s one-shot | Better UX |

**Overall:**
- 80% of messages take the fast path (faster than current)
- 20% of messages take the slow path (slightly slower, but more capable)

---

## Migration Path

### Phase 1: Add Fast Classify
1. Create new `fastClassify()` function alongside existing `classify()`
2. Run both in shadow mode, compare outputs
3. Validate `needsDataLookup` accuracy

### Phase 2: Implement Fast Path
1. Route messages with `needsDataLookup=false` to new direct execution
2. Keep existing flow for `needsDataLookup=true` temporarily
3. Measure latency improvement

### Phase 3: Add Tool-Enabled Path
1. Implement tool definitions
2. Create agent loop for slow path
3. Replace existing intent handlers one by one

### Phase 4: Remove Legacy Code
1. Delete old classification prompt (with full people list)
2. Remove redundant intent handlers
3. Clean up conversation_states usage

---

## File Changes Summary

| File | Change |
|------|--------|
| `packages/ai/src/classifier.ts` | Add `fastClassify()` function |
| `packages/ai/src/prompts/fast-classify.ts` | New lightweight prompt |
| `packages/ai/src/tools/` | New directory with tool definitions |
| `packages/ai/src/agent.ts` | New agent loop for tool execution |
| `apps/worker/src/processors/classify.ts` | Route between fast/slow paths |
| `apps/worker/src/handlers/intents.ts` | Simplify, some become tool handlers |

---

## Decision: LLM-Generated vs Template Responses

The hybrid approach supports **both**:

```typescript
// Fast path: Always use templates (predictable, tested)
if (!classification.needsDataLookup) {
  return formatTaskCapture(...);  // Template
}

// Slow path: Option to use LLM-generated
if (useNaturalResponses) {
  return agentResult.response;  // LLM-generated
} else {
  return formatFromAgentResult(agentResult);  // Template from LLM data
}
```

**Recommendation:** Start with templates everywhere, add LLM responses as opt-in feature later.
