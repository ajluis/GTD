# LLM Tool-Based Architecture Plan

## Executive Summary

This document outlines the plan to migrate from the current "pre-fetch everything" LLM architecture to a "tool-use" agentic architecture where the LLM can request data lookups on demand.

---

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CURRENT FLOW                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SMS Message                                                             │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────┐    ┌──────────────────────────────────────┐            │
│  │   Inbound   │───▶│  Pre-fetch ALL context:              │            │
│  │  Processor  │    │  - User settings & timezone          │            │
│  └─────────────┘    │  - All people (50-500 rows)          │            │
│                     │  - Last 10 messages                  │            │
│                     │  - Conversation states               │            │
│                     └──────────────────────────────────────┘            │
│                                    │                                     │
│                                    ▼                                     │
│                     ┌──────────────────────────────────────┐            │
│                     │  Single Gemini Call with ALL data    │            │
│                     │  in prompt (large context)           │            │
│                     └──────────────────────────────────────┘            │
│                                    │                                     │
│                                    ▼                                     │
│                     ┌──────────────────────────────────────┐            │
│                     │  Route based on classification:      │            │
│                     │  - Intent → Handler (more DB calls)  │            │
│                     │  - Task → Create + Notion sync       │            │
│                     │  - Clarify → Store state             │            │
│                     └──────────────────────────────────────┘            │
│                                    │                                     │
│                                    ▼                                     │
│                          Template Response                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Characteristics:**
- All data pre-fetched before LLM call
- Large prompt with full people list (can be 500+ entries)
- Single LLM call per message
- Template-based responses (not LLM-generated)
- Intent handlers do additional DB/Notion queries after classification

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROPOSED FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  SMS Message                                                             │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────┐    ┌──────────────────────────────────────┐            │
│  │   Inbound   │───▶│  Minimal context fetch:              │            │
│  │  Processor  │    │  - User ID & timezone only           │            │
│  └─────────────┘    └──────────────────────────────────────┘            │
│                                    │                                     │
│                                    ▼                                     │
│                     ┌──────────────────────────────────────┐            │
│                     │  LLM TURN 1: Classification          │            │
│                     │  "What does the user want to do?"    │            │
│                     │                                      │            │
│                     │  Output: Intent + required lookups   │            │
│                     └──────────────────────────────────────┘            │
│                                    │                                     │
│                          ┌────────┴────────┐                            │
│                          ▼                 ▼                            │
│               ┌───────────────┐   ┌───────────────┐                     │
│               │ Tool: lookup  │   │ Tool: lookup  │                     │
│               │ _people       │   │ _tasks        │                     │
│               └───────────────┘   └───────────────┘                     │
│                          │                 │                            │
│                          └────────┬────────┘                            │
│                                   ▼                                     │
│                     ┌──────────────────────────────────────┐            │
│                     │  Worker: Execute tool calls          │            │
│                     │  - Fetch only requested data         │            │
│                     │  - Return structured results         │            │
│                     └──────────────────────────────────────┘            │
│                                    │                                     │
│                                    ▼                                     │
│                     ┌──────────────────────────────────────┐            │
│                     │  LLM TURN 2: Generate Response       │            │
│                     │  - Sees tool results                 │            │
│                     │  - Determines action to take         │            │
│                     │  - Generates natural response        │            │
│                     └──────────────────────────────────────┘            │
│                                    │                                     │
│                          ┌────────┴────────┐                            │
│                          ▼                 ▼                            │
│               ┌───────────────┐   ┌───────────────┐                     │
│               │ Tool: create  │   │ Tool: update  │                     │
│               │ _task         │   │ _settings     │                     │
│               └───────────────┘   └───────────────┘                     │
│                                    │                                     │
│                                    ▼                                     │
│                          LLM-Generated Response                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Comparison: Current vs Proposed

