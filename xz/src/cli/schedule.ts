/**
 * xz schedule CLI commands
 */

import { Command } from 'commander';
import { 
  createTask, 
  listTasks, 
  deleteTask, 
  getTask, 
  getNextTask,
  enableTask,
  disableTask
} from '../scheduler/index.js';

export function createScheduleCommand(): Command {
  const schedule = new Command('schedule')
    .description('Scheduled tasks management');

  // List command
  schedule
    .command('list')
    .description('List scheduled tasks')
    .option('-a, --all', 'Show all tasks including disabled')
    .action(async (options) => {
      try {
        const tasks = listTasks({ enabledOnly: !options.all });
        
        if (tasks.length === 0) {
          console.log(options.all 
            ? 'No tasks found.' 
            : 'No enabled tasks. Use --all to see disabled tasks.'
          );
          return;
        }

        console.log(`Tasks (${tasks.length}):\n`);

        tasks.forEach((task, i) => {
          const status = task.isEnabled ? '✓' : '✗';
          const type = task.isRecurring ? 'recurring' : 'once';
          const when = formatWhen(task);
          
          console.log(`${i + 1}. [${status}] ${task.description}`);
          console.log(`   ID: ${task.id}`);
          console.log(`   Type: ${type} | ${when}`);
          
          if (task.lastExecutedAt) {
            const lastRun = new Date(task.lastExecutedAt).toLocaleString();
            const status = task.lastExecutionStatus || 'unknown';
            console.log(`   Last run: ${lastRun} (${status})`);
          }
          console.log('');
        });

        // Show next scheduled task
        const next = getNextTask();
        if (next) {
          const nextTime = next.executeAt 
            ? new Date(next.executeAt).toLocaleString()
            : 'unknown';
          console.log(`Next task: "${next.description}" at ${nextTime}`);
        }
      } catch (error) {
        console.error('List failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Add command
  schedule
    .command('add')
    .description('Add a scheduled task')
    .argument('<description>', 'Task description (what to do)')
    .argument('<time>', 'When to execute: HH:MM (daily), "in X minutes/hours", ISO timestamp')
    .option('-r, --recurring <interval>', 'Recurring: daily, hourly, or interval in minutes')
    .action(async (description, time, options) => {
      try {
        const parsed = parseTime(time, options.recurring);
        
        const task = createTask({
          description,
          executeAt: parsed.executeAt,
          intervalSeconds: parsed.intervalSeconds,
          isRecurring: parsed.isRecurring,
        });

        console.log('✓ Task created:');
        console.log(`  ID: ${task.id}`);
        console.log(`  Description: ${task.description}`);
        console.log(`  Execute at: ${task.executeAt ? new Date(task.executeAt).toLocaleString() : 'recurring'}`);
        console.log(`  Recurring: ${task.isRecurring ? 'yes' : 'no'}`);
      } catch (error) {
        console.error('Add failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Remove command
  schedule
    .command('remove')
    .description('Remove a scheduled task')
    .argument('<task-id>', 'Task ID')
    .action(async (taskId) => {
      try {
        const task = getTask(taskId);
        if (!task) {
          console.error(`Task not found: ${taskId}`);
          process.exit(1);
        }

        deleteTask(taskId);
        console.log(`✓ Deleted task: ${task.description}`);
      } catch (error) {
        console.error('Remove failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Enable command
  schedule
    .command('enable')
    .description('Enable a scheduled task')
    .argument('<task-id>', 'Task ID')
    .action(async (taskId) => {
      try {
        const task = getTask(taskId);
        if (!task) {
          console.error(`Task not found: ${taskId}`);
          process.exit(1);
        }

        enableTask(taskId);
        console.log(`✓ Enabled task: ${task.description}`);
      } catch (error) {
        console.error('Enable failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Disable command
  schedule
    .command('disable')
    .description('Disable a scheduled task')
    .argument('<task-id>', 'Task ID')
    .action(async (taskId) => {
      try {
        const task = getTask(taskId);
        if (!task) {
          console.error(`Task not found: ${taskId}`);
          process.exit(1);
        }

        disableTask(taskId);
        console.log(`✓ Disabled task: ${task.description}`);
      } catch (error) {
        console.error('Disable failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return schedule;
}

/**
 * Parse time string to executeAt timestamp and interval
 */
function parseTime(
  time: string, 
  recurring?: string
): { executeAt?: number; intervalSeconds?: number; isRecurring: boolean } {
  const now = Date.now();
  let executeAt: number | undefined;
  let intervalSeconds: number | undefined;
  let isRecurring = false;

  // "in X minutes"
  const inMatch = time.match(/in\s+(\d+)\s*(minute|minutes|min|m)/i);
  if (inMatch) {
    const minutes = parseInt(inMatch[1]);
    executeAt = now + minutes * 60 * 1000;
  }

  // "in X hours"
  const hourMatch = time.match(/in\s+(\d+)\s*(hour|hours|hr|h)/i);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    executeAt = now + hours * 60 * 60 * 1000;
  }

  // HH:MM (daily at that time)
  const timeMatch = time.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const target = new Date();
    target.setHours(hours, minutes, 0, 0);
    
    // If time already passed today, schedule for tomorrow
    if (target.getTime() <= now) {
      target.setDate(target.getDate() + 1);
    }
    
    executeAt = target.getTime();
    
    // Daily recurring
    if (recurring === 'daily' || (!recurring && true)) {
      isRecurring = true;
      intervalSeconds = 24 * 60 * 60; // 24 hours
    }
  }

  // ISO timestamp
  if (!executeAt) {
    const iso = new Date(time);
    if (!isNaN(iso.getTime())) {
      executeAt = iso.getTime();
    }
  }

  // Handle recurring option
  if (recurring) {
    isRecurring = true;
    
    if (recurring === 'hourly') {
      intervalSeconds = 60 * 60;
    } else if (recurring === 'daily') {
      intervalSeconds = 24 * 60 * 60;
    } else {
      // Assume minutes
      const mins = parseInt(recurring);
      if (!isNaN(mins)) {
        intervalSeconds = mins * 60;
      }
    }

    // For recurring tasks without specific executeAt, start now
    if (!executeAt) {
      executeAt = now;
    }
  }

  if (!executeAt && !isRecurring) {
    throw new Error(`Unable to parse time: ${time}. Use HH:MM, "in X minutes", or ISO timestamp.`);
  }

  return { executeAt, intervalSeconds, isRecurring };
}

/**
 * Format when a task will execute
 */
function formatWhen(task: { executeAt?: number; intervalSeconds?: number; isRecurring: boolean }): string {
  if (task.executeAt) {
    return new Date(task.executeAt).toLocaleString();
  }
  if (task.isRecurring && task.intervalSeconds) {
    const mins = Math.floor(task.intervalSeconds / 60);
    if (mins < 60) return `every ${mins} minutes`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `every ${hours} hours`;
    return `every ${Math.floor(hours / 24)} days`;
  }
  return 'pending';
}
