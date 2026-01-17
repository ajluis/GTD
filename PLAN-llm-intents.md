# LLM-Driven Intent Detection - Implementation Plan

## Overview
Transform Clarity from command-based to conversation-based by having the LLM understand user intent and route to appropriate actions.

## Architecture

```
User SMS → Classifier → Intent Detection → Action Handler → Response
                ↓
         [Task Capture still goes through existing classification]
```

### Key Principle
The classifier will detect TWO things:
1. **Task Capture** - User wants to create a new task (existing flow)
2. **Intent/Command** - User wants to DO something (query, edit, settings, etc.)

---

## Phase 1: Enhance Classifier for All Intents

### 1.1 Update Classification Types

**File:** `packages/shared-types/src/gtd.ts`

Add new classification types:
```typescript
export type ClassificationType =
  // Task capture (existing)
  | 'action' | 'project' | 'waiting' | 'someday' | 'agenda'
  // Intents (new)
  | 'intent'
  | 'unknown';

export type IntentType =
  // Queries
  | 'query_today' | 'query_actions' | 'query_projects'
  | 'query_waiting' | 'query_someday' | 'query_context'
  | 'query_people' | 'query_person_agenda'
  // Task completion
  | 'complete_task' | 'complete_recent' | 'complete_person_agenda'
  // People management
  | 'add_person' | 'remove_person' | 'set_alias' | 'set_schedule'
  // Settings
  | 'set_digest_time' | 'set_timezone' | 'set_reminder_hours'
  | 'pause_account' | 'resume_account' | 'show_settings'
  // Task editing
  | 'reschedule_task' | 'set_priority' | 'set_context'
  | 'add_note' | 'rename_task' | 'delete_task' | 'assign_person'
  // Corrections
  | 'undo_last' | 'change_type' | 'correct_person'
  // Bulk
  | 'clear_person_agenda' | 'complete_all_today'
  // Info
  | 'show_stats' | 'show_help';

export interface IntentResult {
  intent: IntentType;
  confidence: number;
  // Extracted entities
  entities: {
    taskText?: string;      // For task search
    personName?: string;    // For person operations
    newValue?: string;      // For updates (time, timezone, etc.)
    context?: TaskContext;  // For context operations
    priority?: TaskPriority;
    dueDate?: string;
    taskType?: TaskType;    // For type changes
  };
  reasoning?: string;
}
```

### 1.2 Update Classification Result

**File:** `packages/shared-types/src/gtd.ts`

```typescript
export interface ClassificationResult {
  // For task capture
  type: TaskType | 'intent' | 'unknown';
  title?: string;
  context?: TaskContext;
  priority?: TaskPriority;
  personMatch?: { personId: string; name: string; confidence: number; };
  dueDate?: string;
  confidence: number;
  reasoning?: string;

  // For intents (new)
  intent?: IntentResult;
}
```

---

## Phase 2: Update Classification Prompt

### 2.1 New Prompt Structure

**File:** `packages/ai/src/prompts/classify-task.ts`

The prompt should now:
1. First determine: Is this a TASK CAPTURE or an INTENT?
2. If TASK CAPTURE → existing classification flow
3. If INTENT → identify intent type and extract entities

Key intent categories to detect:

```
INTENT DETECTION (check BEFORE task capture):

1. QUERIES - User wants to SEE information
   Signals: "show me", "what's", "list", "how many", any question about tasks/people

2. COMPLETION - User wants to MARK something done
   Signals: "done", "finished", "completed", "crossed off", "that's done"

3. PEOPLE MANAGEMENT - User wants to MANAGE people
   Signals: "add person", "track", "remove", "stop tracking", "also goes by", "meets"

4. SETTINGS - User wants to CHANGE preferences
   Signals: "send digest at", "I'm in [timezone]", "remind me X hours", "pause", "resume"

5. TASK EDITING - User wants to MODIFY an existing task
   Signals: "move to", "change to", "make it", "rename", "delete", "add note"

6. CORRECTIONS - User wants to FIX a recent action
   Signals: "undo", "that's wrong", "should be", "I meant"

7. TASK CAPTURE (default) - User wants to CREATE a new task
   Signals: New actionable item, no reference to existing tasks
```

---

## Phase 3: Create Intent Handlers

### 3.1 New Intent Handler Module

**File:** `apps/worker/src/handlers/intents.ts`

```typescript
export async function handleIntent(
  intent: IntentResult,
  user: User,
  db: DbClient,
  messageQueue: Queue
): Promise<string> {
  switch (intent.intent) {
    // Queries
    case 'query_today': return handleQueryToday(user, db);
    case 'query_actions': return handleQueryActions(user, db);
    // ... etc

    // Completion
    case 'complete_task': return handleCompleteTask(intent.entities, user, db);

    // People
    case 'add_person': return handleAddPerson(intent.entities, user, db);

    // Settings
    case 'set_digest_time': return handleSetDigestTime(intent.entities, user, db);

    // Editing
    case 'reschedule_task': return handleRescheduleTask(intent.entities, user, db);

    // Corrections
    case 'undo_last': return handleUndo(user, db);

    default:
      return "I'm not sure what you'd like to do. Try rephrasing or text 'help'.";
  }
}
```

### 3.2 Individual Handler Functions

Each handler is a focused function:

