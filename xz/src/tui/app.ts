/**
 * TUI Application - Enhanced STDIO mode
 * Keeps native terminal scrolling, adds beautiful formatting and status bar
 */

import * as p from '@clack/prompts';
import color from 'picocolors';
import { Agent, createAgent } from '../core/agent.js';
import { getSchedulerTicker, stopSchedulerTicker } from '../scheduler/index.js';
import { loadConfig, startConfigHotReload, stopConfigReloader } from '../config/index.js';
import { getRecentSession, listMessages, type Message as HistoryMessage } from '../history/index.js';
import { getHeartbeatManager, startAutonomousHeartbeat, stopHeartbeat } from '../core/heartbeat.js';

// Simple stdin reader for non-fullscreen input
function readLine(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    
    const onData = (data: Buffer) => {
      const input = data.toString().trim();
      process.stdin.removeListener('data', onData);
      resolve(input);
    };
    
    process.stdin.once('data', onData);
  });
}

export interface TUIAppOptions {
  // Future options
}

interface ContextStats {
  usedTokens: number;
  maxTokens: number;
  percentage: number;
  messageCount: number;
}

export class TUIApp {
  private agent: Agent;
  private running = false;
  private config: ReturnType<typeof loadConfig>;
  private heartbeatStarted = false;
  private contextStats: ContextStats;

  constructor(options: TUIAppOptions = {}) {
    this.config = loadConfig();
    
    // Estimate initial context usage
    this.contextStats = {
      usedTokens: 0,
      maxTokens: this.config.context.maxTokens,
      percentage: 0,
      messageCount: 0,
    };

    // Create or resume agent
    const recentSession = getRecentSession();
    this.agent = createAgent({
      sessionId: recentSession?.id,
      onMessage: (msg) => this.handleAgentMessage(msg),
      onToolCall: (name, args) => this.displayToolCall(name, args),
    });
    this.syncContextStatsFromAgent();

    // Setup background services
    this.setupScheduler();
    this.setupConfigHotReload();
    
    if (this.config.heartbeat.enabled) {
      this.startHeartbeat();
    }
  }

  /**
   * Start the TUI - simple STDIO mode with status bar
   */
  async start(): Promise<void> {
    this.running = true;

    // Display welcome banner
    this.displayWelcome();

    // Show recent messages
    await this.showRecentMessages();

    // Setup graceful exit
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    // Main input loop
    while (this.running) {
      this.printStatusBar();
      
      const input = await this.readInput();
      
      if (!input || !this.running) break;
      
      await this.handleInput(input);
      this.syncContextStatsFromAgent();
    }
  }

  /**
   * Stop the TUI
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    
    stopSchedulerTicker();
    stopHeartbeat();
    stopConfigReloader();
    
    console.log('\n\n👋 Goodbye!\n');
    process.exit(0);
  }

  /**
   * Read input with styled prompt
   */
  private async readInput(): Promise<string | null> {
    try {
      // Use clack's text input for better UX
      const result = await p.text({
        message: '',
        placeholder: 'Type a message or /command...',
      });
      
      if (p.isCancel(result)) {
        return null;
      }
      
      return result as string;
    } catch {
      // Fallback to simple readline if clack fails
      return readLine(color.cyan('> '));
    }
  }

  /**
   * Handle user input
   */
  private async handleInput(input: string): Promise<void> {
    const trimmed = input.trim();
    
    if (!trimmed) return;
    
    // Record activity
    this.recordUserActivity();

    // Handle commands
    if (trimmed === 'exit' || trimmed === 'quit') {
      this.stop();
      return;
    }

    if (trimmed === 'help' || trimmed === '/help') {
      this.displayHelp();
      return;
    }

    if (trimmed.startsWith('/')) {
      await this.handleCommand(trimmed);
      return;
    }

    // Display user message
    this.printMessage('user', trimmed);

    // Send to agent
    this.setBusy(true);
    try {
      await this.agent.sendMessage(trimmed);
    } catch (error) {
      this.printError(error instanceof Error ? error.message : 'Unknown error');
    }
    this.setBusy(false);
  }

