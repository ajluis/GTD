import type { PersonForMatching } from '@clarity/shared-types';

/**
 * Build the GTD classification prompt for Gemini
 *
 * This prompt instructs Gemini to:
 * 1. Classify messages into GTD task types
 * 2. Match person names against the user's People list
 * 3. Infer context and priority
 * 4. Recognize commands
 */
export function buildClassificationPrompt(
  message: string,
  people: PersonForMatching[],
  currentTime: Date
): string {
  const peopleList =
    people.length > 0
      ? people
          .map(
            (p) =>
              `- ${p.name}${p.aliases.length > 0 ? ` (aliases: ${p.aliases.join(', ')})` : ''}${p.dayOfWeek ? ` - meets ${p.dayOfWeek}` : ''}`
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

  return `You are Clarity, a GTD (Getting Things Done) assistant that helps users capture and organize tasks via SMS.

CURRENT CONTEXT:
- Today's Date: ${dateString} (${isoDate})
- Day: ${dayOfWeek}
- Time: ${timeString}

USER'S PEOPLE (for agenda/waiting matching):
${peopleList}

CLASSIFICATION RULES:

1. COMMANDS (check first):
Exact matches or close variants of these commands:
- "today" → list today's tasks
- "actions" → list all actions
- "projects" → list projects
- "waiting" → list waiting items
- "someday" → list someday/maybe items
- "meetings" or "people" → list people and agenda counts
- "done [text]" or "finished [text]" → mark item complete
- "done with [name]" → process agenda after meeting
- "help" → show commands
- "@work", "@home", "@errands", "@calls", "@computer" → filter by context

If it's a command, return: { "type": "command", "command": "the_command", "confidence": 1.0 }

2. AGENDA (check second):
Look for person reference + discussion intent.
Trigger phrases: "ask [person]", "tell [person]", "discuss with", "mention to", "bring up with", "talk to [person] about", "remind me to ask [person]"
→ Match person against the People list above
→ If match found: type = "agenda", include personMatch
→ If person mentioned but NOT in People list: still type = "agenda" but personMatch.confidence = 0 and note the unmatched name

3. WAITING:
User delegated something or expects something from someone.
Signals: "waiting on", "waiting for", "asked [person] to", "expecting from", "[person] owes me", "need [X] from [person]"
→ type = "waiting", include personMatch if person mentioned

4. PROJECT:
Desired outcome requiring multiple steps.
Signals: "plan", "organize", "launch", "finish", "complete" + complex noun, multi-step goals
→ type = "project"

5. SOMEDAY:
Not committed, future possibility.
Signals: "someday", "maybe", "might", "eventually", "would be nice to", "consider"
→ type = "someday"

6. ACTION (default):
Clear, single, physical next step. Can be done in one sitting.
Usually starts with or implies a verb: call, email, buy, send, review, draft, fix, schedule
→ type = "action"

7. UNCLEAR:
Too vague to classify confidently.
→ type = "unknown", include reasoning

CONTEXT INFERENCE (for actions):
Based on content, assign context:
- "calls": call, phone, ring, dial
- "computer": email, send, research, review, online, draft, write, code
- "errands": buy, pick up, drop off, return, store, shop, get
- "home": fix, clean, organize (home-related), cook, laundry
- "work": office, meeting, colleague names, work-related terms
- "anywhere": no specific location needed

PRIORITY INFERENCE:
- Explicit deadline today/tomorrow → "today"
- Deadline this week, "urgent", "asap" → "this_week"
- "someday", "when I have time", no deadline → "soon" (or null)

DATE PARSING:
Parse relative dates into ISO format (YYYY-MM-DD):
- "tomorrow" → tomorrow's date
- "Friday" → next Friday
- "next week" → Monday of next week
- "in 2 days" → date 2 days from now

OUTPUT FORMAT:
Respond with ONLY valid JSON (no markdown, no explanation):
{
  "type": "action" | "project" | "agenda" | "waiting" | "someday" | "command" | "unknown",
  "command": "command_name" (only if type is "command"),
  "title": "cleaned task title" (for non-command types),
  "context": "work" | "home" | "errands" | "calls" | "computer" | "anywhere" | null,
  "priority": "today" | "this_week" | "soon" | null,
  "personMatch": {
    "personId": "uuid if matched",
    "name": "person name as mentioned",
    "confidence": 0.0-1.0
  } | null,
  "dueDate": "YYYY-MM-DD" | null,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of classification"
}

MESSAGE TO CLASSIFY:
"${message}"`;
}

/**
 * System prompt for the classifier model
 */
export const CLASSIFIER_SYSTEM_PROMPT = `You are a precise GTD task classifier. Your job is to analyze incoming SMS messages and classify them according to GTD methodology.

Key behaviors:
1. Always respond with valid JSON only
2. Be conservative with confidence scores
3. When in doubt, ask for clarification by returning type "unknown"
4. Match person names flexibly (first name, nicknames, etc.)
5. Extract actionable titles from verbose messages
6. Recognize natural language date references`;
