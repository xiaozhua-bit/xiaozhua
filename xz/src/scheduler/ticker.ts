/**
 * TUI-embedded scheduler ticker
 * Runs every 2 seconds to check for due tasks
 */

import { getDueTasks, updateTaskExecution, disableTask } from './manager.js';
import type { ScheduledTask, TaskCallback } from './types.js';

export const DEFAULT_CHECK_INTERVAL_MS = 2000;

export class SchedulerTicker {
  private timer: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private onTaskDue: TaskCallback | null = null;
  private isRunning = false;

  constructor(options: { checkIntervalMs?: number; onTaskDue?: TaskCallback } = {}) {
    this.checkIntervalMs = options.checkIntervalMs || DEFAULT_CHECK_INTERVAL_MS;
    this.onTaskDue = options.onTaskDue || null;
  }

  /**
   * Start the scheduler ticker
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.tick(); // Run immediately
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
  }

  /**
   * Stop the scheduler ticker
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  /**
   * Check if ticker is running
   */
  running(): boolean {
    return this.isRunning;
  }

  /**
   * Set the task callback
   */
  setCallback(callback: TaskCallback): void {
    this.onTaskDue = callback;
  }

  /**
   * Single tick - check for due tasks
   */
  private async tick(): Promise<void> {
    try {
      const dueTasks = getDueTasks();

      for (const task of dueTasks) {
        await this.handleDueTask(task);
      }
    } catch (error) {
      console.error('Scheduler tick error:', error);
    }
  }

  /**
   * Handle a due task
   */
  private async handleDueTask(task: ScheduledTask): Promise<void> {
    // Update last executed time
    updateTaskExecution(task.id, 'success');

    // Disable one-time tasks
    if (!task.isRecurring) {
      disableTask(task.id);
    }

    // Notify callback
    if (this.onTaskDue) {
      try {
        this.onTaskDue(task);
      } catch (error) {
        console.error('Task callback error:', error);
      }
    }
  }
}

// Singleton instance for TUI
let globalTicker: SchedulerTicker | null = null;

/**
 * Get or create the global scheduler ticker
 */
export function getSchedulerTicker(options?: { onTaskDue?: TaskCallback }): SchedulerTicker {
  if (!globalTicker) {
    globalTicker = new SchedulerTicker(options);
  } else if (options?.onTaskDue) {
    globalTicker.setCallback(options.onTaskDue);
  }
  return globalTicker;
}

/**
 * Stop the global scheduler ticker
 */
export function stopSchedulerTicker(): void {
  if (globalTicker) {
    globalTicker.stop();
    globalTicker = null;
  }
}
