# AI Agent Implementation Plan

## Overview
Build a minimal AI agent combining **OpenClaw's retrieval-based memory system** with **SOUL.md identity mechanism**. The agent is distributed as a CLI called `xz`, which provides both interactive TUI mode and command-line access to memory/history.

**Core Philosophy**: 
- **Identity** (WHO) → SOUL.md/USER.md - Injected at session start
- **Knowledge** (WHAT) → Pre-loaded MEMORY.md + searchable via `xz memory`
- **History** → Searchable via `xz history`, paginated access
- **Scheduler** → TUI-embedded (2s tick), tasks execute in chat flow  
- **Agent invokes itself** → Skills wrap `xz` CLI commands

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         TUI Mode (xz)                                   │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Background Scheduler (每 2s 检查)                                 │  │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │  │
│  │  │ Check tasks │ →  │ Task due?   │ →  │ Insert wakeup msg   │   │  │
│  │  └─────────────┘    └─────────────┘    └─────────────────────┘   │  │
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
│   - Task execution output                                               │
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
│                   │  │  memory/2026-03-04   │  │  Vector (vec0)    │
└───────────────────┘  └──────────────────────┘  └───────────────────┘
         │                       │                         │
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
              │  xz history list                  │
              │                                   │
              └───────────────────────────────────┘
```

---

## xz CLI Design

### 首次使用配置流程

当 `~/.xz/config.toml` 不存在时，TUI 启动会进入配置向导：

```
┌──────────────────────────────────────────────────────────────┐
│ 🤖 Welcome to xz - AI Agent                                  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  首次使用，请选择模型提供商：                                  │
│                                                              │
│  [1] Kimi Code (推荐)                                        │
│      ✓ 检测到本地 OAuth 凭证                                  │
│      模型: kimi-for-coding (256K context)                     │
│                                                              │
│  [2] OpenAI                                                  │
│      需要 OPENAI_API_KEY                                      │
│                                                              │
│  [3] Anthropic (Claude)                                      │
│      需要 ANTHROPIC_API_KEY                                   │
│                                                              │
│  [4] 自定义 OpenAI-compatible                                │
│      兼容 OpenAI API 的第三方服务                             │
│                                                              │
│  > 1                                                         │
│  ✅ 已选择 Kimi Code                                         │
│  配置已保存到 ~/.xz/config.toml                              │
│                                                              │
│  按 Enter 开始...                                            │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 配置文件结构

```toml
# ~/.xz/config.toml

[model]
provider = "kimi"                    # kimi | openai | anthropic | custom
model = "kimi-for-coding"            # 具体模型ID
base_url = "https://api.kimi.com/coding/v1"  # API base URL

# OAuth 或 API Key 配置
[auth]
type = "oauth"                       # oauth | api_key
# OAuth 配置（如 Kimi）
oauth_credentials_path = "~/.kimi/credentials/kimi-code.json"
# 或 API Key（如 OpenAI）
# api_key = "sk-..."

# 高级配置（可选）
[context]
max_tokens = 262144                  # 最大上下文
preload_identity = true              # 预加载 SOUL.md/USER.md
preload_memory = true                # 预加载 MEMORY.md

[scheduler]
enabled = true                       # 启用内置调度器
check_interval_ms = 2000             # 检查间隔

[memory]
hybrid_search = true                 # 启用混合搜索
semantic_weight = 0.7                # 语义搜索权重
keyword_weight = 0.3                 # 关键词搜索权重

# 首次配置标志
[setup]
completed = true                     # 是否完成首次配置
completed_at = "2026-03-03T12:00:00+08:00"
```

### 配置管理命令

```bash
# 查看当前配置
xz config

# 修改配置（交互式）
xz config set

# 切换模型
xz config provider <provider>
xz config model <model>

# 重新运行首次配置向导
xz config setup --reset

# 验证配置
xz config verify
```

### 配置加载逻辑

