/**
 * TUI Application using OpenTUI core
 */

import color from 'picocolors';
import { Agent, createAgent } from '../core/agent.js';
import { getSchedulerTicker, stopSchedulerTicker } from '../scheduler/index.js';
import { loadConfig, startConfigHotReload, stopConfigReloader } from '../config/index.js';
import { getRecentSession, getRecentMessages } from '../history/index.js';
import { getHeartbeatManager, startAutonomousHeartbeat, stopHeartbeat } from '../core/heartbeat.js';

type OTUICoreCompat = {
  createCliRenderer: (config?: Record<string, unknown>) => Promise<any>;
  BoxRenderable: new (ctx: unknown, options?: Record<string, unknown>) => any;
  TextRenderable: new (ctx: unknown, options?: Record<string, unknown>) => any;
};

async function loadOpenTUICore(): Promise<OTUICoreCompat> {
  const mod = (await import('@opentui/core')) as any;
  if (!mod.createCliRenderer || !mod.BoxRenderable || !mod.TextRenderable) {
    throw new Error('OpenTUI core API is not available in this runtime');
  }
  return {
    createCliRenderer: mod.createCliRenderer,
    BoxRenderable: mod.BoxRenderable,
    TextRenderable: mod.TextRenderable,
  };
}

interface KeyEvent {
  name: string;
  sequence: string;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  option: boolean;
}

export interface PiTUIAppOptions {
  theme?: 'dark' | 'light';
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

export class PiTUIApp {
  private static readonly HISTORY_LIMIT = 120;
  private static readonly CONTEXT_WINDOW_MESSAGES = 50;

  private opentui: OTUICoreCompat;
  private renderer!: any;
  private rootView: any = null;
  private agent: Agent;
  private config: ReturnType<typeof loadConfig>;
  private heartbeatStarted = false;
  private messages: ChatMessage[] = [];
  private inputValue = '';
  private isProcessing = false;
  private statusTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private resolveStopped!: () => void;
  private stoppedPromise: Promise<void>;

  constructor(opentui: OTUICoreCompat, _options: PiTUIAppOptions = {}) {
    this.opentui = opentui;
    this.config = loadConfig();

    const recentSession = getRecentSession();
    this.agent = createAgent({
      sessionId: recentSession?.id,
      onMessage: (msg) => this.handleAgentMessage(msg),
      onToolCall: (name, args) => this.handleToolCall(name, args),
    });

    this.stoppedPromise = new Promise<void>((resolve) => {
      this.resolveStopped = resolve;
    });

    this.setupScheduler();
    this.setupConfigHotReload();

    if (this.config.heartbeat.enabled) {
      this.startHeartbeat();
    }
  }

  async start(): Promise<void> {
    this.renderer = await this.opentui.createCliRenderer({
      exitOnCtrlC: false,
      onDestroy: () => this.finalizeStop(),
    });

    this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
      void this.handleKeypress(key);
    });

    this.loadRecentHistory();
    this.render();

    this.statusTimer = setInterval(() => {
      this.render();
    }, 1000);

