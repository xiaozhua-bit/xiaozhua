# xz - AI Agent with Memory & Autonomy

A minimal AI agent combining retrieval-based memory, scheduled tasks, heartbeat autonomy, and a beautiful terminal UI.

## Core Philosophy

- **Identity** (WHO) → SOUL.md/USER.md - Injected at session start
- **Knowledge** (WHAT) → Pre-loaded MEMORY.md + searchable via `xz memory`
- **History** → Searchable via `xz history`, paginated access
- **Scheduler** → TUI-embedded (2s tick), tasks execute in chat flow
- **Heartbeat** → Autonomous wakeups for long-running tasks
- **Agent Self-Modification** → Agent can update its own config via tools

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TUI Mode (pi-tui)                               │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Messages (scrollable, native terminal scroll)                     │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │ CTX [████████░░░] 45.2% auto 15m ●                        │  │  │
│  │  │ > _                                                        │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────┤
│                         Context Window (200K)                           │
├─────────────────────────────────────────────────────────────────────────┤
│  [PRE-LOADED: Always in context]                                        │
│   - SOUL.md (~1-2K tokens)         Identity: who I am                   │
│   - USER.md (~0.5-1K tokens)       Identity: who the user is            │
│   - MEMORY.md (~2-4K tokens)       Knowledge: key facts                 │
│   - Recent daily logs (~1-2K)      Knowledge: recent events             │
├─────────────────────────────────────────────────────────────────────────┤
│  [ACTIVE: Growing conversation]                                         │
│   - User messages                                                       │
│   - Agent responses                                                     │
│   - ⏰ Wakeup messages (from scheduler)                                  │
│   - 💓 Heartbeat messages (autonomous execution)                         │
│   - Compaction at ~150K (rarely needed)                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
┌───────────────────┐  ┌──────────────────────┐  ┌───────────────────┐
│   Identity Docs   │  │   Knowledge Source   │  │   Search Index    │
│                   │  │                      │  │   (SQLite)        │
│  .agents/SOUL.md  │  │  .agents/MEMORY.md   │  │                   │
│  .agents/USER.md  │  │  memory/2026-03-03   │  │  BM25 (FTS5)      │
│                   │  │  memory/2026-03-04   │  │  Chunks table     │
└───────────────────┘  └──────────────────────┘  └───────────────────┘
         │                       │                         │
         └───────────────────────┼─────────────────────────┘
                                 │
┌────────────────────────────────┼────────────────────────────────────┐
│                                ▼                                    │
│              ┌───────────────────────────────────┐                  │
│              │      Chat History (SQLite)        │                  │
│              │  sessions + messages + FTS5       │                  │
│              │  (stored in data/agent.db)        │                  │
│              └───────────────────────────────────┘                  │
│                                │                                    │
└────────────────────────────────┼────────────────────────────────────┘
                                 │
                                 ▼
              ┌───────────────────────────────────┐
              │   xz CLI (Self-Invocation)        │
              │                                   │
              │  xz memory search <query>         │
              │  xz memory get <file> --lines     │
              │  xz history search <query>        │
              │  xz history session <id>          │
              │  xz heartbeat start               │
              │                                   │
              └───────────────────────────────────┘