```typescript
// src/config/index.ts
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parse } from '@iarna/toml';

const CONFIG_DIR = join(homedir(), '.xz');
const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');

export interface XZConfig {
  model: {
    provider: 'kimi' | 'openai' | 'anthropic' | 'custom';
    model: string;
    baseUrl: string;
  };
  auth: {
    type: 'oauth' | 'api_key';
    oauthCredentialsPath?: string;
    apiKey?: string;
  };
  context: {
    maxTokens: number;
    preloadIdentity: boolean;
    preloadMemory: boolean;
  };
  scheduler: {
    enabled: boolean;
    checkIntervalMs: number;
  };
  memory: {
    hybridSearch: boolean;
    semanticWeight: number;
    keywordWeight: number;
  };
  setup: {
    completed: boolean;
    completedAt?: string;
  };
}

// 检查是否首次使用
export function isFirstRun(): boolean {
  return !existsSync(CONFIG_FILE);
}

// 加载配置
export function loadConfig(): XZConfig {
  if (isFirstRun()) {
    throw new FirstRunError('Config not found. Run setup first.');
  }
  
  const content = readFileSync(CONFIG_FILE, 'utf-8');
  return parse(content) as XZConfig;
}

// 保存配置
export function saveConfig(config: XZConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  
  const toml = stringify(config);
  writeFileSync(CONFIG_FILE, toml);
}
```

### 首次配置向导实现

```typescript
// src/tui/setup-wizard.ts
import { isFirstRun, saveConfig } from '../config';
import { detectKimiCredentials } from '../config/kimi';

export async function runSetupWizard(): Promise<void> {
  console.clear();
  console.log('🤖 Welcome to xz - AI Agent\n');
  
  // 检测可用的提供商
  const providers = await detectAvailableProviders();
  
  console.log('首次使用，请选择模型提供商：\n');
  
  providers.forEach((p, i) => {
    console.log(`[${i + 1}] ${p.name}`);
    if (p.detected) {
      console.log(`    ✓ 检测到本地配置`);
    }
    console.log(`    ${p.description}\n`);
  });
  
  // 用户选择
  const choice = await prompt('> ');
  const selected = providers[parseInt(choice) - 1];
  
  // 根据选择配置
  const config = await configureProvider(selected);
  
  // 保存配置
  config.setup = { completed: true, completedAt: new Date().toISOString() };
  saveConfig(config);
  
  console.log('\n✅ 配置已保存到 ~/.xz/config.toml');
  console.log('按 Enter 开始...');
  await prompt('');
}

// 检测可用的提供商
async function detectAvailableProviders(): Promise<ProviderOption[]> {
  const providers: ProviderOption[] = [
    {
      id: 'kimi',
      name: 'Kimi Code (推荐)',
      description: '模型: kimi-for-coding (256K context)',
      detected: detectKimiCredentials(),
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: '需要 OPENAI_API_KEY',
      detected: !!process.env.OPENAI_API_KEY,
    },
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      description: '需要 ANTHROPIC_API_KEY',
      detected: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      id: 'custom',
      name: '自定义 OpenAI-compatible',
      description: '兼容 OpenAI API 的第三方服务',
      detected: false,
    },
  ];
  
  return providers;
}
```

---

## xz CLI Design

### Command Structure

```bash
# Interactive TUI mode (default)
# 首次运行：进入配置向导
# 已配置：进入 TUI
xz

# Memory commands
xz memory search <query> [--limit N] [--semantic] [--page N]
xz memory get <file> [--start-line N] [--end-line N]
xz memory list [--date YYYY-MM-DD]

# History commands  
xz history search <query> [--limit N] [--session ID] [--page N]
xz history session <session-id> [--limit N] [--offset N]
xz history list [--limit N] [--page N]

# Skill management
xz skill list
xz skill create <name> [--from-template]
xz skill reload

# Scheduler (TUI mode only)
xz schedule list                    # List scheduled tasks
xz schedule add <task> <time>       # Add task (e.g., "daily backup" "09:00")
xz schedule remove <task-id>        # Remove task
# Note: Tasks only execute while TUI is running (every 2s check)
```

### CLI Implementation

