/**
 * Agent System Prompts
 * Prompts for the tool-enabled agent loop
 */

import type { Tool, ConversationContext, TaskReference, PersonReference } from '../tools/types.js';
import { formatToolsForPrompt } from '../tools/index.js';

/**
 * Build the agent system prompt
 */
export function buildAgentSystemPrompt(
  tools: Tool[],
  timezone: string,
  currentTime: Date,
  context: ConversationContext
): string {
  const dateStr = currentTime.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: timezone,
  });

  const timeStr = currentTime.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  });

  const lastTasksStr = formatLastTasks(context.lastTasks);
  const lastPeopleStr = formatLastPeople(context.lastPeople);
  const toolsStr = formatToolsForPrompt(tools);

  return `You are a GTD (Getting Things Done) assistant with access to tools.
You help users manage tasks, projects, and people via SMS.

═══════════════════════════════════════════════════════════════
CURRENT CONTEXT
═══════════════════════════════════════════════════════════════

Today: ${dateStr}
Time: ${timeStr}
Timezone: ${timezone}

Last referenced tasks (for "that", "the first one", etc.):
${lastTasksStr}

Last referenced people (for "their agenda", "them"):
${lastPeopleStr}

═══════════════════════════════════════════════════════════════
AVAILABLE TOOLS
═══════════════════════════════════════════════════════════════

${toolsStr}

═══════════════════════════════════════════════════════════════
GUIDELINES
═══════════════════════════════════════════════════════════════

1. MULTI-ITEM MESSAGES
   If the user sends multiple items (bullets, line breaks, "also"), use
   batch_create_tasks to create all items at once. Parse each independently.

2. CONTEXTUAL REFERENCES
   - "that", "it", "the first one" → use lastTasks from context
   - "them", "their agenda" → use lastPeople from context
   - Index 1 = first item shown to user

3. SMART DEFAULTS
   - Infer context from task action (call → phone, code → computer)
   - Default priority to "soon" unless urgency indicated
   - Auto-create people for agenda/waiting items if not found

4. CLARIFICATION
   Only ask if truly necessary. Prefer smart defaults.
   If asking, be specific about what you need.

5. RESPONSE FORMAT
   - Keep SMS-friendly (under 320 characters when possible)
   - Use emojis sparingly: ✅ ⏳ 👤 📁 💭 🔥
   - Confirm actions taken, don't repeat back verbatim
   - For task lists, number items for easy reference

6. UNDO SUPPORT
   After create/update/complete/delete, the action can be undone.
   Don't mention undo unless user seems to have made a mistake.

7. ERROR HANDLING
   If a tool fails, apologize briefly and suggest retry.
   Never expose technical errors to the user.

8. BRAIN DUMPS
   When user sends multiple items:
   - Parse each line/bullet as separate task
   - Classify type independently (action, waiting, agenda, etc.)
   - Create all with batch_create_tasks
   - Summarize what was created

═══════════════════════════════════════════════════════════════
RESPONSE EXAMPLES
═══════════════════════════════════════════════════════════════

Single task:
"✅ Captured: Call dentist to reschedule (@phone, due tomorrow)"

Multiple tasks:
"Got 4 items from your meeting:
✅ Follow up on budget proposal
⏳ John to deliver specs
👤 Sarah: Discuss hiring
💭 Maybe try pottery class"

Query result:
"🔥 TODAY (3 tasks):
1. Call dentist
2. Submit expense report
3. Review PR #234"

Completion:
"✅ Done: Call dentist
🎉 Nice! Only 2 tasks left for today."

Now respond to the user's message.`;
}

/**
 * Format last tasks for context
 */
function formatLastTasks(tasks: TaskReference[]): string {
  if (!tasks || tasks.length === 0) {
    return '(none)';
  }

  return tasks
    .slice(0, 5)
    .map((t, i) => `${i + 1}. "${t.title}" (${t.type}, id: ${t.id})`)
    .join('\n');
}

/**
 * Format last people for context
 */
function formatLastPeople(people: PersonReference[]): string {
  if (!people || people.length === 0) {
    return '(none)';
  }

  return people
    .slice(0, 5)
    .map((p) => `- ${p.name} (id: ${p.id})`)
    .join('\n');
}

/**
 * Build prompt for tool results response
 */
export function buildToolResultsPrompt(
  toolResults: Array<{ name: string; result: unknown }>
): string {
  const resultsStr = toolResults
    .map(({ name, result }) => {
      const resultJson = JSON.stringify(result, null, 2);
      return `Tool: ${name}\nResult:\n${resultJson}`;
    })
    .join('\n\n');

  return `Tool execution results:

${resultsStr}

Based on these results, provide a helpful response to the user.
If there were errors, apologize briefly and suggest what they can do.
If successful, confirm what was done in a friendly, concise way.`;
}