```

## Tech Stack

- **Language**: TypeScript (Node.js 18+)
- **Package Manager**: pnpm
- **TUI Framework**: @mariozechner/pi-tui (differential rendering)
- **Database**: better-sqlite3 (unified: history + knowledge + scheduler)
- **CLI Framework**: commander.js
- **Prompts**: @clack/prompts (beautiful setup wizard)
- **Colors**: picocolors
- **Build**: TypeScript + jiti (dev mode)

## Project Structure

```
xz/
├── bin/xz.js                   # CLI entry point
├── src/
│   ├── cli/
│   │   ├── index.ts            # CLI parser & commands
│   │   ├── memory.ts           # xz memory commands
│   │   ├── history.ts          # xz history commands
│   │   ├── schedule.ts         # xz schedule commands
│   │   ├── heartbeat.ts        # xz heartbeat commands
│   │   └── skills.ts           # xz skill commands
│   ├── tui/
│   │   ├── index.ts            # TUI exports
│   │   └── pi-app.ts           # pi-tui based TUI
│   ├── core/
│   │   ├── agent.ts            # Main agent orchestration
│   │   ├── llm.ts              # LLM client (OpenAI-compatible)
│   │   ├── prompt.ts           # System prompt builder
│   │   └── heartbeat.ts        # Autonomous execution
│   ├── config/
│   │   ├── index.ts            # Config load/save
│   │   ├── types.ts            # XZConfig interface
│   │   ├── wizard.ts           # First-run setup (@clack/prompts)
│   │   ├── kimi.ts             # Kimi OAuth integration
│   │   ├── validators.ts       # Config validation
│   │   └── reloader.ts         # Hot-reload with file watching
│   ├── identity/
│   │   └── loader.ts           # SOUL.md/USER.md loader
│   ├── knowledge/
│   │   ├── types.ts            # Knowledge types
│   │   ├── manager.ts          # Chunk CRUD
│   │   └── search.ts           # FTS5 search
│   ├── history/
│   │   ├── database.ts         # SQLite connection
│   │   ├── session.ts          # Session CRUD
│   │   ├── messages.ts         # Message storage
│   │   └── search.ts           # History search (BM25)
│   ├── scheduler/
│   │   ├── types.ts            # Scheduler types
│   │   ├── manager.ts          # Task CRUD
│   │   └── ticker.ts           # 2s interval checker
│   ├── skills/
│   │   ├── types.ts            # Skill types
│   │   ├── loader.ts           # Load from .agents/skills
│   │   ├── registry.ts         # Skill registry
│   │   └── builtin.ts          # Built-in skills
│   └── tools/
│       └── config.ts           # Agent self-modification tool
├── .agents/                    # User's agent files
│   ├── SOUL.md                 # Agent identity
│   ├── USER.md                 # User profile
│   ├── MEMORY.md               # Key facts
│   └── skills/                 # User's custom skills
├── data/
│   └── agent.db                # SQLite: knowledge + history + schedule
├── ~/.xz/
│   ├── config.toml             # User configuration
│   └── skills/                 # Personal skills
└── package.json
```

## Configuration (~/.xz/config.toml)

```toml
[model]
provider = "kimi"                    # kimi | openai | anthropic | custom
model = "kimi-for-coding"
base_url = "https://api.kimi.com/coding/v1"

[auth]
type = "oauth"                       # oauth | api_key
oauth_credentials_path = "~/.kimi/credentials/kimi-code.json"

[context]
max_tokens = 262144                  # 256K context
preload_identity = true
preload_memory = true

[scheduler]
enabled = true
check_interval_ms = 2000

[heartbeat]
enabled = false                      # Default off, enable for autonomy
interval_ms = 1800000                # 30 minutes
idle_threshold_ms = 300000           # 5 minutes idle before running
proactive_mode = true                # Agent decides what to do
check_pending_tasks = true
max_consecutive_runs = 3             # Safety throttle
auto_execute_tasks = true

[memory]
hybrid_search = true
semantic_weight = 0.7
keyword_weight = 0.3
```

## Features

### 1. CLI Commands

```bash
# TUI mode (default)
xz

# Memory operations
xz memory search <query> [--limit N] [--page N]
xz memory get <file> [--start-line N] [--end-line N]
xz memory list

# History operations
xz history search <query> [--date-from YYYY-MM-DD]
xz history session <session-id>
xz history list

# Scheduled tasks (time-based)
xz schedule add "Daily backup" 09:00 --recurring daily
xz schedule list
xz schedule remove <task-id>

# Autonomous heartbeat (long-running tasks)
xz heartbeat status
xz heartbeat start --interval 30
xz heartbeat config --proactive true
xz heartbeat watch