```typescript
// src/cli/index.ts
import { Command } from 'commander';

const program = new Command('xz');

// Memory commands
program
  .command('memory')
  .description('Knowledge memory operations')
  .addCommand(
    new Command('search')
      .argument('<query>', 'Search query')
      .option('-l, --limit <n>', 'Results per page', '10')
      .option('-p, --page <n>', 'Page number', '1')
      .option('--semantic', 'Use semantic search', false)
      .option('--keyword', 'Use keyword search only', false)
      .action(async (query, options) => {
        const results = await memorySearch(query, {
          limit: parseInt(options.limit),
          offset: (parseInt(options.page) - 1) * parseInt(options.limit),
          semantic: options.semantic,
          keywordOnly: options.keyword
        });
        console.table(results);
      })
  )
  .addCommand(
    new Command('get')
      .argument('<file>', 'Memory file path')
      .option('-s, --start-line <n>', 'Start line', '1')
      .option('-e, --end-line <n>', 'End line')
      .action(async (file, options) => {
        const content = await memoryGet(file, {
          lineStart: parseInt(options.startLine),
          lineEnd: options.endLine ? parseInt(options.endLine) : undefined
        });
        console.log(content);
      })
  );

// History commands
program
  .command('history')
  .description('Chat history operations')
  .addCommand(
    new Command('search')
      .argument('<query>', 'Search query')
      .option('-l, --limit <n>', 'Results per page', '10')
      .option('-p, --page <n>', 'Page number', '1')
      .option('--date-from <date>', 'Start date (YYYY-MM-DD)')
      .option('--date-to <date>', 'End date (YYYY-MM-DD)')
      .action(async (query, options) => {
        const results = await historySearch(query, {
          limit: parseInt(options.limit),
          offset: (parseInt(options.page) - 1) * parseInt(options.limit),
          dateFrom: options.dateFrom,
          dateTo: options.dateTo
        });
        printHistoryResults(results, parseInt(options.page), parseInt(options.limit));
      })
  )
  .addCommand(
    new Command('session')
      .argument('<session-id>', 'Session ID')
      .option('-l, --limit <n>', 'Messages per page', '20')
      .option('-o, --offset <n>', 'Offset', '0')
      .action(async (sessionId, options) => {
        const session = await getSession(sessionId, {
          limit: parseInt(options.limit),
          offset: parseInt(options.offset)
        });
        printSession(session, parseInt(options.offset));
      })
  )
  .addCommand(
    new Command('list')
      .option('-l, --limit <n>', 'Sessions per page', '10')
      .option('-p, --page <n>', 'Page number', '1')
      .action(async (options) => {
        const sessions = await listSessions({
          limit: parseInt(options.limit),
          offset: (parseInt(options.page) - 1) * parseInt(options.limit)
        });
        console.table(sessions);
      })
  );

// Default: TUI mode
if (process.argv.length === 2) {
  // No args - check first run
  if (isFirstRun()) {
    await runSetupWizard();
  }
  startTUI();
} else {
  program.parse();
}
```

### Pagination Design

```typescript
interface PaginatedResult<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

interface MemorySearchResult {
  file: string;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  score: number;
}

interface HistorySearchResult {
  sessionId: string;
  sessionTitle?: string;
  messageId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: string;
  score: number;
}

// Paginated output format
function printPaginated<T>(
  result: PaginatedResult<T>,
  formatItem: (item: T) => string
): void {
  result.items.forEach(formatItem);
  
  console.log(`\nPage ${result.page}/${result.totalPages} (${result.total} total)`);
  if (result.hasPrev) console.log('Use --page', result.page - 1, 'for previous');
  if (result.hasNext) console.log('Use --page', result.page + 1, 'for next');
}
```

---

## Skills that Invoke xz CLI

Skills wrap `xz` CLI commands for the agent to use:

```typescript
// ~/.claude/skills/memory-search/SKILL.md
---
name: memory-search
description: Search knowledge memory for facts, decisions, or observations
argument-hint: "<query> [--page N]"
disable-model-invocation: false
---

Search the knowledge base when you need to recall information not in the pre-loaded MEMORY.md.

**Usage from agent:**
```bash
xz memory search "<query>" --limit 5
```

**When to use:**
- User asks about something from past conversations
- Need specific details not in current context
- Looking for user preferences or decisions

**Handling results:**
- Results include file path, line numbers, and snippet
- Use `xz memory get <file> --start-line N --end-line N` to read full content
- Ask user if they want to see more results (--page 2, etc.)

// ~/.claude/skills/history-search/SKILL.md
---
name: history-search
description: Search chat history for past conversations
argument-hint: "<query> [--page N] [--date-from YYYY-MM-DD]"
disable-model-invocation: false
---

Search past chat sessions when user references earlier discussions.

**Usage from agent:**
```bash
xz history search "<query>" --limit 5
```

**When to use:**
- User says "like we discussed yesterday"
- Need context from earlier sessions
- Looking for specific decisions or code from past chats

**Handling pagination:**
- Default shows 10 results per page
- If user wants more, use `--page 2`, etc.
- To see full session: `xz history session <session-id> --limit 20`

// ~/.claude/skills/get-session/SKILL.md
---
name: get-session
description: Get full message history of a specific chat session
argument-hint: "<session-id> [--offset N]"
disable-model-invocation: true
---

Retrieve a complete session. Use when the user asks to see what was discussed.

**Usage:**
```bash
xz history session <session-id> --limit 20 --offset 0
```

**Pagination:**
- Use --offset to paginate through long sessions
- Increase offset by limit for next page
```