  /**
   * Handle agent response messages
   */
  private handleAgentMessage(msg: { role: string; content: string }): void {
    if (msg.role === 'assistant') {
      this.printMessage('assistant', msg.content);
    } else if (msg.role === 'system') {
      this.printSystemMessage(msg.content);
    }
    
    // Update stats after receiving message
    this.syncContextStatsFromAgent();
  }

  /**
   * Print formatted user message
   */
  private printMessage(role: 'user' | 'assistant' | 'system', content: string): void {
    const timestamp = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    if (role === 'user') {
      console.log(`\n${color.dim(timestamp)} ${color.cyan('>')} ${content}`);
    } else if (role === 'assistant') {
      console.log(`\n${color.dim(timestamp)} ${color.green('🤖')}`);
      console.log(content);
    } else {
      console.log(`\n${color.dim(timestamp)} ${color.yellow('⚡')} ${content}`);
    }
  }

  /**
   * Print system message
   */
  private printSystemMessage(content: string): void {
    console.log(`\n${color.dim(new Date().toLocaleTimeString())} ${color.yellow('⚡')} ${color.dim(content)}`);
  }

  /**
   * Print error message
   */
  private printError(message: string): void {
    console.log(`\n${color.red('✖')} ${message}`);
  }

  /**
   * Display status bar with context usage
   */
  private printStatusBar(): void {
    const ctx = this.getContextBar();
    const hb = this.getHeartbeatIndicator();
    
    // Print compact status line
    process.stdout.write(color.dim(`┌─ ${ctx} ${hb}\n└─ `));
  }

  /**
   * Get context usage bar string
   */
  private getContextBar(): string {
    const pct = Math.min(100, Math.max(0, this.contextStats.percentage));
    const barWidth = 20;
    const filled = Math.round((pct / 100) * barWidth);
    const empty = barWidth - filled;
    
    // Color based on usage
    let barColor = color.green;
    if (pct > 70) barColor = color.yellow;
    if (pct > 90) barColor = color.red;
    
    const bar = barColor('█'.repeat(filled)) + color.dim('░'.repeat(empty));
    
    return `CTX ${bar} ${pct.toFixed(1)}% (${this.contextStats.messageCount} msgs)`;
  }

  /**
   * Get heartbeat indicator
   */
  private getHeartbeatIndicator(): string {
    const hb = getHeartbeatManager();
    if (!hb.isRunning()) return '';
    
    const status = hb.getStatus();
    if (status.state === 'executing') {
      return color.yellow('● AUTO');
    }
    
    // Show next run time
    const mins = Math.floor(status.nextRunInMs / 60000);
    if (mins < 1) {
      return color.dim('● auto <1m');
    }
    return color.dim(`● auto ${mins}m`);
  }

  private syncContextStatsFromAgent(): void {
    const stats = this.agent.getContextStats();
    this.contextStats.usedTokens = stats.usedTokens;
    this.contextStats.messageCount = stats.messageCount;
    this.contextStats.percentage =
      (this.contextStats.usedTokens / this.contextStats.maxTokens) * 100;
  }

  /**
   * Display welcome banner
   */
  private displayWelcome(): void {
    console.clear();
    console.log();
    console.log(color.cyan('  🤖 xz') + color.dim(' — AI Agent with Memory'));
    console.log(color.dim('  ─────────────────────────'));
    console.log(`  Model: ${color.green(this.config.model.model)}`);
    console.log(`  Provider: ${color.green(this.config.model.provider)}`);
    console.log(`  Session: ${color.dim(this.agent.getSessionId().slice(0, 16))}...`);
    
    if (this.config.heartbeat.enabled) {
      const mins = Math.floor(this.config.heartbeat.intervalMs / 60000);
      console.log(`  Autonomous: ${color.yellow(`${mins}min intervals`)}`);
    }
    
    console.log();
    console.log(color.dim('  Type /help for commands, exit to quit'));
    console.log();
  }

