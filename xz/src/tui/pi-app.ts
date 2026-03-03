/**
 * TUI Application using Ink
 */

import React, { createElement as h, useEffect, useState } from 'react';
import { Box, Text, render, useApp, useInput, type Key } from 'ink';
import { Agent, createAgent } from '../core/agent.js';
import { InitAgent, createInitAgent } from '../core/init-agent.js';
import { getSchedulerTicker, stopSchedulerTicker } from '../scheduler/index.js';
import { loadConfig, startConfigHotReload, stopConfigReloader } from '../config/index.js';
import { getRecentSession, getRecentMessages } from '../history/index.js';
import { getHeartbeatManager, startAutonomousHeartbeat, stopHeartbeat } from '../core/heartbeat.js';
import { hasIdentityDocs } from '../identity/loader.js';

export interface PiTUIAppOptions {
  theme?: 'dark' | 'light';
  mode?: 'normal' | 'init';
}

interface ChatMessage {
  role: string;
  content: string;
  timestamp: number;
}

interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  leftPercent: number;
}

interface HeartbeatView {
  text: string;
  color?: string;
  dim?: boolean;
}

interface AppSnapshot {
  config: ReturnType<typeof loadConfig>;
  sessionId: string;
  messages: ChatMessage[];
  inputValue: string;
  isProcessing: boolean;
}

interface CommandOption {
  name: string;
  usage: string;
  description: string;
}

const COMMAND_OPTIONS: CommandOption[] = [
  { name: 'help', usage: '/help', description: 'Show available commands' },
  { name: 'new', usage: '/new', description: 'Start a new session' },
  { name: 'memory', usage: '/memory <query>', description: 'Search knowledge memory' },
  { name: 'history', usage: '/history <query>', description: 'Search chat history' },
  { name: 'tasks', usage: '/tasks', description: 'Show scheduled tasks' },
  { name: 'heartbeat', usage: '/heartbeat [start|stop|status]', description: 'Control autonomous mode' },
  { name: 'config', usage: '/config', description: 'Show current configuration' },
];

interface CommandCompletionState {
  isCommandMode: boolean;
  query: string;
  suggestions: CommandOption[];
}

function getCommandCompletionState(inputValue: string): CommandCompletionState {
  if (!inputValue.startsWith('/')) {
    return {
      isCommandMode: false,
      query: '',
      suggestions: [],
    };
  }

  const body = inputValue.slice(1);
  const commandPart = body.split(/\s+/, 1)[0] ?? '';
  const query = commandPart.toLowerCase();
  const suggestions = COMMAND_OPTIONS.filter((option) => option.name.startsWith(query));

  return {
    isCommandMode: true,
    query,
    suggestions,
  };
}

function applyCommandCompletion(inputValue: string, commandName: string): string {
  const body = inputValue.slice(1);
  const firstSpaceIndex = body.indexOf(' ');
  const suffix = firstSpaceIndex >= 0 ? body.slice(firstSpaceIndex) : '';

  if (suffix) {
    return `/${commandName}${suffix}`;
  }

  return `/${commandName} `;
}

export class PiTUIApp {
  static readonly HISTORY_LIMIT = 120;
  private static readonly CONTEXT_WINDOW_MESSAGES = 50;

  private agent: Agent | null = null;
  private initAgent: InitAgent | null = null;
  private mode: 'normal' | 'init';
  private config: ReturnType<typeof loadConfig>;
  private heartbeatStarted = false;
  private messages: ChatMessage[] = [];
  private inputValue = '';
  private isProcessing = false;
  private stopped = false;

  private exitHandler: (() => void) | null = null;
  private listeners = new Set<() => void>();