```typescript
// Example: Set digest time
async function handleSetDigestTime(
  entities: IntentResult['entities'],
  user: User,
  db: DbClient
): Promise<string> {
  const timeStr = entities.newValue; // e.g., "7am", "07:00"

  // Parse time to HH:MM format
  const parsed = parseTimeString(timeStr);
  if (!parsed) {
    return "I couldn't understand that time. Try '7am' or '07:00'.";
  }

  // Update user
  await db.update(users)
    .set({ digestTime: parsed, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  return `✅ Daily digest will now arrive at ${formatTime(parsed)}.`;
}
```

---

## Phase 4: Add Undo Support

### 4.1 Action History Table

**File:** `packages/database/src/schema/action-history.ts`

```typescript
export const actionHistory = pgTable('action_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  actionType: text('action_type').notNull(), // 'task_created', 'task_completed', etc.
  entityType: text('entity_type').notNull(), // 'task', 'person', 'user'
  entityId: text('entity_id').notNull(),
  previousState: jsonb('previous_state'), // For undo
  newState: jsonb('new_state'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
```

### 4.2 Track Actions for Undo

Wrap state-changing operations to record history:

```typescript
async function trackAction<T>(
  db: DbClient,
  userId: string,
  actionType: string,
  entityType: string,
  entityId: string,
  previousState: T,
  newState: T
) {
  await db.insert(actionHistory).values({
    userId,
    actionType,
    entityType,
    entityId,
    previousState,
    newState,
  });
}
```

---

## Phase 5: Update Worker Flow

### 5.1 Modified Classification Processor

**File:** `apps/worker/src/processors/classify.ts`

```typescript
// After classification
if (classification.type === 'intent' && classification.intent) {
  // Handle intent
  response = await handleIntent(classification.intent, user, db, messageQueue);
} else if (classification.type === 'unknown' || classification.confidence < 0.5) {
  // Clarification
  response = formatClarification(classification);
} else {
  // Task capture (existing flow)
  response = await createTaskFromClassification(...);
}
```

---

## Implementation Order

### Batch 1: Foundation (Types & Prompt)
- [ ] Update shared-types with IntentType and IntentResult
- [ ] Rewrite classification prompt with intent detection
- [ ] Update classifier to handle intent results

### Batch 2: Query & Completion Intents
- [ ] Wire up all query intents (mostly done)
- [ ] Add natural language task completion ("finished the dentist call")
- [ ] Add "complete recent" intent ("that's done")

### Batch 3: People Management Intents
- [ ] Natural language add person
- [ ] Natural language remove person
- [ ] Natural language alias setting
- [ ] Natural language schedule setting

### Batch 4: Settings Intents
- [ ] Set digest time
- [ ] Set timezone
- [ ] Set reminder hours
- [ ] Pause/resume account
- [ ] Show settings

### Batch 5: Task Editing Intents
- [ ] Reschedule task
- [ ] Change priority
- [ ] Change context
- [ ] Add note
- [ ] Delete task

### Batch 6: Undo & Corrections
- [ ] Add action history table
- [ ] Track actions for undo
- [ ] Implement undo handler
- [ ] Change type correction
- [ ] Person correction

### Batch 7: Bulk & Stats
- [ ] Clear person agenda
- [ ] Complete all today
- [ ] Show stats
- [ ] Show streak

---

## Example Conversations After Implementation

### Natural Task Completion
```
User: finished calling the dentist
Bot: ✅ Call dentist — done! Nice timing! 🎉
```

### Natural People Management
```
User: I need to start tracking my 1:1s with Sarah Chen
Bot: ✅ Added Sarah Chen to your people.
     When do you usually meet?

User: every Tuesday
Bot: ✅ Sarah Chen now meets weekly on Tuesday.
```

### Natural Settings
```
User: can you send my morning summary at 6:30am instead
Bot: ✅ Daily digest will now arrive at 6:30 AM.

User: I moved to California
Bot: ✅ Timezone updated to America/Los_Angeles.
```

### Natural Task Editing
```
User: actually move the dentist call to Friday
Bot: ✅ "Call dentist" rescheduled to Friday, Jan 24.

User: and make it high priority
Bot: ✅ "Call dentist" is now 🔥 Today priority.
```

### Undo
```
User: wait undo that
Bot: ↩️ Undone: "Call dentist" priority restored to normal.
```

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/shared-types/src/gtd.ts` | Add IntentType, IntentResult |
| `packages/ai/src/prompts/classify-task.ts` | Rewrite with intent detection |
| `packages/ai/src/classifier.ts` | Handle intent results |
| `apps/worker/src/handlers/intents.ts` | New - intent handlers |
| `apps/worker/src/handlers/queries.ts` | New - extracted query handlers |
| `apps/worker/src/handlers/completion.ts` | New - task completion handlers |
| `apps/worker/src/handlers/people.ts` | New - people management handlers |
| `apps/worker/src/handlers/settings.ts` | New - settings handlers |
| `apps/worker/src/handlers/editing.ts` | New - task editing handlers |
| `apps/worker/src/handlers/undo.ts` | New - undo/correction handlers |
| `apps/worker/src/processors/classify.ts` | Update to use intent handlers |
| `packages/database/src/schema/action-history.ts` | New - undo support |
| `packages/notion/src/services/tasks.ts` | Add update/delete functions |

---

## Testing Plan

1. **Query Intents**: "what's up with my tasks" → correct list
2. **Completion**: "finished calling mom" → task marked done
3. **People**: "start tracking my manager alex" → person created
4. **Settings**: "send digest at 7am" → setting updated
5. **Editing**: "move groceries to tomorrow" → due date changed
6. **Undo**: "undo" → last action reversed
