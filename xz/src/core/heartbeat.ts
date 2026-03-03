/**
 * Heartbeat system for autonomous agent execution
 * 
 * Features:
 * - Configurable via config.toml (heartbeat.*)
 * - Smart idle detection: skips if agent is busy
 * - Proactive mode: agent decides what to do based on memory/context
 * - Hot-reload support: config changes apply without restart
 */

import { createAgent, type Agent } from './agent.js';
import { loadConfig, getConfigReloader, type XZConfig } from '../config/index.js';

export interface HeartbeatContext {
  lastRunAt: number;
  runCount: number;
  consecutiveRuns: number;
  totalTasksExecuted: number;
  isRunning: boolean;
  lastUserActivityAt: number;
  isBusy: boolean;
}

export interface HeartbeatStatus {
  state: 'idle' | 'checking' | 'busy' | 'executing' | 'throttled';
  nextRunInMs: number;
  context: HeartbeatContext;
}

/**
 * Heartbeat manager - controls autonomous execution
 */
export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private agent: Agent;
  private config: XZConfig['heartbeat'];
  private context: HeartbeatContext;
  private onStatusChange?: (status: string, details?: string) => void;
  private configReloader: ReturnType<typeof getConfigReloader>;

  constructor() {
    const fullConfig = loadConfig();
    this.config = fullConfig.heartbeat;
    
    this.agent = createAgent();
    this.context = {
      lastRunAt: 0,
      runCount: 0,
      consecutiveRuns: 0,
      totalTasksExecuted: 0,
      isRunning: false,
      lastUserActivityAt: Date.now(),
      isBusy: false,
    };

    // Setup config hot-reload
    this.configReloader = getConfigReloader({
      onChange: (newConfig) => this.handleConfigChange(newConfig),
    });
  }

  /**
   * Start the heartbeat
   */
  start(): void {
    if (this.context.isRunning) return;
    if (!this.config.enabled) {
      console.log('Heartbeat is disabled in config. Enable with: heartbeat.enabled = true');
      return;
    }

    this.context.isRunning = true;
    this.configReloader.start();
    this.emitStatus('started', `interval: ${this.formatDuration(this.config.intervalMs)}`);

    // Run immediately if idle
    this.tick();

    // Schedule periodic runs
    this.timer = setInterval(() => this.tick(), this.config.intervalMs);
  }

  /**
   * Stop the heartbeat
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.context.isRunning = false;
    this.configReloader.stop();
    this.emitStatus('stopped');
  }

  /**
   * Check if heartbeat is running
   */
  isRunning(): boolean {
    return this.context.isRunning;
  }

  /**
   * Get current status
   */
  getStatus(): HeartbeatStatus {
    const now = Date.now();
    const nextRunInMs = this.context.lastRunAt > 0 
      ? Math.max(0, this.context.lastRunAt + this.config.intervalMs - now)
      : this.config.intervalMs;

    return {
      state: this.context.isBusy ? 'busy' : 'idle',
      nextRunInMs,
      context: { ...this.context },
    };
  }

  /**
   * Record user activity (resets idle timer)
   */
  recordUserActivity(): void {
    this.context.lastUserActivityAt = Date.now();
    this.context.isBusy = false;
  }

  /**
   * Set agent as busy
   */
  setBusy(busy: boolean): void {
    this.context.isBusy = busy;
  }

  /**
   * Set status change callback
   */
  onStatus(callback: (status: string, details?: string) => void): void {
    this.onStatusChange = callback;
  }

  /**
   * Force immediate heartbeat tick
   */
  async forceTick(): Promise<void> {
    await this.tick();
  }

  /**
   * Handle config changes from hot-reload
   */
  private handleConfigChange(newConfig: XZConfig): void {
    const oldEnabled = this.config.enabled;
    const oldInterval = this.config.intervalMs;
    
    this.config = newConfig.heartbeat;

    // Handle enable/disable change
    if (oldEnabled !== this.config.enabled) {
      if (this.config.enabled && !this.context.isRunning) {
        this.start();
      } else if (!this.config.enabled && this.context.isRunning) {
        this.stop();
      }
    }

    // Handle interval change
    if (oldInterval !== this.config.intervalMs && this.context.isRunning) {
      // Restart with new interval
      this.stop();
      this.start();
    }

    this.emitStatus('config-reloaded', `interval: ${this.formatDuration(this.config.intervalMs)}`);
  }

  /**
   * Single heartbeat tick with smart idle detection
   */
  private async tick(): Promise<void> {
    if (!this.context.isRunning || !this.config.enabled) return;

    // Check if agent is busy
    if (this.context.isBusy) {
      this.emitStatus('skipped-busy', 'Agent is currently busy');
      return;
    }

    // Check idle threshold
    const idleTime = Date.now() - this.context.lastUserActivityAt;
    if (idleTime < this.config.idleThresholdMs) {
      this.emitStatus('skipped-active', `User active ${this.formatDuration(idleTime)} ago`);
      return;
    }

    // Prevent runaway execution
    if (this.context.consecutiveRuns >= this.config.maxConsecutiveRuns) {
      this.emitStatus('throttled', `Max ${this.config.maxConsecutiveRuns} consecutive runs reached`);
      this.context.consecutiveRuns = 0;
      return;
    }

    this.context.lastRunAt = Date.now();
    this.context.runCount++;
    this.context.consecutiveRuns++;
    this.context.isBusy = true;

    this.emitStatus('checking', 'Evaluating tasks...');

    try {
      if (this.config.autoExecuteTasks) {
        await this.executeAutonomousCycle();
        this.context.totalTasksExecuted++;
      }

      // Reset consecutive runs on successful idle cycle
      this.context.consecutiveRuns = 0;
    } catch (error) {
      this.emitStatus('error', error instanceof Error ? error.message : String(error));
    } finally {
      this.context.isBusy = false;
    }
  }

  /**
   * Execute one autonomous cycle
   */
  private async executeAutonomousCycle(): Promise<void> {
    const prompt = this.buildAutonomousPrompt();
    await this.agent.sendMessage(prompt);
  }

  /**
   * Build intelligent prompt for autonomous execution
   */
  private buildAutonomousPrompt(): string {
    const now = new Date().toISOString();
    const idleTime = Date.now() - this.context.lastUserActivityAt;
    
    let prompt = `[AUTONOMOUS HEARTBEAT - ${now}]

You have been awakened by the heartbeat system. The user has been idle for ${this.formatDuration(idleTime)}.

YOUR TASK:
1. **Check for pending work**: Review any long-running tasks, scheduled operations, or incomplete work
2. **Assess priority**: Determine if there's anything important that needs attention
3. **Decide action**: Either:
   - Execute necessary background tasks
   - Update knowledge/memory with new insights
   - Perform maintenance (cleanup, organization)
   - Or simply acknowledge "Nothing to do - all caught up"

CURRENT STATUS:
- Heartbeat count: ${this.context.runCount}
- Consecutive runs: ${this.context.consecutiveRuns}
- Config: ${this.config.proactiveMode ? 'PROACTIVE' : 'REACTIVE'} mode
`;

    // Add proactive guidance if enabled
    if (this.config.proactiveMode) {
      prompt += `
PROACTIVE MODE:
You may also:
- Analyze recent conversations for insights worth saving
- Suggest improvements to your own configuration
- Plan future tasks based on patterns you've observed
- Self-reflect on your performance
`;
    }

    // Add task check guidance if enabled
    if (this.config.checkPendingTasks) {
      prompt += `
PENDING TASKS CHECK:
Use available tools to check:
- Scheduled tasks that might need attention
- Knowledge gaps that need filling
- Recent history for follow-up items
`;
    }

    prompt += `
IMPORTANT: Be efficient. If nothing needs to be done, clearly state that and return to idle.`;

    return prompt;
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Emit status change
   */
  private emitStatus(status: string, details?: string): void {
    this.onStatusChange?.(status, details);
  }
}