| Aspect | Current Architecture | Proposed Architecture |
|--------|---------------------|----------------------|
| **LLM Calls** | 1 per message | 2-4 per message (tool loop) |
| **Context Size** | Large (full people list) | Small (only what's needed) |
| **Data Fetching** | Pre-fetch everything | On-demand via tools |
| **Response Style** | Template-based | LLM-generated |
| **Latency** | Lower (single call) | Higher (multiple round-trips) |
| **Cost** | Lower tokens per message | Higher tokens (multiple calls) |
| **Flexibility** | Limited to pre-defined intents | Dynamic, can handle new patterns |
| **Maintenance** | High (50+ intent handlers) | Lower (tools are simpler) |

---

## Pros and Cons

### Pros of Proposed Architecture

1. **Reduced Prompt Size**
   - No longer need to embed 500+ people in every prompt
   - LLM requests only the data it needs
   - Better token efficiency per call

2. **More Natural Responses**
   - LLM generates contextual, natural language
   - No more template string building
   - Can adapt tone and detail level

3. **Simplified Intent Handling**
   - Remove 50+ intent handler functions
   - Tools replace hardcoded intent routing
   - Easier to add new capabilities (just add a tool)

4. **Better Multi-Turn Conversations**
   - LLM can naturally handle follow-ups
   - No need for conversation_states table
   - More flexible clarification handling

5. **Reduced Code Complexity**
   - Replace `classify.ts` (400+ lines) with tool definitions
   - Remove most of `intent-handlers/` directory
   - Single unified processing loop

6. **Dynamic Query Capability**
   - LLM can combine multiple queries
   - "Show me all tasks for John due this week" becomes natural
   - Complex queries don't need new intent types

7. **Easier Debugging**
   - Tool call traces show exactly what LLM requested
   - Clear separation between LLM reasoning and data access

### Cons of Proposed Architecture

1. **Higher Latency**
   - Multiple LLM round-trips (2-4 calls vs 1)
   - Each tool call adds network latency
   - SMS response time could increase from ~2s to ~5-8s

2. **Higher Cost**
   - More LLM API calls per message
   - Estimate: 2-3x token cost increase
   - Tool call overhead adds tokens

3. **Less Predictable Responses**
   - LLM may generate inconsistent responses
   - Harder to guarantee exact message formats
   - May need output guardrails

4. **More Complex Error Handling**
   - Tool execution can fail mid-conversation
   - Need to handle partial failures gracefully
   - LLM may retry failed tools unexpectedly

5. **Testing Complexity**
   - Need to mock tool calls in tests
   - Non-deterministic LLM behavior harder to test
   - May need snapshot testing for responses

6. **Security Considerations**
   - LLM could potentially request unauthorized data
   - Need strict tool permission boundaries
   - Data leakage risk if tools are too permissive

7. **Migration Effort**
   - Significant refactoring required
   - Need to maintain backwards compatibility during rollout
   - Risk of regressions in existing functionality

---

## Implementation Plan

### Phase 1: Tool Definitions & Infrastructure

**Files to Create:**
```
packages/ai/
├── tools/
│   ├── index.ts                 # Tool registry
│   ├── types.ts                 # Tool interface definitions
│   ├── lookup-tools.ts          # Read-only data tools
│   │   ├── lookupPeople         # Search people by name/criteria
│   │   ├── lookupTasks          # Query tasks with filters
│   │   ├── lookupMessages       # Get conversation history
│   │   ├── lookupUserSettings   # Get user preferences
│   │   └── queryNotion          # Direct Notion queries
│   ├── action-tools.ts          # Write/mutation tools
│   │   ├── createTask           # Create new task
│   │   ├── completeTask         # Mark task complete
│   │   ├── updateTask           # Modify task properties
│   │   ├── createPerson         # Add new person
│   │   ├── updatePerson         # Modify person
│   │   └── updateSettings       # Change user settings
│   └── tool-executor.ts         # Safe tool execution wrapper
```

**Tool Definition Example:**
```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (params: unknown, context: ToolContext) => Promise<ToolResult>;
}

const lookupPeople: Tool = {
  name: 'lookup_people',
  description: 'Search for people in the user\'s contact list by name or criteria',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Name or partial name to search' },
      meetingDay: { type: 'string', enum: ['monday', 'tuesday', ...] },
      limit: { type: 'number', default: 10 }
    }
  },
  execute: async (params, ctx) => {
    // DB query with user scoping
  }
};
```

### Phase 2: Agent Loop Implementation

**Files to Create/Modify:**
```
packages/ai/
├── agent.ts                     # Main agent loop
├── gemini-client.ts             # Add tool calling support
└── prompts/
    └── agent-system.ts          # New system prompt for tool use
```

**Agent Loop Logic:**
```typescript
async function runAgentLoop(
  message: string,
  tools: Tool[],
  context: AgentContext,
  maxIterations: number = 5
): Promise<AgentResult> {
  const messages: Message[] = [
    { role: 'system', content: AGENT_SYSTEM_PROMPT },
    { role: 'user', content: message }
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await gemini.generateWithTools(messages, tools);

    if (response.type === 'text') {
      // Final response, return to user
      return { response: response.content, toolCalls: [] };
    }

    if (response.type === 'tool_calls') {
      // Execute all tool calls
      const results = await executeTools(response.toolCalls, context);

      // Add to conversation
      messages.push({ role: 'assistant', content: response });
      messages.push({ role: 'tool', content: results });
    }
  }

  throw new Error('Max iterations exceeded');
}
```

### Phase 3: Migrate Classification Logic

**Files to Modify:**
```
apps/worker/src/processors/
├── classify.ts                  # Refactor to use agent loop
└── intent-handlers/             # Gradually deprecate
```

**Migration Strategy:**
1. Create feature flag `USE_TOOL_ARCHITECTURE`
2. Run both systems in parallel (shadow mode)
3. Compare outputs and measure latency/cost
4. Gradually increase traffic to new system
5. Deprecate old intent handlers

### Phase 4: Response Generation

**Current Template Approach:**
```typescript
// Old way - templates in intent handlers
return `✅ Task captured!\n\n📋 ${task.title}\n📁 ${task.type}`;
```

**New LLM-Generated Approach:**
```typescript
// New way - LLM generates response
// System prompt includes response guidelines:
// - Keep responses under 160 chars when possible
// - Use relevant emojis sparingly
// - Confirm the action taken
// - Be conversational but concise
```

### Phase 5: Testing & Validation

**Test Strategy:**
```
tests/
├── tools/
│   ├── lookup-tools.test.ts     # Unit tests for each tool
│   └── action-tools.test.ts
├── agent/
│   ├── agent-loop.test.ts       # Agent loop logic
│   └── tool-execution.test.ts
└── integration/
    ├── message-flow.test.ts     # End-to-end message processing
    └── response-quality.test.ts # LLM response validation
```

**Validation Metrics:**
- Response latency (target: <5s p95)
- Token usage per message
- Task capture accuracy
- User satisfaction (implicit from usage)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Latency increase | Implement response streaming, cache common lookups |
| Cost increase | Set token budgets, use smaller model for classification |
| Inconsistent responses | Add output validation, response templates as fallback |
| Security | Strict tool scoping, audit logging, rate limiting |
| Migration failures | Feature flags, shadow mode testing, gradual rollout |

---

## Timeline Estimate

| Phase | Effort |
|-------|--------|
| Phase 1: Tool Infrastructure | Foundation work |
| Phase 2: Agent Loop | Core implementation |
| Phase 3: Migration | Incremental migration |
| Phase 4: Response Generation | Polish and tuning |
| Phase 5: Testing & Validation | Quality assurance |

**Note:** Actual timing depends on team capacity and priorities.

---

## Decision Points

Before proceeding, consider:

1. **Is the latency increase acceptable?**
   - Current: ~2s response time
   - Projected: ~5-8s response time
   - SMS users may tolerate this, but worth validating

2. **Is the cost increase justified?**
   - Current: ~$X per 1000 messages
   - Projected: ~$2-3X per 1000 messages
   - ROI from reduced maintenance?

3. **Do we need LLM-generated responses?**
   - Template responses are predictable and tested
   - LLM responses are more natural but variable
   - Could use hybrid: LLM for complex, templates for simple

4. **Rollback strategy?**
   - Keep old code paths during migration
   - Feature flags for instant rollback
   - Monitor error rates closely

---

## Recommended Approach

Given the trade-offs, I recommend a **hybrid approach**:

1. **Keep classification as single LLM call** (current approach works well)
2. **Add tool use for complex queries only** (dynamic data needs)
3. **Keep template responses** (predictable, tested)
4. **Add LLM response generation as optional enhancement**

This gives the benefits of tool-based data lookup without the full cost/latency penalty of a pure agentic architecture.

---

## Appendix: Tool Catalog

### Read-Only Tools (Safe)

| Tool | Description | Parameters |
|------|-------------|------------|
| `lookup_people` | Search contacts | query, meetingDay, limit |
| `lookup_tasks` | Query tasks | type, status, personId, dueBefore, context |
| `lookup_messages` | Get conversation history | limit, before |
| `get_user_settings` | Get user preferences | (none) |
| `query_notion_tasks` | Query Notion directly | filter, sorts |
| `get_today_summary` | Get daily task summary | (none) |

### Write Tools (Require Confirmation)

| Tool | Description | Parameters |
|------|-------------|------------|
| `create_task` | Create new task | title, type, context, priority, dueDate, personId |
| `complete_task` | Mark task done | taskId or taskTitle |
| `update_task` | Modify task | taskId, updates |
| `delete_task` | Remove task | taskId |
| `create_person` | Add contact | name, aliases, frequency, dayOfWeek |
| `update_person` | Modify contact | personId, updates |
| `update_settings` | Change preferences | setting, value |