  /**
   * Display help
   */
  private displayHelp(): void {
    console.log(`
${color.cyan('Commands:')}
  ${color.green('/new')}           Start a new session
  ${color.green('/memory')}        Search knowledge memory
  ${color.green('/history')}       Search chat history  
  ${color.green('/tasks')}         List scheduled tasks
  ${color.green('/heartbeat')}     Show/control autonomous mode
  ${color.green('/config')}        Show configuration
  ${color.green('/help')}          Show this help
  ${color.green('exit')}           Quit xz

${color.cyan('Context Bar:')}
  CTX [████████░░░░░░░░░░░] 45.2% (12 msgs)
       └─ Green: healthy, Yellow: warning, Red: critical
  ● auto 15m  └─ Autonomous mode active, next run in 15 min
`);
  }

  /**
   * Show recent messages from history
   */
  private async showRecentMessages(): Promise<void> {
    const { messages } = listMessages(this.agent.getSessionId(), { limit: 10 });
    
    if (messages.length > 0) {
      console.log(color.dim('  ── Recent messages ──'));
      console.log();
      
      for (const msg of messages) {
        if (msg.content.trim().length === 0) {
          continue;
        }

        if (msg.role === 'user') {
          console.log(`${color.dim('>')} ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '...' : ''}`);
        } else if (msg.role === 'assistant') {
          console.log(`${color.green('🤖')} ${msg.content.slice(0, 150)}${msg.content.length > 150 ? '...' : ''}`);
          console.log();
        }
      }
      
      console.log(color.dim('  ────────────────────'));
      console.log();
    }

    this.syncContextStatsFromAgent();
  }