# Skill management
xz skill list
xz skill show <name>
```

### 2. TUI Interface (pi-tui)

- **Differential Rendering**: Only updates changed lines, no flicker
- **Native Terminal Scroll**: Messages scroll naturally with terminal
- **Context Bar**: `CTX [████████░░░] 45.2% auto 15m ●`
  - Green/Yellow/Red bar based on usage
  - Heartbeat countdown
  - Processing indicator
- **Slash Commands**: `/help`, `/new`, `/memory`, `/history`, `/tasks`, `/heartbeat`, `/config`
- **Shortcuts**: `Ctrl+C` quit, `Shift+Ctrl+D` help

### 3. Heartbeat (Autonomous Execution)

```
User idle for 25m
     ↓
[HEARTBEAT WAKEUP]
     ↓
Agent evaluates:
- Pending tasks?
- Long-running work?
- Proactive opportunities?
     ↓
Decision:
- Execute task → Report result
- Nothing to do → "All caught up"
- Self-modify → Update config
```

**Smart Behavior:**
- Skips if user recently active (< 5min)
- Skips if agent busy processing
- Throttles after 3 consecutive runs
- Can be configured via `update_config` tool

### 4. Agent Self-Modification

Agent can modify its own configuration via tool:

```typescript
// Agent decides to change heartbeat interval
update_config("heartbeat.intervalMs", 3600000)  // 1 hour
update_config("heartbeat.proactiveMode", true)
```

Changes trigger **hot-reload** immediately without restart.

### 5. Three-Layer Memory

| Layer | Type | Content | Access |
|-------|------|---------|--------|
| **Identity** | Pre-loaded | SOUL.md, USER.md | System prompt |
| **Knowledge** | Pre-loaded | MEMORY.md, daily logs | System prompt |
| **Retrieval** | On-demand | All history & memory | `xz` CLI via skills |

### 6. Skills System

**Priority (high to low):**
1. `.agents/skills/` (priority 100) - User override
2. `~/.xz/skills/` (priority 75) - Personal skills
3. `~/.claude/skills/` (priority 50) - Compatibility

**Built-in Skills:**
- `memory-search`: Search knowledge memory
- `history-search`: Search chat history
- `get-session`: Retrieve full session

### 7. Database Schema (SQLite)

```sql
-- Sessions & Messages with FTS5
CREATE TABLE sessions (id, created_at, updated_at, title, message_count);
CREATE TABLE messages (id, session_id, role, content, tool_calls, metadata, created_at);
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages');

-- Knowledge Chunks with FTS5
CREATE TABLE knowledge_chunks (id, file, line_start, line_end, content, tags, created_at);
CREATE VIRTUAL TABLE knowledge_fts USING fts5(content, content='knowledge_chunks');

-- Scheduled Tasks
CREATE TABLE scheduled_tasks (
  id, description, cron, execute_at, interval_seconds,
  is_recurring, is_enabled, last_executed_at, last_execution_status
);

-- Task Executions
CREATE TABLE task_executions (id, task_id, started_at, completed_at, status, output, error);
```

### 8. First-Run Setup

Beautiful interactive wizard using @clack/prompts:

```
┌  🤖 xz — AI Agent with Memory
│
◆  Select your LLM provider
│  ● 🌙 Kimi Code (推荐) (✓ detected)
│  ○ 🤖 OpenAI
│  ○ 🧠 Anthropic (Claude)
│  ○ ⚙️ Custom OpenAI-compatible
└
```

Features:
- Provider icons (🌙🤖🧠⚙️)
- Auto-detection of credentials
- Password input for API keys
- Heartbeat configuration
- Spinner animations

## Development

```bash
# Install dependencies
pnpm install

# Run CLI in dev mode (no build needed)
pnpm cli
pnpm cli:memory search "git"

# Build
pnpm build

# Test
pnpm test

# Type check
pnpm typecheck
```

## Implementation Phases (Completed)

1. **Phase 1**: Core + CLI Foundation ✅
2. **Phase 2**: Memory & History System ✅
3. **Phase 3**: Scheduler & Skills ✅
4. **Phase 4**: Integration & Polish ✅
5. **Phase 5**: Heartbeat & Autonomy ✅
6. **Phase 6**: Beautiful UI (pi-tui + @clack/prompts) ✅