    return this.stoppedPromise;
  }

  stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }

    stopSchedulerTicker();
    stopHeartbeat();
    stopConfigReloader();

    if (this.renderer) {
      this.renderer.destroy();
    }

    this.finalizeStop();
  }

  private finalizeStop(): void {
    if (!this.stopped) {
      this.stopped = true;
    }
    this.resolveStopped();
  }

  private async handleKeypress(key: KeyEvent): Promise<void> {
    if (this.stopped) {
      return;
    }

    if (key.ctrl && key.name === 'c') {
      this.stop();
      return;
    }

    if (key.name === 'escape') {
      this.inputValue = '';
      this.render();
      return;
    }

    if (key.name === 'enter' || key.name === 'return') {
      const submitted = this.inputValue;
      this.inputValue = '';
      this.render();
      await this.handleSubmit(submitted);
      return;
    }

    if (key.name === 'backspace' || key.name === 'delete') {
      this.inputValue = this.inputValue.slice(0, -1);
      this.render();
      return;
    }

    const char = this.getPrintableChar(key);
    if (char) {
      this.inputValue += char;
      this.render();
    }
  }

  private getPrintableChar(key: KeyEvent): string {
    if (key.ctrl || key.meta || key.option) {
      return '';
    }

    if (key.name === 'space') {
      return ' ';
    }

    if (key.sequence && key.sequence.length === 1 && key.sequence >= ' ') {
      return key.sequence;
    }

    if (key.name.length === 1) {
      return key.name;
    }

    return '';
  }

  private loadRecentHistory(): void {
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
    this.render();

    try {
      await this.agent.sendMessage(trimmed);
    } catch (error) {
      this.addMessage('system', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    this.isProcessing = false;
    this.setBusy(false);
    this.render();
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

    this.render();
  }

  private estimateTokens(content: string): number {
    const text = content.trim();
    if (!text) {
      return 0;
    }
    return Math.ceil(text.length / 4) + 4;
  }

  private getContextUsage(): ContextUsage {
    const maxTokens = Math.max(this.config.context.maxTokens, 1);
    const windowMessages = this.messages.slice(-PiTUIApp.CONTEXT_WINDOW_MESSAGES);
    const usedTokens = windowMessages.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0);
    const leftPercent = Math.max(0, Math.min(100, Math.round((1 - usedTokens / maxTokens) * 100)));

    return { usedTokens, maxTokens, leftPercent };
  }

  private formatMessage(msg: ChatMessage): string {
    const time = new Date(msg.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });

    switch (msg.role) {
      case 'user':
        return `${color.dim(time)} ${color.cyan('You')}  ${msg.content}`;
      case 'assistant':
        return `\n${color.dim(time)} ${color.green('xz')}\n${msg.content}\n`;
      case 'system':
        return `${color.dim(time)} ${color.yellow('sys')} ${color.dim(msg.content)}`;
      case 'tool':
        return `${color.dim(time)} ${color.magenta('tool')} ${msg.content}`;
      default:
        return `${color.dim(time)} ${msg.content}`;
    }
  }

  private renderWelcome(): string {
    const lines = [
      color.cyan('xz') + color.dim(' | AI Agent with Memory'),
      color.dim('Type your message and press Enter'),
      '',
      `${color.dim('model')} ${color.green(this.config.model.provider)}/${color.green(this.config.model.model)}`,
      `${color.dim('session')} ${color.dim(this.agent.getSessionId().slice(0, 16))}...`,
      '',
      color.dim('Try: /help'),
    ];

    return lines.join('\n');
  }

  private renderMessages(): string {
    if (this.messages.length === 0) {
      return this.renderWelcome();
    }
    return this.messages.slice(-140).map((m) => this.formatMessage(m)).join('\n');
  }

  private renderHeartbeatIndicator(): string {
    const hb = getHeartbeatManager();
    if (!hb.isRunning()) {
      return color.dim('off');
    }

    const status = hb.getStatus();
    if (status.state === 'executing') {
      return color.yellow('running');
    }

    const mins = Math.floor(status.nextRunInMs / 60000);
    return color.dim(mins < 1 ? 'in <1m' : `in ${mins}m`);
  }

  private renderHeaderContent(): string {
    const providerModel = `${this.config.model.provider}/${this.config.model.model}`;
    const sessionShort = this.agent.getSessionId().slice(0, 12);
    const state = this.isProcessing ? color.yellow('busy') : color.green('ready');

    return [
      `${color.cyan('xz')} ${color.dim('AI Agent')}`,
      `${color.dim(providerModel)}  ${color.dim('session')} ${color.white(sessionShort)}  ${color.dim('hb')} ${this.renderHeartbeatIndicator()}  ${color.dim('state')} ${state}`,
    ].join('\n');
  }

  private renderContextFooter(): string {
    const usage = this.getContextUsage();
    const percentText = `${usage.leftPercent}% left`;

    if (usage.leftPercent <= 10) {
      return color.red(percentText);
    }
    if (usage.leftPercent <= 30) {
      return color.yellow(percentText);
    }
    return color.dim(percentText);
  }

  private renderInputLine(): string {
    const prompt = this.isProcessing ? color.yellow('>') : color.cyan('>');
    const cursor = this.isProcessing ? '' : color.dim('▌');
    return `${prompt} ${this.inputValue}${cursor}`;
  }

  private renderInputHint(): string {
    return color.dim('/help  /new  /memory  /history  /tasks  /heartbeat  /config  Ctrl+C quit');
  }

  private render(): void {
    if (this.stopped || !this.renderer) {
      return;
    }

    const root = new this.opentui.BoxRenderable(this.renderer, {
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      padding: 1,
      gap: 1,
    });

    const headerBox = new this.opentui.BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'single',
      padding: 1,
    });

    const headerText = new this.opentui.TextRenderable(this.renderer, {
      content: this.renderHeaderContent(),
    });

    headerBox.add(headerText);

    const conversationBox = new this.opentui.BoxRenderable(this.renderer, {
      flexGrow: 1,
      border: true,
      borderStyle: 'rounded',
      title: 'Conversation',
      padding: 1,
      flexDirection: 'column',
      gap: 1,
    });

    const transcriptWrap = new this.opentui.BoxRenderable(this.renderer, {
      flexGrow: 1,
      overflow: 'hidden',
      minHeight: 4,
    });

    const transcriptText = new this.opentui.TextRenderable(this.renderer, {
      content: this.renderMessages(),
      width: '100%',
      height: '100%',
    });

    const contextFooter = new this.opentui.TextRenderable(this.renderer, {
      content: this.renderContextFooter(),
    });

    transcriptWrap.add(transcriptText);
    conversationBox.add(transcriptWrap);
    conversationBox.add(contextFooter);

    const inputBox = new this.opentui.BoxRenderable(this.renderer, {
      border: true,
      borderStyle: 'single',
      title: this.isProcessing ? 'Thinking' : 'Input',
      padding: 1,
      flexDirection: 'column',
      gap: 1,
    });

    const inputText = new this.opentui.TextRenderable(this.renderer, {
      content: this.renderInputLine(),
    });

    const hintText = new this.opentui.TextRenderable(this.renderer, {
      content: this.renderInputHint(),
    });

    inputBox.add(inputText);
    inputBox.add(hintText);

    root.add(headerBox);
    root.add(conversationBox);
    root.add(inputBox);

    if (this.rootView) {
      this.renderer.root.remove(this.rootView);
      this.rootView.destroy();
    }

    this.rootView = root;
    this.renderer.root.add(root);
    this.renderer.requestRender();
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
          const status = t.isEnabled ? '●' : '○';
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
    const helpText = `
Commands:
  /new           Start a new session
  /memory        Search knowledge memory
  /history       Search chat history
  /tasks         List scheduled tasks
  /heartbeat     Show/control autonomous mode
  /config        Show configuration
  /help          Show this help
  exit           Quit xz

Shortcuts:
  Enter          Submit input
  Esc            Clear input
  Ctrl+C         Quit
`;

    this.addMessage('system', helpText);
  }

  private setupScheduler(): void {
    if (!this.config.scheduler.enabled) {
      return;
    }

    const ticker = getSchedulerTicker({
      onTaskDue: (task) => {
        this.addMessage('system', `Task: ${task.description}`);
        void this.agent.handleWakeup(task.description);
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
    this.render();
  }

  stopHeartbeat(): void {
    stopHeartbeat();
    this.heartbeatStarted = false;
    this.render();
  }

  private recordUserActivity(): void {
    getHeartbeatManager().recordUserActivity();
  }

  private setBusy(busy: boolean): void {
    getHeartbeatManager().setBusy(busy);
  }
}

export async function runTUI(options?: PiTUIAppOptions): Promise<void> {
  let opentui: OTUICoreCompat;

  try {
    opentui = await loadOpenTUICore();
  } catch {
    const { runTUI: runLegacyTUI } = await import('./app.js');
    await runLegacyTUI();
    return;
  }

  const app = new PiTUIApp(opentui, options);
  await app.start();
}
