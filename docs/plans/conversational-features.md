# Conversational Features Enabled by Tool Architecture

## Overview

The hybrid/tool-based architecture enables conversational features that are difficult or impossible with the current single-shot classification approach.

---

## 0. Meeting Brain Dump (High Priority)

### Current Limitation
The classifier handles ONE item per message. Multi-item dumps get confused or only capture the first item.

### With Tools

```
User: "Just finished meeting with Sarah:
- follow up on budget proposal
- waiting on her for Q4 numbers
- need to ask Mike about timeline
- call John re contract by Friday"

LLM: // Parses as multiple items, classifies each
create_task({ title: "Follow up on budget proposal", type: "action", personId: "sarah" })
create_task({ title: "Sarah to provide Q4 numbers", type: "waiting", personId: "sarah" })
create_task({ title: "Ask Mike about timeline", type: "agenda", personId: "mike" })
create_task({ title: "Call John re contract", type: "action", dueDate: "2026-01-24" })

Response: "Got it! Captured 4 items from your Sarah meeting:

✅ ACTION: Follow up on budget proposal
⏳ WAITING: Sarah to provide Q4 numbers
👤 AGENDA (Mike): Ask about timeline
✅ ACTION: Call John re contract (due Fri)

Anything to add?"
```

### More Examples

**Mixed types in one message:**
```
User: "After the team standup:
john owes me the design specs
remind me to book the venue
talk to lisa about hiring
maybe look into new project mgmt tool"

Response: "Captured 4 items:

⏳ WAITING: John to deliver design specs
✅ ACTION: Book the venue
👤 AGENDA (Lisa): Discuss hiring
💭 SOMEDAY: Look into new project mgmt tool"
```

**With ambiguity - asks follow-ups:**
```
User: "from client call:
- proposal changes
- contract review
- check with legal"

LLM: // Detects ambiguity

Response: "I captured 3 items, but need some clarity:

1. 'Proposal changes' - is this:
   a) Something YOU need to do (action)?
   b) Something you're WAITING ON from the client?

2. 'Contract review' - same question

3. 'Check with legal' - is this:
   a) An agenda item for a meeting with legal?
   b) An action for you to email/call them?

Reply with like '1a, 2b, 3b' or just clarify"
```

**Intelligent parsing:**
```
User: "Quick dump:
Sarah - quarterly planning (tues)
waiting mike budget approval
someday: learn figma
@errands pick up dry cleaning
call insurance re claim #12345"

Response: "Got 5 items:

👤 AGENDA (Sarah): Quarterly planning - for your Tuesday meeting
⏳ WAITING: Mike to approve budget
💭 SOMEDAY: Learn Figma
✅ ACTION: Pick up dry cleaning (@errands)
✅ ACTION: Call insurance re claim #12345 (@phone)

All captured!"
```

### Implementation

```typescript
// New tool: batch_create_tasks
const batchCreateTasks: Tool = {
  name: 'batch_create_tasks',
  description: 'Create multiple tasks at once from a brain dump or meeting notes',
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            type: { type: 'string', enum: ['action', 'project', 'waiting', 'someday', 'agenda'] },
            context: { type: 'string' },
            priority: { type: 'string' },
            dueDate: { type: 'string' },
            personName: { type: 'string' },
            needsClarification: { type: 'boolean' },
            clarificationQuestion: { type: 'string' }
          },
          required: ['title', 'type']
        }
      }
    },
    required: ['tasks']
  }
};
```

### Prompt Engineering for Multi-Item Detection

```
MULTI-ITEM DETECTION:

If the message contains multiple items (bullet points, numbered lists, line breaks,
or phrases like "also", "and", "plus"), parse each as a separate task.

Signals of multi-item message:
- Bullet points (-, *, •)
- Numbered items (1., 2., etc)
- Line breaks with distinct items
- "also", "and also", "plus", "oh and"
- Context headers: "from meeting:", "quick dump:", "notes:"

For each item, independently determine:
- Task type (action, waiting, agenda, project, someday)
- Person involved (if any)
- Due date (if mentioned)
- Context (computer, phone, home, outside)

If an item is ambiguous, flag it for clarification but still capture the others.
```

---