### Skill Implementation (Bash Tool)

```typescript
// Agent executes skills via bash tool
const bashTool: Tool = {
  name: 'bash',
  description: 'Execute bash commands including xz CLI for memory/history search',
  parameters: Type.Object({
    command: Type.String(),
    timeout: Type.Optional(Type.Number({ default: 60 }))
  })
};

// Example: Agent searching memory
// command: "xz memory search \"git preferences\" --limit 5"

// Example: Agent getting specific content
// command: "xz memory get memory/2026-03-03.md --start-line 15 --end-line 25"

// Example: Agent searching history
// command: "xz history search \"database schema\" --limit 5 --date-from 2026-02-01"
```

---

## Memory System Design

### 1. Three-Layer Architecture

| Layer | Type | Content | Access Pattern |
|-------|------|---------|----------------|
| **Identity** | Pre-loaded | `SOUL.md`, `USER.md` | Full injection into system prompt |
| **Knowledge** | Pre-loaded | `MEMORY.md`, recent daily logs | Full injection into system prompt |
| **Retrieval** | On-demand | All history & memory via `xz` CLI | Via skills that invoke `xz` |

### 2. Pre-loaded Content (System Prompt)

```typescript
interface SystemPromptBuilder {
  soul(): string;        // SOUL.md - who I am
  user(): string;        // USER.md - who the user is
  memory(): string;      // MEMORY.md - key facts
  recentDaily(days?: number): string; // Recent daily logs
}

// System prompt structure (~5-10K tokens typical)
const systemPrompt = `
${soul}           // ~1-2K tokens
${user}           // ~0.5-1K tokens  
${memory}         // ~2-4K tokens
${recentDaily}    // ~1-2K tokens

You have access to the xz CLI for retrieval:
- xz memory search <query> [--page N]
- xz memory get <file> [--start-line N] [--end-line N]
- xz history search <query> [--page N]
- xz history session <id> [--offset N]

Use these when you need information not in the pre-loaded context.
`;
```

### 3. SQLite Schema

```sql
-- Single database: data/agent.db

-- Knowledge index (for xz memory search)
CREATE TABLE knowledge_chunks (
  id TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  line_start INTEGER,
  line_end INTEGER,
  content TEXT NOT NULL,
  tags TEXT,  -- JSON array
  created_at INTEGER,
  updated_at INTEGER
);

CREATE VIRTUAL TABLE knowledge_fts USING fts5(content, content='knowledge_chunks');
CREATE VIRTUAL TABLE knowledge_vec USING vec0(id TEXT PRIMARY KEY, embedding FLOAT[1536]);

-- Chat history
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  created_at INTEGER,
  updated_at INTEGER,
  title TEXT,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  role TEXT,
  content TEXT,
  tool_calls TEXT,
  metadata TEXT,
  created_at INTEGER
);

CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages');

-- Scheduled tasks (TUI-embedded scheduler)
CREATE TABLE scheduled_tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,        -- What to do when triggered
  cron TEXT,                        -- Cron expression (optional)
  execute_at INTEGER,               -- Next execution timestamp (for one-time)
  interval_seconds INTEGER,         -- Recurring interval (optional)
  is_recurring BOOLEAN DEFAULT 0,
  is_enabled BOOLEAN DEFAULT 1,
  last_executed_at INTEGER,
  last_execution_status TEXT,       -- 'success' | 'failed' | null
  last_execution_output TEXT,       -- Output from last run
  created_at INTEGER,
  updated_at INTEGER
);

-- Task execution log
CREATE TABLE task_executions (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  status TEXT,                      -- 'success' | 'failed'
  output TEXT,                      -- Task output
  error TEXT,                       -- Error message if failed
  FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
);
```

---

## Scheduler Design (TUI-Embedded)

### Philosophy
- **No separate service**: TUI mode only, user must keep window open
- **Self-contained**: Scheduler runs inside TUI process
- **Transparent**: Task execution visible in chat flow
- **Context-aware**: Tasks execute with full conversation context

