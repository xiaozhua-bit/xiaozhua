/**
 * xz CLI - Command line interface for AI Agent
 */

import { Command } from 'commander';
import { isFirstRun, loadConfig } from '../config/index.js';
import { runSetupWizard } from '../config/wizard.js';
import { startTUI } from '../tui/index.js';
import { createMemoryCommand } from './memory.js';
import { createHistoryCommand } from './history.js';
import { createScheduleCommand } from './schedule.js';
import { createSkillCommand } from './skills.js';
import { createHeartbeatCommand } from './heartbeat.js';

const program = new Command('xz')
  .description('AI Agent CLI with retrieval-based memory')
  .version('0.1.0');

// Config commands
program
  .command('config')
  .description('View or modify configuration')
  .option('--reset', 'Reset configuration (run setup wizard again)')
  .action(async (options) => {
    if (options.reset) {
      await runSetupWizard();
      return;
    }

    try {
      const config = loadConfig();
      console.log('Current configuration:');
      console.log(JSON.stringify(config, null, 2));
    } catch {
      console.log('No configuration found. Run `xz config --reset` to setup.');
    }
  });

// Memory commands
program.addCommand(createMemoryCommand());

// History commands
program.addCommand(createHistoryCommand());

// Schedule commands
program.addCommand(createScheduleCommand());

// Skill commands
program.addCommand(createSkillCommand());

// Heartbeat commands
program.addCommand(createHeartbeatCommand());

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // No args = TUI mode
  if (args.length === 0) {
    // Check first run
    if (isFirstRun()) {
      await runSetupWizard();
    }
    // Start TUI
    await startTUI();
    return;
  }

  // Parse CLI commands
  await program.parseAsync();
}

// Export for testing
export { program };