These features leverage the LLM's ability to:
- Request data on-demand
- Maintain conversation context
- Generate dynamic responses
- Chain multiple operations

---

## 1. Natural Language Queries

### Current Limitation
Must match predefined intent patterns. "Show me tasks" works, but complex queries don't.

### With Tools

```
User: "What did I add last week that's still not done?"

LLM: lookup_tasks({
  createdAfter: "2026-01-12",
  createdBefore: "2026-01-19",
  status: "active"
})

Response: "You added 5 tasks last week that are still pending:
• Design homepage mockup (Jan 13)
• Review budget proposal (Jan 14)
• Call insurance company (Jan 15)
..."
```

```
User: "Which of my projects have no next actions?"

LLM: lookup_tasks({ type: "project", status: "active" })
LLM: lookup_tasks({ type: "action", status: "active" })
// Cross-reference to find orphaned projects

Response: "2 projects have no next actions:
• Website Redesign - stalled since Jan 10
• Q2 Planning - no actions defined yet

Want me to help you define next actions for these?"
```

---

## 2. Contextual Follow-ups

### Current Limitation
Each message is mostly independent. Follow-ups require explicit state management.

### With Tools

```
User: "Show Sarah's agenda"

Response: "Sarah Chen has 4 pending items:
1. Discuss Q2 budget
2. Review project timeline
3. Share design feedback
4. Plan team offsite"

User: "Mark the first two as discussed"

LLM: // Understands "first two" from conversation context
complete_task({ taskId: "task_1" })
complete_task({ taskId: "task_2" })

Response: "Done! Marked as discussed:
✓ Discuss Q2 budget
✓ Review project timeline

2 items remaining for Sarah."
```

```
User: "What's due tomorrow?"

Response: "3 tasks due tomorrow:
1. Submit expense report
2. Call dentist
3. Send proposal to client"

User: "Push the dentist one to next week"

LLM: update_task({
  taskId: "dentist_task_id",
  dueDate: "2026-01-26"
})

Response: "Moved 'Call dentist' to Monday, Jan 26."
```

---

## 3. Smart Task Editing

### Current Limitation
Limited edit capabilities. Must know exact field to change.

### With Tools

```
User: "Actually make that a project instead"

LLM: // Knows from context which task was just created
update_task({ taskId: "last_created", type: "project" })

Response: "Changed 'Website Redesign' from action to project.
What's the first next action for this project?"
```

```
User: "Add a note to the budget task - need to check with finance first"

LLM: lookup_tasks({ search: "budget" })
// Finds the task
add_note({ taskId: "...", note: "Need to check with finance first" })

Response: "Added note to 'Review budget proposal'."
```

```
User: "Split this into smaller tasks"

LLM: // Context: user just captured "Plan company retreat"
// Suggests breakdown

Response: "I can break 'Plan company retreat' into:
1. Book venue
2. Send invitations
3. Plan activities
4. Arrange catering
5. Organize transportation

Create these as separate actions?"
```

---

## 4. Undo & Corrections

### Current Limitation
No undo. Mistakes require manual fixes.

### With Tools

```
User: "Undo that"

LLM: // Tracks last action in conversation
undo_last_action()

Response: "Undone. 'Call dentist' is back on tomorrow's list."
```

```
User: "Wait, that was for Mike not Sarah"

LLM: // Context: just added agenda item
update_task({ taskId: "last", personId: "mike_id" })

Response: "Moved to Mike's agenda instead of Sarah's."
```

```
User: "I meant next Friday, not this Friday"

LLM: update_task({ taskId: "last", dueDate: "2026-01-30" })

Response: "Updated to Friday, Jan 30 (next week)."
```

---

## 5. Bulk Operations with Confirmation

### Current Limitation
Limited bulk ops. Requires exact commands.

### With Tools

```
User: "Clear out all my old someday items"

LLM: lookup_tasks({ type: "someday", createdBefore: "2025-07-01" })

Response: "Found 12 someday items older than 6 months:
• Learn Spanish (added Mar 2025)
• Build a birdhouse (added Apr 2025)
• Try pottery class (added May 2025)
... and 9 more

Delete all 12, or review them one by one?"

User: "Delete them all"

LLM: delete_tasks({ taskIds: [...] })

Response: "Deleted 12 old someday items. Your someday list now has 8 items."
```