### Architecture

```
TUI Process
├── UI Thread (pi-tui)
│   ├── Render chat
│   ├── Handle input
│   └── Display messages
│
└── Scheduler Thread
    ├── Timer (every 2s)
    ├── Check SQLite (scheduled_tasks table)
    └── Trigger task → Insert "wakeup" message
```

### Wakeup Message Flow

```typescript
// 1. Scheduler detects due task
const dueTasks = await scheduler.getDueTasks();
for (const task of dueTasks) {
  // 2. Insert wakeup message into conversation
  const wakeupMessage: Message = {
    role: 'system',
    content: `[Scheduled Task: ${task.description}]`,
    metadata: { type: 'wakeup', taskId: task.id }
  };
  
  // 3. Add to context (like user message)
  await conversation.addMessage(wakeupMessage);
  
  // 4. Notify UI to render
  tui.addSystemMessage(`⏰ Task: ${task.description}`);
  
  // 5. Trigger agent response (same as user input)
  await agent.handleWakeup(task);
}
```

### TUI Display

```
┌──────────────────────────────────────────────────────────────┐
│ 🤖 xz    gpt-4o-mini    ⏰ Next: 09:00    📋 2 pending        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  🧑 You                                                      │
│  Check git status                                            │
│                                                              │
│  🤖 Assistant                                                │
│  On branch main, nothing to commit...                        │
│                                                              │
│  ⏰ System                                                   │
│  [Scheduled Task: Daily backup]                              │
│                                                              │
│  🤖 Assistant                                                │
│  Starting daily backup...                                    │
│  [bash: ./scripts/backup.sh]                                 │
│  Backup completed: backup-2026-03-03.tar.gz                  │
│                                                              │
│  🧑 You                                                      │
│  Thanks                                                      │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ > _                                                          │
└──────────────────────────────────────────────────────────────┘
```

### Scheduler API

```typescript
interface ScheduledTask {
  id: string;
  description: string;           // Natural language instruction
  cron?: string;                 // "0 9 * * *" for 9am daily
  executeAt?: number;            // Unix timestamp for one-time
  intervalSeconds?: number;      // 3600 for hourly
  isRecurring: boolean;
  isEnabled: boolean;
  lastExecutedAt?: number;
  lastExecutionStatus?: 'success' | 'failed';
}

class Scheduler {
  private timer: NodeJS.Timer;
  private checkIntervalMs = 2000;  // 2 seconds
  
  // Start checking (called when TUI starts)
  start(): void {
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
  }
  
  // Stop checking (called when TUI exits)
  stop(): void {
    clearInterval(this.timer);
  }
  
  // Check for due tasks
  private async tick(): Promise<void> {
    const now = Date.now();
    const dueTasks = await this.db.prepare(`
      SELECT * FROM scheduled_tasks
      WHERE is_enabled = 1
        AND (execute_at <= ? OR 
             (is_recurring = 1 AND 
              (last_executed_at IS NULL OR 
               last_executed_at + interval_seconds * 1000 <= ?)))
    `).all(now, now);
    
    for (const task of dueTasks) {
      await this.triggerTask(task);
    }
  }
  
  // Trigger task execution
  private async triggerTask(task: ScheduledTask): Promise<void> {
    // Update last_executed
    await this.db.prepare(
      'UPDATE scheduled_tasks SET last_executed_at = ? WHERE id = ?'
    ).run(Date.now(), task.id);
    
    // For one-time tasks, disable after execution
    if (!task.isRecurring) {
      await this.db.prepare(
        'UPDATE scheduled_tasks SET is_enabled = 0 WHERE id = ?'
      ).run(task.id);
    }
    
    // Notify agent via wakeup message
    this.onTaskDue?.(task);
  }
  
  // CRUD operations
  async addTask(task: Omit<ScheduledTask, 'id'>): Promise<string>;
  async removeTask(id: string): Promise<void>;
  async listTasks(): Promise<ScheduledTask[]>;
  async getNextTask(): Promise<ScheduledTask | null>;
  
  // Callback when task is due
  onTaskDue?: (task: ScheduledTask) => void;
}
```

### Tool: schedule_task