  constructor(options: PiTUIAppOptions = {}) {
    this.config = loadConfig();
    this.mode = options.mode || (hasIdentityDocs() ? 'normal' : 'init');

    if (this.mode === 'init') {
      // Initialization mode - use InitAgent
      this.initAgent = createInitAgent({
        onMessage: (msg) => this.handleAgentMessage(msg),
        onComplete: () => this.handleInitComplete(),
      });
    } else {
      // Normal mode - use regular Agent
      const recentSession = getRecentSession();
      this.agent = createAgent({
        sessionId: recentSession?.id,
        onMessage: (msg) => this.handleAgentMessage(msg),
        onToolCall: (name, args) => this.handleToolCall(name, args),
      });

      this.setupScheduler();
      this.setupConfigHotReload();

      if (this.config.heartbeat.enabled) {
        this.startHeartbeat();
      }
    }
  }

  initialize(): void {
    if (this.mode === 'init' && this.initAgent) {
      // Start initialization conversation
      void this.initAgent.start();
      this.addMessage('system', '🌟 Welcome! Let\'s get to know each other.');
    } else {
      this.loadRecentHistory();
    }
    this.emit();
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    stopSchedulerTicker();
    stopHeartbeat();
    stopConfigReloader();

    this.emit();

    if (this.exitHandler) {
      this.exitHandler();
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setExitHandler(handler: (() => void) | null): () => void {
    this.exitHandler = handler;
    return () => {
      if (this.exitHandler === handler) {
        this.exitHandler = null;
      }
    };
  }

  getSnapshot(): AppSnapshot {
    return {
      config: this.config,
      sessionId: this.agent?.getSessionId() || 'init-session',
      messages: this.messages,
      inputValue: this.inputValue,
      isProcessing: this.isProcessing,
    };
  }

  getContextUsage(): ContextUsage {
    const maxTokens = Math.max(this.config.context.maxTokens, 1);
    const windowMessages = this.messages.slice(-PiTUIApp.CONTEXT_WINDOW_MESSAGES);
    const usedTokens = windowMessages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    const leftPercent = Math.max(0, Math.min(100, Math.round((1 - usedTokens / maxTokens) * 100)));

    return { usedTokens, maxTokens, leftPercent };
  }

  getHeartbeatView(): HeartbeatView {
    const hb = getHeartbeatManager();
    if (!hb.isRunning()) {
      return { text: 'off', dim: true };
    }

    const status = hb.getStatus();
    if (status.state === 'executing') {
      return { text: 'running', color: 'yellow' };
    }

    const mins = Math.floor(status.nextRunInMs / 60000);
    if (mins < 1) {
      return { text: 'in <1m', dim: true };
    }

    return { text: `in ${mins}m`, dim: true };
  }

  clearInput(): void {
    this.inputValue = '';
    this.emit();
  }

  setInputValue(raw: string): void {
    this.inputValue = this.normalizeInput(raw);
    this.emit();
  }

  backspaceInput(): void {
    if (!this.inputValue) {
      return;
    }

    this.inputValue = this.inputValue.slice(0, -1);
    this.emit();
  }

  appendInput(raw: string): void {
    if (!raw || this.stopped) {
      return;
    }

    const normalized = this.normalizeInput(raw);

    if (!normalized) {
      return;
    }

    this.inputValue += normalized;
    this.emit();
  }

  async submitInput(): Promise<void> {
    if (this.stopped || this.isProcessing) {
      return;
    }

    const submitted = this.inputValue;
    this.inputValue = '';
    this.emit();

    await this.handleSubmit(submitted);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private normalizeInput(raw: string): string {
    return raw
      .replace(/[\r\n]+/g, ' ')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  }

  private estimateTokens(content: string): number {
    const text = content.trim();
    if (!text) {
      return 0;
    }

    return Math.ceil(text.length / 4) + 4;
  }

  private loadRecentHistory(): void {
    if (!this.agent) return;
    const recent = getRecentMessages(this.agent.getSessionId(), PiTUIApp.HISTORY_LIMIT);
    this.messages = recent.map((msg) => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.createdAt,
    }));
  }

  private async handleSubmit(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    // In init mode, handle exit specially
    if (this.mode === 'init') {
      if (trimmed === 'exit' || trimmed === 'quit') {
        this.stop();
        return;
      }

      this.addMessage('user', trimmed);
      this.isProcessing = true;
      this.emit();

      try {
        await this.initAgent?.sendMessage(trimmed);
      } catch (error) {
        this.addMessage('system', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      this.isProcessing = false;
      this.emit();
      return;
    }

    // Normal mode
    this.recordUserActivity();

    if (trimmed === 'exit' || trimmed === 'quit') {
      this.stop();
      return;
    }

    if (trimmed === 'help' || trimmed === '/help') {
      this.showHelp();
      return;
    }

    if (trimmed.startsWith('/')) {
      await this.handleCommand(trimmed);
      return;
    }

    this.addMessage('user', trimmed);

    this.isProcessing = true;
    this.setBusy(true);
    this.emit();

    try {
      await this.agent?.sendMessage(trimmed);
    } catch (error) {
      this.addMessage('system', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    this.isProcessing = false;
    this.setBusy(false);
    this.emit();
  }

  private handleAgentMessage(msg: { role: string; content: string }): void {
    this.addMessage(msg.role, msg.content);
  }

  private handleToolCall(name: string, args: unknown): void {
    this.addMessage('tool', `${name}: ${JSON.stringify(args)}`);
  }

  private addMessage(role: string, content: string): void {
    this.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });

    if (this.messages.length > 400) {
      this.messages = this.messages.slice(-400);
    }

    this.emit();
  }

  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case 'new':
        this.agent = createAgent({
          onMessage: (msg) => this.handleAgentMessage(msg),
          onToolCall: (name, toolArgs) => this.handleToolCall(name, toolArgs),
        });
        this.messages = [];
        this.addMessage('system', `New session: ${this.agent.getSessionId().slice(0, 16)}...`);
        break;

      case 'memory': {
        const query = args.join(' ');
        if (!query) {
          this.addMessage('system', 'Usage: /memory <query>');
          break;
        }

        const { searchKnowledge } = await import('../knowledge/index.js');
        const results = searchKnowledge(query, { limit: 5 });

        this.addMessage('system', `Memory search: "${query}" (${results.total} results)`);
        results.items.forEach((r, i) => {
          this.addMessage('system', `${i + 1}. ${r.chunk.file}:${r.chunk.lineStart} - ${r.chunk.content.slice(0, 100)}...`);
        });
        break;
      }

      case 'history': {
        const hQuery = args.join(' ');
        if (!hQuery) {
          this.addMessage('system', 'Usage: /history <query>');
          break;
        }

        const { searchHistory } = await import('../history/index.js');
        const hResults = searchHistory(hQuery, { limit: 5 });

        this.addMessage('system', `History search: "${hQuery}" (${hResults.total} results)`);
        hResults.results.forEach((r, i) => {
          const date = new Date(r.timestamp).toLocaleDateString();
          this.addMessage('system', `${i + 1}. [${r.role}] ${date}: ${r.content.slice(0, 100)}...`);
        });
        break;
      }

      case 'tasks': {
        const { listTasks, getNextTask } = await import('../scheduler/index.js');
        const tasks = listTasks();

        this.addMessage('system', `Scheduled tasks (${tasks.length}):`);
        tasks.slice(0, 10).forEach((t) => {
          const status = t.isEnabled ? 'on' : 'off';
          const when = t.executeAt ? new Date(t.executeAt).toLocaleTimeString() : 'recurring';
          this.addMessage('system', `  ${status} ${t.description} (${when})`);
        });

        const next = getNextTask();
        if (next?.executeAt) {
          this.addMessage('system', `Next: "${next.description}" at ${new Date(next.executeAt).toLocaleTimeString()}`);
        }
        break;
      }

      case 'heartbeat': {
        const subCmd = args[0] || 'status';

        if (subCmd === 'start') {
          this.startHeartbeat();
          this.addMessage('system', 'Autonomous heartbeat started');
        } else if (subCmd === 'stop') {
          this.stopHeartbeat();
          this.addMessage('system', 'Autonomous heartbeat stopped');
        } else {
          const hb = getHeartbeatManager();
          const status = hb.getStatus();
          this.addMessage(
            'system',
            `Heartbeat: ${status.context.isRunning ? 'running' : 'stopped'}, runs: ${status.context.runCount}, next: ${Math.floor(status.nextRunInMs / 60000)}m`,
          );
        }
        break;
      }

      case 'config':
        this.addMessage(
          'system',
          `Model: ${this.config.model.provider}/${this.config.model.model}, Heartbeat: ${this.config.heartbeat.enabled ? 'enabled' : 'disabled'}`,
        );
        break;

      default:
        this.addMessage('system', `Unknown command: /${cmd}. Type /help for available commands.`);
    }
  }

  private showHelp(): void {
    const helpText = [
      'Commands:',
      '  /new           Start a new session',
      '  /memory        Search knowledge memory',
      '  /history       Search chat history',
      '  /tasks         List scheduled tasks',
      '  /heartbeat     Show/control autonomous mode',
      '  /config        Show configuration',
      '  /help          Show this help',
      '  exit           Quit xz',
      '',
      'Shortcuts:',
      '  Enter          Submit input',
      '  Esc            Clear input',
      '  Ctrl+C         Quit',
    ].join('\n');

    this.addMessage('system', helpText);
  }

  private setupScheduler(): void {
    if (!this.config.scheduler.enabled) {
      return;
    }

    const ticker = getSchedulerTicker({
      onTaskDue: (task) => {
        this.addMessage('system', `Task: ${task.description}`);
        void this.agent?.handleWakeup(task.description);
      },
    });

    ticker.start();
  }

  private setupConfigHotReload(): void {
    startConfigHotReload((newConfig, _oldConfig, changes) => {
      this.config = newConfig;
      this.addMessage('system', `Config reloaded: ${changes.join(', ')}`);

      if (changes.some((c) => c.includes('heartbeat'))) {
        if (newConfig.heartbeat.enabled && !this.heartbeatStarted) {
          this.startHeartbeat();
        } else if (!newConfig.heartbeat.enabled && this.heartbeatStarted) {
          this.stopHeartbeat();
        }
      }
    });
  }

  startHeartbeat(): void {
    if (this.heartbeatStarted) {
      return;
    }

    startAutonomousHeartbeat({
      onActivity: (msg) => this.addMessage('system', msg),
    });

    this.heartbeatStarted = true;
    this.emit();
  }

  stopHeartbeat(): void {
    stopHeartbeat();
    this.heartbeatStarted = false;
    this.emit();
  }

  private recordUserActivity(): void {
    getHeartbeatManager().recordUserActivity();
  }

  private setBusy(busy: boolean): void {
    getHeartbeatManager().setBusy(busy);
  }

  /**
   * Handle initialization completion
   */
  private handleInitComplete(): void {
    // Switch to normal mode after a short delay
    setTimeout(() => {
      this.mode = 'normal';
      this.initAgent = null;

      // Create normal agent
      this.agent = createAgent({
        onMessage: (msg) => this.handleAgentMessage(msg),
        onToolCall: (name, args) => this.handleToolCall(name, args),
      });

      this.setupScheduler();
      this.setupConfigHotReload();

      if (this.config.heartbeat.enabled) {
        this.startHeartbeat();
      }

      this.addMessage('system', 'Initialization complete! Starting normal mode...');
      this.emit();
    }, 2000);
  }
}

interface InkTUIRootProps {
  app: PiTUIApp;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderMessage(message: ChatMessage, index: number): React.ReactElement {
  const key = `msg-${message.timestamp}-${index}`;
  const time = formatTime(message.timestamp);

  if (message.role === 'assistant') {
    return h(
      Box,
      { key, flexDirection: 'column' },
      h(
        Text,
        null,
        h(Text, { dimColor: true }, `${time} `),
        h(Text, { color: 'green', bold: true }, 'xz'),
      ),
      h(Text, null, message.content),
    );
  }

  if (message.role === 'user') {
    return h(
      Text,
      { key },
      h(Text, { dimColor: true }, `${time} `),
      h(Text, { color: 'cyan', bold: true }, 'you'),
      `  ${message.content}`,
    );
  }

  if (message.role === 'tool') {
    return h(
      Text,
      { key },
      h(Text, { dimColor: true }, `${time} `),
      h(Text, { color: 'magenta', bold: true }, 'tool'),
      ` ${message.content}`,
    );
  }

  return h(
    Text,
    { key },
    h(Text, { dimColor: true }, `${time} `),
    h(Text, { color: 'yellow', bold: true }, 'sys'),
    ` ${message.content}`,
  );
}

function InkTUIRoot({ app }: InkTUIRootProps): React.ReactElement {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<AppSnapshot>(() => app.getSnapshot());
  const [, setTicker] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const completionState = getCommandCompletionState(snapshot.inputValue);
  const commandSuggestions = completionState.suggestions;
  const safeSelectedCommandIndex =
    commandSuggestions.length > 0 ? Math.min(selectedCommandIndex, commandSuggestions.length - 1) : 0;
  const selectedCommand = commandSuggestions[safeSelectedCommandIndex];

  useEffect(() => {
    const unsubscribe = app.subscribe(() => {
      setSnapshot(app.getSnapshot());
    });

    return unsubscribe;
  }, [app]);

  useEffect(() => {
    const release = app.setExitHandler(() => {
      exit();
    });

    return release;
  }, [app, exit]);

  useEffect(() => {
    app.initialize();

    const timer = setInterval(() => {
      setTicker((value) => value + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [app]);

  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [completionState.isCommandMode, completionState.query]);

  useEffect(() => {
    if (selectedCommandIndex >= commandSuggestions.length && commandSuggestions.length > 0) {
      setSelectedCommandIndex(0);
    }
  }, [commandSuggestions.length, selectedCommandIndex]);

  useInput((input: string, key: Key) => {
    if (key.ctrl && input === 'c') {
      app.stop();
      return;
    }

    if (key.return) {
      void app.submitInput();
      return;
    }

    if (key.escape) {
      app.clearInput();
      return;
    }

    if (key.backspace || key.delete) {
      app.backspaceInput();
      return;
    }

    if (completionState.isCommandMode && commandSuggestions.length > 0 && key.upArrow) {
      setSelectedCommandIndex((value) => (value <= 0 ? commandSuggestions.length - 1 : value - 1));
      return;
    }

    if (completionState.isCommandMode && commandSuggestions.length > 0 && key.downArrow) {
      setSelectedCommandIndex((value) => (value + 1) % commandSuggestions.length);
      return;
    }

    if (completionState.isCommandMode && commandSuggestions.length > 0 && key.tab) {
      const target = commandSuggestions[safeSelectedCommandIndex];
      app.setInputValue(applyCommandCompletion(snapshot.inputValue, target.name));
      return;
    }

    if (key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
      return;
    }

    app.appendInput(input);
  });

  const visibleMessages = snapshot.messages.slice(-80);
  const contextUsage = app.getContextUsage();
  const heartbeat = app.getHeartbeatView();

  const contextProps: {
    color?: string;
    dimColor?: boolean;
    bold?: boolean;
  } = { dimColor: true };

  if (contextUsage.leftPercent <= 10) {
    contextProps.color = 'red';
    contextProps.dimColor = false;
    contextProps.bold = true;
  } else if (contextUsage.leftPercent <= 30) {
    contextProps.color = 'yellow';
    contextProps.dimColor = false;
  }

  const heartbeatProps: {
    color?: string;
    dimColor?: boolean;
  } = {
    dimColor: heartbeat.dim ?? false,
  };

  if (heartbeat.color) {
    heartbeatProps.color = heartbeat.color;
    heartbeatProps.dimColor = false;
  }

  const inputHint = completionState.isCommandMode ? 'Tab 补全 · ↑↓ 选择 · Enter 执行' : '/ 可以用命令';

  return h(
    Box,
    {
      flexDirection: 'column',
      height: '100%',
      paddingX: 1,
      paddingY: 0,
    },
    h(
      Box,
      {
        borderStyle: 'round',
        borderColor: 'cyan',
        paddingX: 1,
        flexDirection: 'column',
      },
      h(
        Text,
        null,
        h(Text, { color: 'cyan', bold: true }, 'xz'),
        h(Text, { dimColor: true }, ' AI Agent'),
      ),
      h(
        Text,
        null,
        h(Text, { dimColor: true }, `${snapshot.config.model.provider}/${snapshot.config.model.model}  session ${snapshot.sessionId.slice(0, 12)}  hb `),
        h(Text, heartbeatProps, heartbeat.text),
        h(Text, { dimColor: true }, '  state '),
        h(Text, { color: snapshot.isProcessing ? 'yellow' : 'green' }, snapshot.isProcessing ? 'busy' : 'ready'),
      ),
    ),
    h(
      Box,
      {
        marginTop: 1,
        flexGrow: 1,
        minHeight: 8,
        borderStyle: 'round',
        borderColor: 'blue',
        paddingX: 1,
        paddingY: 0,
        flexDirection: 'column',
        overflow: 'hidden',
      },
      h(Text, { dimColor: true }, 'Conversation'),
      h(
        Box,
        {
          flexGrow: 1,
          flexDirection: 'column',
          overflow: 'hidden',
          marginTop: 1,
        },
        ...(visibleMessages.length === 0
          ? [
              h(Text, { key: 'welcome-title', color: 'cyan', bold: true }, 'Welcome to xz'),
              h(Text, { key: 'welcome-sub', dimColor: true }, 'Type your message and press Enter'),
              h(Text, { key: 'welcome-help', dimColor: true }, 'Try /help for commands'),
            ]
          : visibleMessages.map((message, index) => renderMessage(message, index))),
      ),
      h(
        Box,
        {
          justifyContent: 'flex-end',
        },
        h(Text, contextProps, `${contextUsage.leftPercent}% left`),
      ),
    ),
    h(
      Box,
      {
        marginTop: 1,
        borderStyle: 'round',
        borderColor: snapshot.isProcessing ? 'yellow' : 'cyan',
        paddingX: 1,
        flexDirection: 'column',
      },
      h(
        Text,
        null,
        h(Text, { color: snapshot.isProcessing ? 'yellow' : 'cyan', bold: true }, '>'),
        ` ${snapshot.inputValue}`,
        !snapshot.isProcessing && h(Text, { dimColor: true }, '|'),
      ),
      h(Text, { dimColor: true }, inputHint),
      completionState.isCommandMode &&
        (commandSuggestions.length === 0
          ? h(Text, { color: 'yellow' }, `没有匹配命令: /${completionState.query}`)
          : h(
              Box,
              {
                flexDirection: 'row',
                flexWrap: 'wrap',
              },
              ...commandSuggestions.map((option, index) =>
                h(
                  Text,
                  {
                    key: `suggestion-${option.name}`,
                    color: index === safeSelectedCommandIndex ? 'cyan' : undefined,
                    dimColor: index !== safeSelectedCommandIndex,
                    bold: index === safeSelectedCommandIndex,
                  },
                  `${index === safeSelectedCommandIndex ? '› ' : ''}${option.usage}  `,
                ),
              ),
            )),
      completionState.isCommandMode &&
        commandSuggestions.length > 0 &&
        selectedCommand &&
        h(Text, { dimColor: true }, `${selectedCommand.usage} - ${selectedCommand.description}`),
    ),
  );
}

export async function runTUI(options?: PiTUIAppOptions): Promise<void> {
  const app = new PiTUIApp(options);
  const instance = render(h(InkTUIRoot, { app }), { exitOnCtrlC: false });

  const onSignal = (): void => {
    app.stop();
    instance.unmount();
  };

  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    await instance.waitUntilExit();
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    app.stop();
    instance.unmount();
  }
}