```
User: "Move all my @computer tasks to @home"

LLM: lookup_tasks({ context: "computer", status: "active" })
// Shows list
bulk_update_tasks({ taskIds: [...], context: "home" })

Response: "Moved 7 tasks from @computer to @home."
```

---

## 6. Cross-Entity Queries

### Current Limitation
Can only query one entity type at a time.

### With Tools

```
User: "Who do I have the most pending items with?"

LLM: lookup_people({})
// For each person
lookup_tasks({ personId: "...", type: "agenda" })
// Aggregate

Response: "Your agenda item counts:
• Sarah Chen: 7 items
• Mike Johnson: 4 items
• Lisa Park: 3 items

Want to see Sarah's items?"
```

```
User: "What's my busiest day this week?"

LLM: lookup_tasks({
  dueAfter: "2026-01-19",
  dueBefore: "2026-01-26"
})
// Group by date

Response: "This week's task distribution:
• Monday: 2 tasks
• Tuesday: 5 tasks ← busiest
• Wednesday: 3 tasks
• Thursday: 1 task
• Friday: 4 tasks

Want to reschedule some Tuesday tasks?"
```

---

## 7. Proactive Suggestions

### Current Limitation
System only responds to queries.

### With Tools (context-aware responses)

```
User: "Add task: prepare for Sarah meeting"

LLM: lookup_person_schedule({ name: "Sarah" })
// Sees Sarah meets on Tuesdays

Response: "✅ Captured: Prepare for Sarah meeting

📅 Heads up: Your next meeting with Sarah is tomorrow (Tuesday).
Should I set this as due today?"
```

```
User: "Done with the design review"

LLM: complete_task({ taskId: "..." })
lookup_tasks({ type: "project", relatedTo: "design" })
// Checks if project has remaining actions

Response: "✅ Completed: Design review

🎉 That was the last action for 'Website Redesign' project!
Want to mark the project complete, or add follow-up actions?"
```

---

## 8. Weekly Review Assistant

### Current Limitation
Manual process. User must query each list separately.

### With Tools

```
User: "Let's do my weekly review"

LLM: // Multi-step guided conversation
lookup_tasks({ type: "project", status: "active" })
lookup_tasks({ type: "waiting", status: "active" })
lookup_tasks({ status: "active", dueDate: null })

Response: "Starting weekly review! Let's go through each area:

📁 PROJECTS (5 active)
All projects have next actions except:
• Q2 Planning - needs a next action

What's the next action for Q2 Planning?"

User: "Schedule kickoff meeting"

LLM: create_task({
  title: "Schedule Q2 planning kickoff meeting",
  type: "action",
  relatedProject: "q2_planning_id"
})

Response: "✅ Added.

⏳ WAITING FOR (3 items)
• Waiting on John for budget approval (2 weeks old)
• Waiting on vendor for quote (1 week old)
• Waiting on Lisa for feedback (3 days)

Any updates on these? Reply with number to update."
```

---

## 9. Delegation & Handoff

### Current Limitation
Can create waiting items but no delegation workflow.

### With Tools

```
User: "Delegate the expense report to Alex"

LLM: lookup_tasks({ search: "expense report" })
update_task({
  taskId: "...",
  delegatedTo: "Alex",
  type: "waiting"
})
lookup_people({ query: "Alex" })

Response: "Delegated to Alex. Created waiting item:
'Waiting on Alex for expense report'

Alex isn't in your people list yet. Add them?"

User: "Yes, we meet weekly on Thursdays"

LLM: create_person({
  name: "Alex",
  frequency: "weekly",
  dayOfWeek: "thursday"
})

Response: "Added Alex (weekly on Thursdays).
You'll get a reminder before your Thursday meetings."
```

---

## 10. Natural Capture with Clarification

### Current Limitation
Clarification is rigid, one question at a time.

### With Tools

