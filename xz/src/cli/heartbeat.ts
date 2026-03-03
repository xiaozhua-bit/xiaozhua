/**
 * xz heartbeat CLI commands
 * Control autonomous agent execution
 */

import { Command } from 'commander';
import { 
  getHeartbeatManager, 
  stopHeartbeat,
  startAutonomousHeartbeat,
  type HeartbeatManager 
} from '../core/heartbeat.js';
import { loadConfig, saveConfig, type XZConfig } from '../config/index.js';

export function createHeartbeatCommand(): Command {
  const heartbeat = new Command('heartbeat')
    .description('Autonomous heartbeat control (for long-running tasks)');

  // Status command
  heartbeat
    .command('status')
    .description('Show heartbeat status')
    .action(async () => {
      const manager = getHeartbeatManager();
      const status = manager.getStatus();
      const config = loadConfig().heartbeat;
      
      console.log('\n🔋 Heartbeat Status\n');
      console.log(`Running: ${status.context.isRunning ? 'Yes ✅' : 'No ❌'}`);
      console.log(`Enabled (config): ${config.enabled ? 'Yes' : 'No'}`);
      console.log(`State: ${status.state}`);
      console.log(`\nConfiguration:`);
      console.log(`  Interval: ${formatDuration(config.intervalMs)} (${config.intervalMs}ms)`);
      console.log(`  Idle threshold: ${formatDuration(config.idleThresholdMs)}`);
      console.log(`  Proactive mode: ${config.proactiveMode ? 'Yes' : 'No'}`);
      console.log(`  Check pending tasks: ${config.checkPendingTasks ? 'Yes' : 'No'}`);
      console.log(`  Max consecutive runs: ${config.maxConsecutiveRuns}`);
      
      console.log(`\nStatistics:`);
      console.log(`  Total runs: ${status.context.runCount}`);
      console.log(`  Total tasks executed: ${status.context.totalTasksExecuted}`);
      console.log(`  Consecutive runs: ${status.context.consecutiveRuns}`);
      
      if (status.context.lastRunAt > 0) {
        const lastRun = new Date(status.context.lastRunAt);
        console.log(`  Last run: ${lastRun.toLocaleString()}`);
        
        if (status.context.isRunning) {
          const nextRun = new Date(status.context.lastRunAt + config.intervalMs);
          console.log(`  Next run: ${nextRun.toLocaleString()} (in ${formatDuration(status.nextRunInMs)})`);
        }
      }
      
      if (status.context.lastUserActivityAt > 0) {
        const idleTime = Date.now() - status.context.lastUserActivityAt;
        console.log(`  User idle for: ${formatDuration(idleTime)}`);
      }
      console.log();
    });

  // Start command
  heartbeat
    .command('start')
    .description('Start autonomous heartbeat')
    .option('-i, --interval <minutes>', 'Heartbeat interval in minutes', '30')
    .option('--proactive', 'Enable proactive mode')
    .action(async (options) => {
      // Update config if options provided
      const config = loadConfig();
      let configChanged = false;

      if (options.interval) {
        const minutes = parseInt(options.interval);
        config.heartbeat.intervalMs = minutes * 60 * 1000;
        configChanged = true;
      }

      if (options.proactive) {
        config.heartbeat.proactiveMode = true;
        configChanged = true;
      }

      config.heartbeat.enabled = true;
      configChanged = true;

      if (configChanged) {
        saveConfig(config);
        console.log('✓ Configuration updated');
      }

      const manager = startAutonomousHeartbeat({
        onActivity: (msg, details) => {
          if (details) {
            console.log(`${msg} (${details})`);
          } else {
            console.log(msg);
          }
        },
      });

      console.log(`\n🔋 Autonomous heartbeat started`);
      console.log(`Interval: ${formatDuration(config.heartbeat.intervalMs)}`);
      console.log(`The agent will automatically wake up when idle and execute tasks.\n`);
      console.log('Press Ctrl+C to stop\n');

      // Keep process alive
      process.on('SIGINT', () => {
        manager.stop();
        console.log('\n👋 Heartbeat stopped');
        process.exit(0);
      });

      // Keep running
      await new Promise(() => {});
    });

  // Stop command
  heartbeat
    .command('stop')
    .description('Stop autonomous heartbeat and disable in config')
    .action(async () => {
      // Also update config
      const config = loadConfig();
      config.heartbeat.enabled = false;
      saveConfig(config);
      
      stopHeartbeat();
      console.log('🔋 Heartbeat stopped and disabled in config');
    });

  // Enable/disable commands (config only)
  heartbeat
    .command('enable')
    .description('Enable heartbeat in config (will start on next launch)')
    .action(async () => {
      const config = loadConfig();
      config.heartbeat.enabled = true;
      saveConfig(config);
      console.log('✓ Heartbeat enabled in config');
      console.log('  Run "xz heartbeat start" to start immediately');
    });

  heartbeat
    .command('disable')
    .description('Disable heartbeat in config')
    .action(async () => {
      const config = loadConfig();
      config.heartbeat.enabled = false;
      saveConfig(config);
      console.log('✓ Heartbeat disabled in config');
    });

  // Config command
  heartbeat
    .command('config')
    .description('Configure heartbeat settings')
    .option('-i, --interval <minutes>', 'Set interval in minutes (default: 30)')
    .option('--idle <minutes>', 'Set idle threshold in minutes (default: 5)')
    .option('--proactive [bool]', 'Enable/disable proactive mode')
    .option('--check-tasks [bool]', 'Enable/disable pending task checks')
    .option('--max-runs <n>', 'Set max consecutive runs (default: 3)')
    .action(async (options) => {
      const config = loadConfig();
      const changes: string[] = [];

      if (options.interval) {
        const mins = parseInt(options.interval);
        config.heartbeat.intervalMs = mins * 60 * 1000;
        changes.push(`interval: ${mins} minutes`);
      }

      if (options.idle) {
        const mins = parseInt(options.idle);
        config.heartbeat.idleThresholdMs = mins * 60 * 1000;
        changes.push(`idle threshold: ${mins} minutes`);
      }

      if (options.proactive !== undefined) {
        const enabled = options.proactive === 'true' || options.proactive === true;
        config.heartbeat.proactiveMode = enabled;
        changes.push(`proactive mode: ${enabled ? 'enabled' : 'disabled'}`);
      }

      if (options.checkTasks !== undefined) {
        const enabled = options.checkTasks === 'true' || options.checkTasks === true;
        config.heartbeat.checkPendingTasks = enabled;
        changes.push(`check pending tasks: ${enabled ? 'enabled' : 'disabled'}`);
      }

      if (options.maxRuns) {
        const n = parseInt(options.maxRuns);
        config.heartbeat.maxConsecutiveRuns = n;
        changes.push(`max consecutive runs: ${n}`);
      }

      if (changes.length === 0) {
        console.log('Current heartbeat configuration:');
        console.log(`  enabled: ${config.heartbeat.enabled}`);
        console.log(`  intervalMs: ${config.heartbeat.intervalMs} (${formatDuration(config.heartbeat.intervalMs)})`);
        console.log(`  idleThresholdMs: ${config.heartbeat.idleThresholdMs} (${formatDuration(config.heartbeat.idleThresholdMs)})`);
        console.log(`  proactiveMode: ${config.heartbeat.proactiveMode}`);
        console.log(`  checkPendingTasks: ${config.heartbeat.checkPendingTasks}`);
        console.log(`  maxConsecutiveRuns: ${config.heartbeat.maxConsecutiveRuns}`);
        console.log(`  autoExecuteTasks: ${config.heartbeat.autoExecuteTasks}`);
        console.log('\nUse --help to see available options');
      } else {
        saveConfig(config);
        console.log('✓ Configuration updated:');
        changes.forEach(c => console.log(`  - ${c}`));
        
        // If heartbeat is running, notify about hot-reload
        const manager = getHeartbeatManager();
        if (manager.isRunning()) {
          console.log('\nℹ️  Running heartbeat will pick up changes automatically');
        }
      }
    });

  // Tick command (force one execution)
  heartbeat
    .command('tick')
    .description('Force a single heartbeat tick')
    .action(async () => {
      const manager = getHeartbeatManager();
      console.log('🔍 Executing heartbeat tick...');
      await manager.forceTick();
      console.log('✅ Tick complete');
    });

  // Watch command (interactive)
  heartbeat
    .command('watch')
    .description('Watch autonomous execution in real-time')
    .option('-i, --interval <minutes>', 'Heartbeat interval', '30')
    .action(async (options) => {
      const intervalMs = parseInt(options.interval) * 60 * 1000;
      
      console.log('\n👁️  Watching autonomous execution...');
      console.log('Press Ctrl+C to stop\n');

      const manager = startAutonomousHeartbeat({
        onActivity: (msg, details) => {
          const timestamp = new Date().toLocaleTimeString();
          if (details) {
            console.log(`[${timestamp}] ${msg} - ${details}`);
          } else {
            console.log(`[${timestamp}] ${msg}`);
          }
        },
      });

      // Update interval if specified
      if (options.interval) {
        const config = loadConfig();
        config.heartbeat.intervalMs = intervalMs;
        saveConfig(config);
      }

      // Status update every 10 seconds
      const statusInterval = setInterval(() => {
        const ctx = manager.getStatus().context;
        if (ctx.isRunning) {
          process.stdout.write(`\r💓 Runs: ${ctx.runCount} | Tasks: ${ctx.totalTasksExecuted} | State: ${manager.getStatus().state.padEnd(10)}`);
        }
      }, 10000);

      process.on('SIGINT', () => {
        clearInterval(statusInterval);
        manager.stop();
        console.log('\n\n👋 Watch stopped');
        process.exit(0);
      });

      // Keep running
      await new Promise(() => {});
    });

  return heartbeat;
}

/**
 * Format duration for display
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