```typescript
const scheduleTaskTool: Tool = {
  name: 'schedule_task',
  description: 'Schedule a task for future execution. Tasks only run while TUI is open.',
  parameters: Type.Object({
    description: Type.String({ description: 'What to do when triggered' }),
    when: Type.String({ 
      description: 'When to execute. Supports: "HH:MM" (daily), "in X minutes/hours", ISO timestamp'
    }),
    recurring: Type.Optional(Type.String({ 
      enum: ['daily', 'hourly', 'none'],
      default: 'none'
    }))
  })
};

// Examples:
// schedule_task("Check emails", "09:00", "daily")
// schedule_task("Remind about meeting", "in 30 minutes", "none")
// schedule_task("Backup database", "2026-03-04T02:00:00+08:00", "none")
```

### Important Notes

**Limitations (by design):**
- Tasks only execute while TUI is running
- If computer sleeps, tasks may be delayed
- No persistent background service

**Best practices:**
- Use for "while I'm working" reminders
- Use for periodic maintenance during active sessions
- For critical timed tasks, use system cron + `xz once <task>` pattern

---

## Project Structure

```
xz/
├── package.json
├── tsconfig.json
├── bin/
│   └── xz.js                   # CLI entry point
│
├── src/
│   ├── cli/
│   │   ├── index.ts            # CLI parser & commands
│   │   ├── memory.ts           # xz memory commands
│   │   ├── history.ts          # xz history commands
│   │   ├── skill.ts            # xz skill commands
│   │   └── schedule.ts         # xz schedule commands
│   │
│   ├── tui/
│   │   ├── index.ts            # Interactive TUI mode
│   │   ├── app.ts
│   │   ├── chat.ts
│   │   └── input.ts
│   │
│   ├── core/
│   │   ├── agent.ts            # Main agent orchestration
│   │   ├── llm.ts
│   │   ├── heartbeat.ts
│   │   └── scheduler.ts
│   │
│   ├── config/                 # Configuration management
│   │   ├── index.ts            # Config load/save + isFirstRun()
│   │   ├── types.ts            # XZConfig interface
│   │   ├── wizard.ts           # First-run setup wizard
│   │   ├── kimi.ts             # Kimi OAuth integration
│   │   └── validators.ts       # Config validation
│   │
│   ├── identity/
│   │   ├── index.ts
│   │   ├── loader.ts           # Load SOUL.md, USER.md
│   │   └── builder.ts          # Build system prompt
│   │
│   ├── knowledge/
│   │   ├── index.ts
│   │   ├── loader.ts           # Load MEMORY.md, daily logs
│   │   ├── chunker.ts          # 400-token chunks
│   │   ├── search.ts           # Hybrid search
│   │   └── manager.ts          # Read/append operations
│   │
│   ├── history/
│   │   ├── index.ts
│   │   ├── database.ts         # SQLite connection
│   │   ├── session.ts          # Session CRUD
│   │   ├── messages.ts         # Message storage
│   │   ├── search.ts           # History search (BM25 + vector)
│   │   └── compaction.ts       # Session compaction
│   │
│   ├── scheduler/              # TUI-embedded scheduler (2s tick)
│   │   ├── index.ts
│   │   ├── database.ts         # Schedule schema in agent.db
│   │   ├── manager.ts          # Task CRUD
│   │   ├── runner.ts           # Execute due tasks
│   │   └── ticker.ts           # 2s interval checker
│   │
│   ├── skills/
│   │   ├── index.ts
│   │   ├── loader.ts           # Load skills from .agents/skills/
│   │   ├── manager.ts          # Hot reload
│   │   ├── registry.ts         # Skill registry
│   │   └── builtin/            # Built-in skills (xz memory, xz history)
│   │       ├── memory-search/
│   │       │   └── SKILL.md
│   │       ├── history-search/
│   │       │   └── SKILL.md
│   │       └── get-session/
│   │           └── SKILL.md
│   │
│   └── tools/
│       ├── index.ts
│       ├── bash.ts             # Includes xz CLI invocation
│       ├── memory.ts           # memory_append
│       └── skill.ts            # Skill invocation
│
├── .agents/                    # User's agent files
│   ├── SOUL.md
│   ├── USER.md
│   ├── MEMORY.md
│   ├── memory/
│   │   └── 2026-03-03.md
│   └── skills/                 # User's custom skills
│
├── .claude/                    # Compatibility skills
│   └── skills/
│       └── git-helpers/
│           └── SKILL.md
│
└── data/
    └── agent.db                # SQLite: knowledge + history + schedule
```

---

## Usage Examples

### CLI Mode