// Global instance
let globalHeartbeat: HeartbeatManager | null = null;

/**
 * Get or create global heartbeat manager
 */
export function getHeartbeatManager(): HeartbeatManager {
  if (!globalHeartbeat) {
    globalHeartbeat = new HeartbeatManager();
  }
  return globalHeartbeat;
}

/**
 * Stop global heartbeat
 */
export function stopHeartbeat(): void {
  if (globalHeartbeat) {
    globalHeartbeat.stop();
    globalHeartbeat = null;
  }
}

/**
 * Start autonomous heartbeat with TUI integration
 */
export function startAutonomousHeartbeat(options: {
  onActivity?: (message: string, details?: string) => void;
} = {}): HeartbeatManager {
  const heartbeat = getHeartbeatManager();

  heartbeat.onStatus((status, details) => {
    const statusMessages: Record<string, string> = {
      started: '🔋 Autonomous mode activated',
      stopped: '🔋 Autonomous mode stopped',
      checking: '🔍 Checking for tasks...',
      executed: '⚡ Executed autonomous task',
      'skipped-busy': '⏭️ Skipped (busy)',
      'skipped-active': '⏭️ Skipped (user active)',
      throttled: '⏸️ Throttled',
      'config-reloaded': '⚙️ Config updated',
      error: '❌ Heartbeat error',
    };

    const message = statusMessages[status] || status;
    options.onActivity?.(message, details);
  });

  heartbeat.start();
  return heartbeat;
}
