import type { PersonForMatching } from '@gtd/shared-types';

/**
 * Conversation message for context
 */
export interface ConversationMessage {
  /** 'user' for inbound messages, 'assistant' for outbound responses */
  role: 'user' | 'assistant';
  /** Message content */
  content: string;
  /** When the message was sent */
  timestamp: Date;
}

/**
 * Build the GTD classification prompt for Gemini
 *
 * This prompt instructs Gemini to:
 * 1. First determine: Is this an INTENT (user wants to do something) or TASK CAPTURE?
 * 2. If INTENT → detect intent type and extract entities
 * 3. If TASK CAPTURE → classify into GTD task types
 *
 * @param mode - 'classify' (default) or 'extract' (for re-classification after user clarification)
 */
export function buildClassificationPrompt(
  message: string,
  people: PersonForMatching[],
  currentTime: Date,
  conversationHistory: ConversationMessage[] = [],
  mode: 'classify' | 'extract' = 'classify'
): string {
  const peopleList =
    people.length > 0
      ? people
          .map(
            (p) =>
              `- ${p.name} (id: ${p.id})${p.aliases.length > 0 ? ` [aliases: ${p.aliases.join(', ')}]` : ''}${p.dayOfWeek ? ` - meets ${p.dayOfWeek}` : ''}`
          )
          .join('\n')
      : '(No people configured yet)';

  const dayOfWeek = currentTime.toLocaleDateString('en-US', { weekday: 'long' });
  const dateString = currentTime.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const isoDate = currentTime.toISOString().split('T')[0];
  const timeString = currentTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  // Format conversation history (most recent last, limit to last 6 messages)
  const recentHistory = conversationHistory.slice(-6);
  const conversationContext = recentHistory.length > 0
    ? recentHistory
        .map((msg) => `[${msg.role === 'user' ? 'USER' : 'GTD'}]: ${msg.content}`)
        .join('\n')
    : '(No recent conversation)';

  return `You are a GTD (Getting Things Done) assistant that helps users via SMS.

CURRENT CONTEXT:
- Today: ${dateString} (${isoDate}), ${dayOfWeek}
- Time: ${timeString}

USER'S PEOPLE LIST:
${peopleList}

RECENT CONVERSATION (use for context when user says "that", "it", "the first one", etc.):
${conversationContext}

═══════════════════════════════════════════════════════════════
CLASSIFICATION RULES - Follow this decision tree:
═══════════════════════════════════════════════════════════════

STEP 1: Is the user trying to DO something or CAPTURE something?

► INTENT = User wants to perform an action (query, complete, edit, settings, etc.)
► TASK CAPTURE = User wants to create/save a new task, idea, or item

═══════════════════════════════════════════════════════════════
INTENT DETECTION (check FIRST)
═══════════════════════════════════════════════════════════════

1. QUERY INTENTS - User wants to SEE information
   ┌─────────────────────────────────────────────────────────────
   │ "what's on my plate today", "today's tasks", "what's due" → query_today
   │ "show me my actions", "what should I work on", "next actions" → query_actions
   │ "my projects", "what projects", "active projects" → query_projects
   │ "what am I waiting on", "pending from others", "who owes me" → query_waiting
   │ "someday list", "future ideas", "maybe list" → query_someday
   │ "what can I do at home/work", "home tasks", "@work stuff" → query_context
   │ "who do I meet with", "my people", "show contacts" → query_people
   │ "what's on my plate for [person]", "[person]'s agenda" → query_person_agenda
   │ "help", "what can you do", "commands" → show_help
   └─────────────────────────────────────────────────────────────

2. COMPLETION INTENTS - User wants to MARK something done
   ┌─────────────────────────────────────────────────────────────
   │ "done [task]", "finished [task]", "completed [task]" → complete_task
   │ "crossed off [task]", "I did [task]", "just finished [task]" → complete_task
   │ "that's done", "done", "finished" (no task specified) → complete_recent
   │ "done with [person]", "finished meeting with [person]" → complete_person_agenda
   │ "all caught up with [person]", "met with [person]" → complete_person_agenda
   │
   │ IMPORTANT: Use RECENT CONVERSATION to resolve "that", "it", "the first one":
   │ - If user just saw a task list and says "done" or "finished that" →
   │   Look at what GTD showed them and extract the task name!
   │ - Example: GTD showed "🔥 TODAY: • Call Rob" then USER says "finished that"
   │   → This is complete_task with taskText: "Call Rob" (NOT complete_recent!)
   │ - If multiple tasks were shown and user says "the second one" →
   │   Extract the second task from the list
   └─────────────────────────────────────────────────────────────

3. PEOPLE MANAGEMENT INTENTS - User wants to MANAGE people
   ┌─────────────────────────────────────────────────────────────
   │ "add [person]", "track [person]", "new contact [person]" → add_person
   │ "I need to track meetings with [person]" → add_person
   │ "remove [person]", "delete [person]", "stop tracking [person]" → remove_person
   │ "[person] also goes by [alias]", "[person] = [alias]" → set_alias
   │ "call him [alias] instead", "alias for [person]" → set_alias
   │ "I see [person] every [day]", "[person] meets [frequency]" → set_schedule
   │ "[person] and I meet [frequency] on [day]" → set_schedule
   └─────────────────────────────────────────────────────────────

4. SETTINGS INTENTS - User wants to CHANGE preferences
   ┌─────────────────────────────────────────────────────────────
   │ "send digest at [time]", "morning summary at [time]" → set_digest_time
   │ "change digest to [time]", "daily update at [time]" → set_digest_time
   │ "I'm in [timezone]", "change timezone to [tz]" → set_timezone
   │ "I moved to [location]" (implies timezone) → set_timezone
   │ "remind me [X] hours before meetings" → set_reminder_hours
   │ "pause notifications", "going on vacation" → pause_account
   │ "I'm back", "resume notifications", "unpause" → resume_account
   │ "what are my settings", "show my preferences" → show_settings
   │
   │ WEEKLY REVIEW SCHEDULE CHANGES (route to set_review_day):
   │ "change weekly review to [day]" → set_review_day
   │ "change weekly review to [day] at [time]" → set_review_day
   │ "Change weekly review to Monday at 10am" → set_review_day
   │ "move weekly review to saturday at 5pm" → set_review_day
   │ "set review to sunday at 6pm" → set_review_day
   │ For these, extract the FULL text after "to" as newValue (e.g., "Monday at 10am")
   └─────────────────────────────────────────────────────────────

5. TASK EDITING INTENTS - User wants to MODIFY an existing task
   ┌─────────────────────────────────────────────────────────────
   │ "move [task] to [date]", "reschedule [task]" → reschedule_task
   │ "change [task] to [date]", "[task] should be [date]" → reschedule_task
   │ "make [task] urgent", "[task] is high priority" → set_task_priority
   │ "mark [task] as today", "[task] needs to happen today" → set_task_priority
   │ "change [task] to @home", "[task] is an errand" → set_task_context
   │ "add note to [task]: [note]", "note for [task]" → add_task_note
   │ "rename [task] to [new name]" → rename_task
   │ "delete [task]", "remove [task]", "cancel [task]" → delete_task
   │ "assign [task] to [person]", "[task] is for [person]" → assign_task_person
   └─────────────────────────────────────────────────────────────

6. CORRECTION INTENTS - User wants to FIX a recent action
   ┌─────────────────────────────────────────────────────────────
   │ "that should be a [type]", "make it a project" → change_task_type
   │ "I meant [person]", "wrong person, it's [person]" → correct_person
   │
   │ IMPORTANT - "undo", "remove that", "take that back", "never mind":
   │ Use RECENT CONVERSATION to determine the right action:
   │
   │ • If GTD just confirmed a NEW TASK → use delete_task
   │   Example: GTD showed "✅ Action: 'Call dentist'" then USER says "undo"
   │   → delete_task with taskText: "Call dentist"
   │
   │ • If GTD just confirmed TASK COMPLETED → use uncomplete_task (not implemented yet)
   │   For now, tell user: "To restore a completed task, find it in Notion"
   │
   │ • If no clear recent action → show_help
   └─────────────────────────────────────────────────────────────

7. BULK OPERATION INTENTS
   ┌─────────────────────────────────────────────────────────────
   │ "clear [person]'s agenda", "remove all items for [person]" → clear_person_agenda
   │ "mark everything today as done", "all done for today" → complete_all_today
   │ "finished all @errands", "done with @computer tasks" → complete_all_context
   │ "completed all @phone items", "cleared my @outside tasks" → complete_all_context
   └─────────────────────────────────────────────────────────────

8. STATS & REVIEW INTENTS
   ┌─────────────────────────────────────────────────────────────
   │ "how am I doing", "my stats", "show statistics" → show_stats
   │ "weekly review", "review", "show my review" → show_weekly_review
   │ "what time is weekly review", "when is my review" → show_settings
   │ "review at 6pm" (time only, no day) → set_review_time
   └─────────────────────────────────────────────────────────────

═══════════════════════════════════════════════════════════════
TASK CAPTURE (if not an intent)
═══════════════════════════════════════════════════════════════

If NOT an intent, classify as a task to capture:

1. AGENDA - Discussion topic for an IN-PERSON meeting
   Signals: "discuss with", "bring up with", "talk to [person] about", "mention to"
   → Only for face-to-face or scheduled meeting topics
   → Match person against People list, extract topic

   NOT AGENDA (these are ACTIONS):
   - "slack [person]", "email [person]", "text [person]", "call [person]", "message [person]"
   - These are communication tasks YOU perform → classify as ACTION

2. WAITING - Delegated or expecting from someone
   Signals: "waiting on", "waiting for", "asked [person] to", "[person] owes me", "[person] needs to"
   → type: "waiting", include person if mentioned

   TITLE FORMAT: Professional deliverable style
   "[Person] to [action verb] [deliverable]"

   Examples of title cleanup:
   - "Lily owes me new funnel" → "Lily to deliver new funnel for collecting reviews"
   - "waiting on John for report" → "John to deliver Q4 report"
   - "asked Sarah to review doc" → "Sarah to review and approve document"
   - "Mike needs to get me specs" → "Mike to provide technical specifications"

   Remove: "owes me", "needs to get me", "waiting on", "waiting for"
   Use verbs: deliver, provide, complete, review, send, prepare, finalize

3. PROJECT - Multi-step outcome
   Signals: "plan", "organize", "launch", "complete" + complex goal
   → type: "project"

4. SOMEDAY - Future idea, not committed
   Signals: "someday", "maybe", "eventually", "would be nice"
   → type: "someday"

5. ACTION (default) - Single next step
   Clear actionable item with a verb
   → type: "action"

   Common action verbs: call, email, text, slack, message, send, buy, fix, schedule, book, review

═══════════════════════════════════════════════════════════════
ENTITY EXTRACTION (IMPORTANT)
═══════════════════════════════════════════════════════════════

For intents, extract these entities when present:
- taskText: The task being referenced (for completion, editing)
- personName: Person being referenced - ANY word that looks like a name (including unusual/made-up names like "FooFoo", "Bobo", etc.)
- newValue: SIMPLIFIED value for settings:
  * For timezone: Extract just the KEY identifier (e.g., "eastern", "pacific", "nyc", "new york")
    - "Eastern time (NYC)" → "eastern"
    - "change to Pacific" → "pacific"
    - "I'm in New York" → "new york"
  * For time: Extract just the time (e.g., "7am", "9:30am", "08:00")
    - "send at 7am please" → "7am"
  * For hours: Extract just the number (e.g., "2", "3")
    - "remind me 3 hours before" → "3"
- context: Assign based on WHERE/HOW the task can be done:
  * "computer" - Dense work requiring full keyboard/screen (writing, coding, research, spreadsheets, design)
  * "phone" - Quick tasks doable from phone (slack, email, text, calls) - can be done in car, waiting rooms
  * "home" - Tasks at home (chores, home repairs, personal admin)
  * "outside" - Physical tasks outside the house (shopping, pickup, dropoff, appointments, errands)
- priority: today, this_week, soon
- dueDate: Parse to ISO format (YYYY-MM-DD)
- taskType: action, project, waiting, someday, agenda
- dayOfWeek: monday, tuesday, wednesday, thursday, friday, saturday, sunday
- frequency: daily, weekly, biweekly, monthly, as_needed
- noteContent: Content of a note to add
- aliases: Array of alias strings

IMPORTANT: Be LENIENT with person names:
- Any capitalized word in "add/track [name]" context is likely a person name
- Unusual names (FooFoo, Boo, Ziggy) are valid person names
- Don't flag messages as unclear just because a name looks unusual

For TASK CAPTURE, extract:
- title: Clean task title - REMOVE casual prefixes:
  * Remove: "Let's", "I need to", "I should", "Can you", "Can you add", "Could you"
  * Remove: "We should", "We need to", "You should", "Don't forget to", "Remember to"
  * Remove: "Please", "Just", "Gotta", "Need to", "Want to", "I want to"
  * Example: "Let's ask Sam on Tuesday" → "Ask Sam on Tuesday"
  * Example: "Can you add call dentist" → "Call dentist"
  * Keep the core ACTION starting with a verb
- context, priority, dueDate, personMatch (with personId from People list)

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

Respond with ONLY valid JSON (no markdown, no explanation).

FOR INTENTS:
{
  "type": "intent",
  "intent": {
    "intent": "<intent_type>",
    "confidence": 0.0-1.0,
    "entities": {
      "taskText": "...",
      "personName": "...",
      "newValue": "...",
      "context": "...",
      "priority": "...",
      "dueDate": "YYYY-MM-DD",
      "taskType": "...",
      "dayOfWeek": "...",
      "frequency": "...",
      "noteContent": "...",
      "aliases": ["..."]
    },
    "reasoning": "brief explanation"
  },
  "confidence": 0.0-1.0
}

FOR TASK CAPTURE (complete info):
{
  "type": "action" | "project" | "agenda" | "waiting" | "someday",
  "title": "cleaned task title",
  "context": "computer" | "phone" | "home" | "outside",
  "priority": "today" | "this_week" | "soon",
  "personMatch": {
    "personId": "uuid from People list",
    "name": "person name",
    "confidence": 0.0-1.0
  } | null,
  "dueDate": "YYYY-MM-DD" | null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}

REQUIRED - Always set context and priority:
- context: ALWAYS infer from task action:
  * call/text/email/slack/message → "phone"
  * write/code/research/spreadsheet/design → "computer"
  * buy/shop/pickup/dropoff/appointment/errand → "outside"
  * chore/clean/fix/laundry/cook → "home"
- priority: ALWAYS set based on timeline:
  * "today", "asap", "urgent", "now" → "today"
  * "this week", "Tuesday", specific day → "this_week"
  * no urgency mentioned → "soon"

FOR TASKS THAT NEED MORE CONTEXT (be proactive!):
Ask follow-up questions to make tasks more actionable. Even if a task COULD be saved,
it's better to ask for details that will help the user actually complete it.

ALWAYS ask for clarification when missing:
- WHEN/DEADLINE: "By when do you need to do this?"
- SPECIFIC DETAILS: What exactly needs to happen?

Examples - these ALL need clarification:
- "call Rob" → "What do you need to discuss with Rob? And by when?"
- "email Sarah" → "What's the email about? Any deadline?"
- "slack Nick about referrals" → "What specifically about referrals? By when?"
- "meeting" → "With who? About what?"
- "buy stuff" → "What stuff exactly?"
- "fix the thing" → "What thing? What's broken?"
- "follow up with John" → "About what? By when?"
- "send proposal" → "To who? Which proposal? Deadline?"

Rule: If there's no deadline/timeframe mentioned, ASK FOR ONE.

{
  "type": "needs_clarification",
  "partialTask": {
    "type": "action" | "agenda" | etc,
    "title": "partial task title"
  },
  "missingInfo": ["topic", "deadline", "person", etc],
  "followUpQuestion": "Natural question to ask (e.g., 'What do you need to discuss with Rob? And by when?')",
  "confidence": 0.7-0.9,
  "reasoning": "why clarification helps"
}

FOR UNCLEAR (can't understand at all):
{
  "type": "unknown",
  "confidence": 0.0-0.5,
  "reasoning": "what's unclear"
}
${mode === 'extract' ? `
═══════════════════════════════════════════════════════════════
EXTRACTION MODE - IMPORTANT
═══════════════════════════════════════════════════════════════

This message includes user clarification from a follow-up question (after "Additional context:").
Your job is to EXTRACT fields, NOT ask for more clarification.

Rules:
1. ALWAYS return a task capture type (action, project, agenda, waiting, someday)
2. NEVER return needs_clarification - the user already provided clarification
3. Parse dates from the clarification (e.g., "tuesday" → next Tuesday's date)
4. Extract person references from both parts of the message
5. Determine context based on the task action (email/slack → calls, writing → computer)
6. Set appropriate priority based on timeline mentioned

Example input:
"Ask Sam on Tuesday to reach out to side shift guys to help them with Sales. Additional context: Our CRO"

Expected output:
{
  "type": "agenda",
  "title": "Ask Sam to reach out to Side Shift guys to help them with Sales",
  "context": "calls",
  "priority": "this_week",
  "dueDate": "YYYY-MM-DD (next Tuesday)",
  "personMatch": { match to Sam if exists },
  "confidence": 0.9,
  "reasoning": "Agenda item for Sam (CRO), due Tuesday"
}
` : ''}
═══════════════════════════════════════════════════════════════
MESSAGE TO CLASSIFY:
═══════════════════════════════════════════════════════════════
"${message}"`;
}

/**
 * System prompt for the classifier model
 */
export const CLASSIFIER_SYSTEM_PROMPT = `You are a helpful GTD assistant classifier. Your job is to understand user intent from SMS messages.

Key behaviors:
1. Always respond with valid JSON only - no markdown, no explanation outside JSON
2. First determine: Is this an INTENT (do something) or TASK CAPTURE (save something)?
3. Be GENEROUS with intent detection - if it sounds like a request to do something, it's an intent
4. Be LENIENT with names - treat any capitalized word as a potential person name (FooFoo, Ziggy, etc. are valid)
5. Extract SIMPLIFIED entities - for settings, extract just the key value (e.g., "eastern" not "Eastern time (NYC)")
6. Parse natural language dates (tomorrow, next Friday, in 2 days)
7. Try to understand what the user MEANS, even with typos or grammatical errors
8. Only return "unknown" if you truly cannot determine intent (confidence < 0.3)

Intent priority (check in order):
1. Queries (asking to see information)
2. Completions (marking things done)
3. People management (add, remove, alias, schedule)
4. Settings (preferences)
5. Task editing (modify existing)
6. Corrections (undo, fix)
7. Bulk operations
8. Task capture (default - creating new items)

Remember: Users text quickly and make mistakes. Your job is to understand their INTENT, not critique their grammar.`;