```bash
# Search memory
$ xz memory search "git workflow" --limit 5
File                    Lines   Score   Snippet
memory/2026-03-03.md    15-22   0.92    User prefers short git log format...
memory/2026-03-02.md    8-15    0.85    Discussed git rebase vs merge...

Page 1/3 (12 total)
Use --page 2 for next

# Get specific content
$ xz memory get memory/2026-03-03.md --start-line 15 --end-line 22
## 09:15:00 - [preference] Git log format
User prefers `git log --oneline` for brevity.

# Search history
$ xz history search "database schema" --date-from 2026-02-01
Session                 Date                Role      Preview
2026-03-01-abc123       2026-03-01 14:23    user      Let's design the database...
2026-03-01-abc123       2026-03-01 14:24    assistant I suggest SQLite with...

# View session
$ xz history session 2026-03-01-abc123 --limit 20
[Session: Database Design Discussion]
14:23 user: Let's design the database schema...
14:24 assistant: I suggest SQLite with FTS5...
...
--offset 20 for more

# List sessions
$ xz history list --page 1
ID                      Title                   Messages  Date
2026-03-03-xyz789       Memory System Design    45        2026-03-03
2026-03-02-def456       Git Helpers Skill       23        2026-03-02
```

### TUI Mode (Default)

```bash
# Start interactive session
$ xz

# In TUI:
> What are my git preferences?
🤖 Based on your pre-loaded MEMORY.md, you prefer short git logs.

> /memory-search "docker setup"
🤖 [bash: xz memory search "docker setup" --limit 5]
   Found: memory/2026-02-28.md mentions Docker setup...

> Show me what we discussed yesterday
🤖 [bash: xz history search "discussion" --date-from 2026-03-02 --limit 5]
   Found session 2026-03-02-def456: "Git Helpers Skill"
   
> /get-session 2026-03-02-def456
🤖 [bash: xz history session 2026-03-02-def456 --limit 20]
   [Shows full session content]
```

### Scheduled Tasks (TUI Mode)

```bash
# List scheduled tasks
$ xz schedule list
ID          Description         Next Run        Recurring
backup      Daily backup        2026-03-04 02:00  daily
email-check Check emails        2026-03-03 09:00  daily

# Add task
$ xz schedule add "Daily backup" "02:00" --recurring daily
✅ Task scheduled: backup

# Remove task
$ xz schedule remove backup
✅ Task removed
```

**In TUI - Task Execution:**
```
# User has TUI open, working...
> Working on feature X...

⏰ System
[Scheduled Task: Check emails]

🤖 Assistant
Checking emails...
[bash: check-email.sh]
3 new emails. 1 requires attention: "Review requested for PR #42"

> Thanks, I'll review it later.
```

**Important**: Tasks only execute while TUI is running. If you close the window, tasks are delayed until next time you open xz.

---

## Implementation Phases

### Phase 1: Core + CLI Foundation
- CLI framework (commander.js)
- `xz` binary entry point
- Config system (`~/.xz/config.toml`)
- **First-run setup wizard** (model selection)
- TUI with pi-tui (default mode)
- Kimi Code OAuth 集成（读取 `~/.kimi/credentials`）

### Phase 2: Identity & Pre-loading
- SOUL.md, USER.md loading
- System prompt builder
- Pre-load into context

### Phase 3: Knowledge Storage & CLI
- Markdown memory files
- Chunking & indexing
- `xz memory search` command
- `xz memory get` command

### Phase 4: History Storage & CLI
- SQLite schema
- Session/message storage
- `xz history search` command
- `xz history session/list` commands

### Phase 5: Search Skills
- Built-in skills that wrap xz CLI
- Skill: `memory-search`
- Skill: `history-search`
- Skill: `get-session`

### Phase 6: Context Management
- Compaction at 150K threshold
- Optional pre-flush

### Phase 7: TUI-Embedded Scheduler
- SQLite schema for scheduled_tasks
- 2s interval ticker in TUI
- Wakeup message flow
- `schedule_task` tool

### Phase 8: Polish
- Hot reload for skills
- Pagination UX
- Task execution logging

---

## Kimi Code 订阅用户配置

如果你已经订阅了 Kimi Code，本地已有 `kimi` CLI 配置，可以直接复用认证信息。

### 配置方式

#### 方式 1: 使用 Kimi CLI 的 OAuth 凭证（推荐）

Kimi CLI 已存储 OAuth token 在 `~/.kimi/credentials/`。