```
User: "I need to deal with the Johnson account situation before it blows up"

LLM: // Understands urgency, asks smart follow-up

Response: "Sounds urgent! A few quick questions:

1. Is Johnson a person or company?
2. Is this a single task or a project with multiple steps?
3. When does this need to be resolved by?"

User: "It's a client company, probably a project, by end of week"

LLM: create_task({
  title: "Resolve Johnson account situation",
  type: "project",
  dueDate: "2026-01-24",
  priority: "today"
})

Response: "Created project: Resolve Johnson account situation (due Fri)
Marked as high priority.

What's the very next action you need to take?"

User: "Call their account manager"

LLM: create_task({
  title: "Call Johnson account manager",
  type: "action",
  priority: "today",
  relatedProject: "johnson_project_id"
})

Response: "✅ Added as today's priority: Call Johnson account manager

This is now linked to the Johnson project."
```

---

## 11. Statistics & Insights

### Current Limitation
No analytics or patterns.

### With Tools

```
User: "How productive was I this week?"

LLM: lookup_tasks({
  completedAfter: "2026-01-13",
  completedBefore: "2026-01-20"
})
lookup_tasks({
  createdAfter: "2026-01-13",
  createdBefore: "2026-01-20"
})

Response: "This week's stats:
✅ Completed: 23 tasks
📥 Captured: 18 new tasks
📈 Net progress: +5 tasks cleared

Your most productive day was Wednesday (8 completions).
You completed 3 project milestones!"
```

```
User: "What keeps getting pushed?"

LLM: lookup_tasks({
  rescheduledCount: { gt: 2 },
  status: "active"
})

Response: "These tasks have been rescheduled 3+ times:
• Call insurance company (rescheduled 5 times)
• Organize garage (rescheduled 4 times)
• Update resume (rescheduled 3 times)

These might need to be:
- Delegated
- Broken into smaller steps
- Moved to Someday/Maybe
- Deleted if no longer relevant

Want help processing these?"
```

---

## 12. Context-Aware Recommendations

### Current Limitation
No awareness of user's current context.

### With Tools

```
User: "I have 30 minutes before my next meeting"

LLM: lookup_tasks({
  context: ["phone", "computer"],
  estimatedTime: { lte: 30 },
  priority: "today"
})

Response: "Here are quick wins you could knock out:

📱 Phone (10-15 min each):
• Call dentist to reschedule
• RSVP to team dinner

💻 Computer (5-10 min each):
• Reply to Lisa's email
• Review PR #234

Which context are you in?"
```

---

## Implementation Priority

| Feature | Value | Complexity | Priority |
|---------|-------|------------|----------|
| Contextual follow-ups | High | Medium | P0 |
| Natural language queries | High | Medium | P0 |
| Undo & corrections | High | Low | P0 |
| Smart task editing | Medium | Low | P1 |
| Bulk operations | Medium | Medium | P1 |
| Weekly review assistant | High | High | P1 |
| Proactive suggestions | Medium | Medium | P2 |
| Statistics & insights | Medium | Medium | P2 |
| Cross-entity queries | Medium | Medium | P2 |
| Delegation workflow | Low | Medium | P3 |

---

## New Tools Required

| Tool | Purpose | Used By |
|------|---------|---------|
| `undo_last_action` | Revert previous operation | Corrections |
| `lookup_task_history` | See task changes over time | Insights |
| `bulk_update_tasks` | Update multiple tasks | Bulk ops |
| `bulk_delete_tasks` | Delete multiple tasks | Cleanup |
| `add_note` | Append note to task | Editing |
| `get_schedule` | Get person's meeting schedule | Proactive |
| `get_productivity_stats` | Aggregate completion data | Insights |
| `find_stalled_projects` | Projects without next actions | Review |
| `find_overdue_waiting` | Old waiting items | Review |

---

## Conversation State Requirements

For these features to work, the system needs to track:

```typescript
interface ConversationContext {
  // Last entities referenced
  lastTasks: TaskReference[];      // For "mark the first one done"
  lastPeople: PersonReference[];   // For "show their agenda"
  lastCreated: TaskReference;      // For "actually make that a project"

  // Conversation flow
  currentFlow?: 'weekly_review' | 'bulk_operation' | 'task_breakdown';
  flowState?: any;                 // Flow-specific state

  // Undo stack
  undoStack: Action[];             // Last N reversible actions
}
```

This context would be maintained in the tool-enabled LLM conversation, not in the database.
