# xz - AI Agent CLI

An AI agent CLI combining retrieval-based memory with SOUL.md identity mechanism.

## Features

- **Identity Layer**: Pre-loaded SOUL.md and USER.md for persistent personality
- **Knowledge Memory**: Searchable memory with FTS5 (BM25) indexing
- **Chat History**: Persistent conversation history with full-text search
- **TUI Mode**: Interactive terminal UI with embedded scheduler
- **Scheduled Tasks**: Run tasks every 2s while TUI is active
- **Heartbeat**: Autonomous execution for long-running tasks (periodic wakeups)
- **Self-Invocation**: Agent uses `xz` CLI commands via skills

## Installation

```bash
# Clone the repository
git clone <repo>
cd xz

# Install dependencies
pnpm install

# Build
pnpm build

# Link for global use (optional)
pnpm link --global
```

## First Run

On first launch, `xz` will guide you through configuration:

```bash
xz
# → Interactive setup wizard for model provider selection
```

Or configure manually:

```bash
# If you have Kimi Code installed
xz config --reset

# Or set env vars for other providers
export OPENAI_API_KEY=sk-...
xz config --reset
```

## Usage

### TUI Mode (Default)

```bash
xz
```

### CLI Commands

```bash
# Memory operations
xz memory search "git preferences"
xz memory get memory/2026-03-03.md --start-line 10 --end-line 20
xz memory list

# History operations
xz history search "database schema"
xz history session <session-id> --limit 20
xz history list

# Scheduled tasks (time-based)
xz schedule list
xz schedule add "Daily backup" 09:00 --recurring daily
xz schedule remove <task-id>

# Autonomous heartbeat (long-running tasks)
# Config in ~/.xz/config.toml: [heartbeat] section
xz heartbeat status              # Show heartbeat stats
xz heartbeat start               # Start autonomous mode (30min interval)
xz heartbeat start --interval 30      # Start with custom interval (minutes)
xz heartbeat config              # Show heartbeat configuration
xz heartbeat config --interval 60     # Set interval to 60 minutes
xz heartbeat config --proactive true  # Enable proactive mode
xz heartbeat enable              # Enable in config (starts on next launch)
xz heartbeat disable             # Disable in config
xz heartbeat watch               # Watch real-time execution
xz heartbeat tick                # Force single execution
xz heartbeat stop                # Stop autonomous mode

# Skills
xz skill list
xz skill show memory-search

# Configuration
xz config
xz config --reset
```

## Project Structure

```
xz/
├── .agents/              # Identity documents
│   ├── SOUL.md          # Agent identity
│   ├── USER.md          # User profile
│   ├── MEMORY.md        # Key facts
│   └── skills/          # Custom skills
├── data/
│   └── agent.db         # SQLite (history + knowledge + scheduler)
├── src/
│   ├── cli/             # CLI commands
│   ├── config/          # Configuration management
│   ├── core/            # LLM, agent orchestration
│   ├── history/         # Session & message storage
│   ├── identity/        # SOUL.md/USER.md loader
│   ├── knowledge/       # Memory chunk management
│   ├── scheduler/       # Task scheduling (2s tick)
│   ├── skills/          # Skill loader & registry
│   └── tui/             # Terminal UI
```

## Configuration

Config file: `~/.xz/config.toml`

```toml
[model]
provider = "kimi"
model = "kimi-for-coding"
base_url = "https://api.kimi.com/coding/v1"

[auth]
type = "oauth"
oauth_credentials_path = "~/.kimi/credentials/kimi-code.json"

[context]
max_tokens = 262144
preload_identity = true
preload_memory = true

[scheduler]
enabled = true
check_interval_ms = 2000

[heartbeat]
enabled = false              # Set to true to enable autonomous execution
interval_ms = 1800000        # 30 minutes between wakeups
idle_threshold_ms = 300000   # 5 minutes idle before running
proactive_mode = true        # Agent decides what to do based on memory
check_pending_tasks = true   # Check for scheduled tasks
max_consecutive_runs = 3     # Safety throttle
auto_execute_tasks = true    # Allow autonomous execution
```

## Development

```bash
# Run tests
pnpm test

# Type check
pnpm typecheck

# Dev mode (watch)
pnpm dev
```

## License

MIT