```typescript
// src/config/kimi.ts
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export function getKimiCredentials() {
  const credPath = join(homedir(), '.kimi', 'credentials', 'kimi-code.json');
  const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
  
  // 检查 token 是否过期
  if (cred.expires_at * 1000 < Date.now()) {
    // 需要使用 refresh_token 刷新，或提示用户运行 `kimi /login`
    throw new Error('Token expired. Run: kimi /login');
  }
  
  return {
    baseUrl: 'https://api.kimi.com/coding/v1',
    accessToken: cred.access_token,
    refreshToken: cred.refresh_token,
    expiresAt: cred.expires_at
  };
}

// 获取 access token 用于 API 调用
export async function getKimiAccessToken(): Promise<string> {
  const cred = getKimiCredentials();
  return cred.accessToken;
}
```

#### 方式 2: 环境变量配置（Claude Code 兼容）

从 Kimi Code 控制台获取 API Key，然后配置环境变量：

```bash
# ~/.zshrc 或 ~/.bashrc
export ANTHROPIC_BASE_URL=https://api.kimi.com/coding/
export ANTHROPIC_AUTH_TOKEN=<你的 Kimi Code API Key>
export ANTHROPIC_MODEL=kimi-for-coding
export ANTHROPIC_SMALL_FAST_MODEL=kimi-for-coding
```

或使用 `kimi-for-coding` 模型：

```bash
# xz 启动时加载
export XZ_PROVIDER=kimi
export XZ_MODEL=kimi-for-coding
export XZ_BASE_URL=https://api.kimi.com/coding/v1
export XZ_API_KEY=$(cat ~/.kimi/credentials/kimi-code.json | jq -r .access_token)
```

### 在 Plan 中使用

```typescript
// src/llm.ts - 配置 pi-ai 使用 Kimi
import { getModel } from '@mariozechner/pi-ai';
import { getKimiAccessToken } from './config/kimi';

export async function createKimiModel() {
  const accessToken = await getKimiAccessToken();
  
  // Kimi 使用 OpenAI-compatible API
  const model = {
    id: 'kimi-for-coding',
    name: 'Kimi For Coding',
    api: 'openai-completions',
    provider: 'kimi',
    baseUrl: 'https://api.kimi.com/coding/v1',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, // 包含在订阅中
    contextWindow: 262144,  // 256K context
    maxTokens: 65536,
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  };
  
  return model;
}
```

### Token 刷新

OAuth token 会过期，需要自动刷新：

```typescript
// src/config/kimi.ts
export async function refreshKimiToken(refreshToken: string): Promise<Credentials> {
  const response = await fetch('https://api.kimi.com/auth/token/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  
  const newCred = await response.json();
  
  // 保存新凭证
  saveCredentials(newCred);
  
  return newCred;
}
```

### 检查本地认证状态

```bash
# 检查 Kimi CLI 是否已登录
$ xz auth check
✅ Kimi Code OAuth found (~/.kimi/credentials/kimi-code.json)
   Expires: 2025-03-04 12:00:00 (23 hours remaining)
   
# 或手动检查
$ ls ~/.kimi/credentials/kimi-code.json
$ cat ~/.kimi/credentials/kimi-code.json | jq '.expires_at'
```

### 测试配置

```bash
# 方式 1: 使用本地 OAuth
xz --provider kimi --use-oauth

# 方式 2: 使用环境变量
export XZ_PROVIDER=kimi
export XZ_MODEL=kimi-for-coding
xz

# 方式 3: 显式 API Key
xz --provider kimi --api-key <your-key>
```

### 订阅权益说明

- **模型**: `kimi-for-coding` (K2.5)
- **上下文**: 256K tokens
- **额度**: 周期性刷新，与 Kimi Code 订阅套餐相关
- **并发**: 最高 30 并发
- **速度**: 最高 100 tokens/s

---

## Dependencies

```json
{
  "name": "xz",
  "bin": {
    "xz": "./bin/xz.js"
  },
  "dependencies": {
    "@mariozechner/pi-ai": "^0.55.0",
    "@mariozechner/pi-tui": "^0.55.0",
    "@sinclair/typebox": "^0.34.0",
    "commander": "^12.0.0",
    "yaml": "^2.4.0",
    "better-sqlite3": "^9.0.0"
  },
  "optionalDependencies": {
    "sqlite-vec": "^0.1.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```
