# GTD - SMS-Based GTD Task Management

GTD is an SMS-based GTD (Getting Things Done) assistant that syncs with Notion. Text your tasks, thoughts, and discussion topics — GTD uses AI to classify them and organizes everything in Notion automatically.

## Features

- 📱 **SMS Interface** - Capture tasks naturally via text message
- 🤖 **AI Classification** - Gemini AI categorizes tasks into GTD types
- 📋 **Notion Sync** - Tasks automatically appear in your Notion workspace
- 👥 **Agenda Management** - Track discussion topics for each person you meet with
- ⏳ **Waiting Items** - Track what you're waiting for from others
- 💭 **Someday/Maybe** - Capture future ideas without cluttering your actions

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 + TypeScript |
| SMS Gateway | Sendblue |
| AI | Google Gemini Flash (gemini-2.0-flash) |
| Database | Notion API + PostgreSQL |
| Job Queue | Redis + BullMQ |
| Hosting | Railway |

## Project Structure

```
gtd/
├── apps/
│   ├── api/          # Fastify webhook server
│   └── worker/       # BullMQ message processor
├── packages/
│   ├── database/     # Drizzle ORM schemas
│   ├── queue/        # BullMQ configuration
│   ├── sendblue/     # Sendblue API client
│   ├── notion/       # Notion API integration
│   ├── ai/           # Gemini classification
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
   git clone https://github.com/ajluis/GTD.git clarity
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

# Notion
NOTION_CLIENT_ID=
NOTION_CLIENT_SECRET=
NOTION_REDIRECT_URI=

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
                                            Worker processes:
                                            1. Classify with Gemini AI
                                            2. Create local task
                                            3. Sync to Notion
                                            4. Send confirmation SMS
```

## License

MIT