  /**
   * Handle slash commands
   */
  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    switch (cmd) {
      case 'new': {
        const s = p.spinner();
        s.start('Creating new session...');
        
        this.agent = createAgent({
          onMessage: (msg) => this.handleAgentMessage(msg),
          onToolCall: (name, args) => this.displayToolCall(name, args),
        });
        
        // Reset stats
        this.contextStats = {
          usedTokens: 0,
          maxTokens: this.config.context.maxTokens,
          percentage: 0,
          messageCount: 0,
        };
        this.syncContextStatsFromAgent();
        
        await new Promise(r => setTimeout(r, 300));
        s.stop(`New session: ${color.cyan(this.agent.getSessionId().slice(0, 16))}...`);
        break;
      }

      case 'memory': {
        const query = args.join(' ');
        if (!query) {
          console.log(color.yellow('Usage: /memory <query>'));
          break;
        }
        
        const s = p.spinner();
        s.start('Searching memory...');
        
        const { searchKnowledge } = await import('../knowledge/index.js');
        const results = searchKnowledge(query, { limit: 5 });
        
        s.stop(`Found ${results.total} results`);
        
        results.items.forEach((r, i) => {
          console.log(`\n${color.cyan(`${i + 1}.`)} ${color.dim(r.chunk.file)}:${r.chunk.lineStart}`);
          console.log(`   ${r.chunk.content.slice(0, 120)}...`);
        });
        console.log();
        break;
      }

      case 'history': {
        const hQuery = args.join(' ');
        if (!hQuery) {
          console.log(color.yellow('Usage: /history <query>'));
          break;
        }
        
        const s = p.spinner();
        s.start('Searching history...');
        
        const { searchHistory } = await import('../history/index.js');
        const hResults = searchHistory(hQuery, { limit: 5 });
        
        s.stop(`Found ${hResults.total} results`);
        
        hResults.results.forEach((r, i) => {
          const date = new Date(r.timestamp).toLocaleDateString();
          console.log(`\n${color.cyan(`${i + 1}.`)} [${r.role}] ${color.dim(date)}`);
          console.log(`   ${r.content.slice(0, 120)}...`);
        });
        console.log();
        break;
      }

      case 'tasks': {
        const { listTasks, getNextTask } = await import('../scheduler/index.js');
        const tasks = listTasks();
        
        console.log(`\n${color.cyan('Scheduled Tasks')} (${tasks.length})`);
        
        tasks.slice(0, 10).forEach((t, i) => {
          const status = t.isEnabled ? color.green('●') : color.dim('○');
          const when = t.executeAt 
            ? new Date(t.executeAt).toLocaleString()
            : color.dim('recurring');
          console.log(`  ${status} ${t.description} ${color.dim(when)}`);
        });
        
        const next = getNextTask();
        if (next) {
          console.log(`\n  ${color.yellow('Next:')} "${next.description}" at ${new Date(next.executeAt!).toLocaleTimeString()}`);
        }
        console.log();
        break;
      }

      case 'heartbeat': {
        const subCmd = args[0] || 'status';
        
        if (subCmd === 'start') {
          this.startHeartbeat();
          console.log(color.green('✓ Autonomous heartbeat started'));
        } else if (subCmd === 'stop') {
          this.stopHeartbeat();
          console.log(color.yellow('✓ Autonomous heartbeat stopped'));
        } else {
          const hb = getHeartbeatManager();
          const status = hb.getStatus();
          
          console.log(`\n${color.cyan('Heartbeat Status')}`);
          console.log(`  Running: ${status.context.isRunning ? color.green('Yes') : color.red('No')}`);
          console.log(`  State: ${status.state}`);
          console.log(`  Total runs: ${status.context.runCount}`);
          console.log(`  Tasks executed: ${status.context.totalTasksExecuted}`);
          if (status.nextRunInMs > 0) {
            const mins = Math.floor(status.nextRunInMs / 60000);
            console.log(`  Next run: ${mins > 0 ? `${mins}m` : '<1m'}`);
          }
          console.log();
        }
        break;
      }

      case 'config': {
        console.log(`\n${color.cyan('Configuration')}`);
        console.log(`  Model: ${this.config.model.provider}/${this.config.model.model}`);
        console.log(`  Max tokens: ${this.config.context.maxTokens.toLocaleString()}`);
        console.log(`  Heartbeat: ${this.config.heartbeat.enabled ? color.green('enabled') : color.red('disabled')}`);
        if (this.config.heartbeat.enabled) {
          const mins = Math.floor(this.config.heartbeat.intervalMs / 60000);
          console.log(`    Interval: ${mins} minutes`);
          console.log(`    Proactive: ${this.config.heartbeat.proactiveMode ? 'yes' : 'no'}`);
        }
        console.log(`  Config file: ${color.dim('~/.xz/config.toml')}`);
        console.log();
        break;
      }

      default:
        console.log(color.yellow(`Unknown command: /${cmd}`));
        console.log(color.dim('Type /help for available commands'));
    }
  }

  /**
   * Display tool call
   */
  private displayToolCall(name: string, args: unknown): void {
    console.log(`\n${color.dim('🛠️')} ${color.cyan(name)} ${color.dim(JSON.stringify(args))}`);
  }

  /**
   * Setup scheduler
   */
  private setupScheduler(): void {
    if (!this.config.scheduler.enabled) return;

    const ticker = getSchedulerTicker({
      onTaskDue: (task) => {
        this.printSystemMessage(`⏰ Task: ${task.description}`);
        return this.agent.handleWakeup(task.description);
      },
    });

    ticker.start();
  }

  /**
   * Setup config hot-reload
   */
  private setupConfigHotReload(): void {
    startConfigHotReload((newConfig, _oldConfig, changes) => {
      this.config = newConfig;
      this.contextStats.maxTokens = Math.max(newConfig.context.maxTokens, 1);
      this.syncContextStatsFromAgent();
      this.printSystemMessage(`Config reloaded: ${changes.join(', ')}`);

      if (changes.some(c => c.includes('heartbeat'))) {
        if (newConfig.heartbeat.enabled && !this.heartbeatStarted) {
          this.startHeartbeat();
        } else if (!newConfig.heartbeat.enabled && this.heartbeatStarted) {
          this.stopHeartbeat();
        }
      }
    });
  }

  /**
   * Start heartbeat
   */
  startHeartbeat(): void {
    if (this.heartbeatStarted) return;

    startAutonomousHeartbeat({
      onActivity: (msg) => this.printSystemMessage(msg),
    });

    this.heartbeatStarted = true;
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    stopHeartbeat();
    this.heartbeatStarted = false;
  }

  /**
   * Record user activity
   */
  private recordUserActivity(): void {
    getHeartbeatManager().recordUserActivity();
  }

  /**
   * Set busy status
   */
  private setBusy(busy: boolean): void {
    getHeartbeatManager().setBusy(busy);
  }
}

/**
 * Create and start TUI app
 */
export async function runTUI(options?: TUIAppOptions): Promise<void> {
  const app = new TUIApp(options);
  await app.start();
}
