# GTD - SMS-Based GTD Task Management

GTD is an SMS-based GTD (Getting Things Done) assistant powered by a UnifiedAgent that manages tasks directly in Todoist (the source of truth). Text your tasks, thoughts, and discussion topics — the AI agent classifies them and organizes everything in Todoist automatically using 23 specialized tools.

## Features

- 📱 **SMS Interface** - Capture tasks naturally via text message
- 🤖 **UnifiedAgent** - Gemini-powered agent with 23 specialized tools
- ✅ **Todoist Native** - Todoist is the source of truth (no local sync)
- 👥 **Agenda Management** - Track discussion topics for each person you meet with
- ⏳ **Waiting Items** - Track what you're waiting for from others
- 💭 **Someday/Maybe** - Capture future ideas without cluttering your actions
- 🧠 **Learning Memory** - Corrections become future defaults

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 + TypeScript |
| SMS Gateway | Sendblue |
| AI | Google Gemini Flash (gemini-2.0-flash) |
| Task Storage | Todoist API + PostgreSQL |
| Job Queue | Redis + BullMQ |
| Hosting | Railway |

## Project Structure

```
gtd/
├── apps/
│   ├── api/          # Fastify webhook server
│   ├── worker/       # BullMQ message processor (runs UnifiedAgent)
│   └── scheduler/    # Cron jobs (daily digest, reminders)
├── packages/
│   ├── ai/           # UnifiedAgent + tool system + Gemini client
│   ├── mcp/          # MCP client for Todoist integration
│   ├── context/      # User context (preferences, patterns)
│   ├── memory/       # Long-term memory & learning
│   ├── database/     # Drizzle ORM schemas
│   ├── queue/        # BullMQ configuration
│   ├── sendblue/     # Sendblue API client
│   ├── todoist/      # Todoist REST API (source of truth)
│   ├── gtd/          # GTD domain logic
│   └── shared-types/ # TypeScript types
└── docker-compose.yml
```

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker (for local development)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/ajluis/GTD.git gtd
   cd gtd
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Start local services**
   ```bash
   docker-compose up -d
   ```

4. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

5. **Run database migrations**
   ```bash
   pnpm db:push
   ```

6. **Start development servers**
   ```bash
   # In separate terminals:
   pnpm --filter @gtd/api dev
   pnpm --filter @gtd/worker dev
   ```

### Environment Variables

```bash
# Database
DATABASE_URL=postgres://gtd:gtd@localhost:5432/gtd

# Redis
REDIS_URL=redis://localhost:6379

# Sendblue
SENDBLUE_API_KEY=
SENDBLUE_API_SECRET=
SENDBLUE_WEBHOOK_SECRET=
SENDBLUE_PHONE_NUMBER=

# Todoist
TODOIST_API_TOKEN=

# Google AI
GOOGLE_AI_API_KEY=
```

## SMS Commands

| Command | Action |
|---------|--------|
| `today` | Show today's tasks |
| `actions` | List all action items |
| `@work` / `@home` | Filter by context |
| `projects` | Show active projects |
| `waiting` | Show waiting items |
| `someday` | Show future ideas |
| `meetings` | List your people |
| `done [text]` | Mark item complete |
| `help` | Show commands |

## Architecture

```
SMS arrives → Sendblue Webhook → API Server → BullMQ Queue
                                                    ↓
                                            Worker runs UnifiedAgent:
                                            1. Load context (preferences, patterns)
                                            2. Retrieve relevant memories
                                            3. Run agent loop with tools
                                            4. Tools query/update Todoist directly
                                               (Todoist = source of truth)
                                            5. Send confirmation SMS
```

## License

MIT
