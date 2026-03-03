import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTask, getDueTasks, getTask, updateTaskExecution } from './manager.js';
import { SchedulerTicker } from './ticker.js';
import { resetDatabase } from '../history/database.js';

describe('scheduler', () => {
  let testHome = '';

  beforeEach(async () => {
    testHome = mkdtempSync(join(tmpdir(), 'xz-scheduler-test-'));
    process.env.XZ_HOME = testHome;
    await resetDatabase();
  });

  afterEach(async () => {
    await resetDatabase();
    rmSync(testHome, { recursive: true, force: true });
    delete process.env.XZ_HOME;
  });

  it('does not run recurring tasks before executeAt', () => {
    const now = Date.now();
    const executeAt = now + 10 * 60 * 1000;

    const task = createTask({
      description: 'future recurring',
      executeAt,
      intervalSeconds: 60,
      isRecurring: true,
    });

    const dueNow = getDueTasks(now);
    expect(dueNow.some((t) => t.id === task.id)).toBe(false);

    const dueAtTime = getDueTasks(executeAt);
    expect(dueAtTime.some((t) => t.id === task.id)).toBe(true);
  });

  it('runs one-time task only once after first attempt', () => {
    const now = Date.now();
    const task = createTask({
      description: 'one-time',
      executeAt: now,
      isRecurring: false,
    });

    expect(getDueTasks(now).some((t) => t.id === task.id)).toBe(true);

    updateTaskExecution(task.id, 'failed', 'intentional');
    expect(getDueTasks(now + 1000).some((t) => t.id === task.id)).toBe(false);
  });

  it('records failed status when callback throws', async () => {
    const task = createTask({
      description: 'failing callback task',
      executeAt: Date.now() - 1,
      isRecurring: false,
    });

    const ticker = new SchedulerTicker({
      onTaskDue: () => {
        throw new Error('boom');
      },
    });

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await (ticker as any).handleDueTask(task);
    errorSpy.mockRestore();

    const updated = getTask(task.id);
    expect(updated?.lastExecutionStatus).toBe('failed');
    expect(updated?.isEnabled).toBe(false);
    expect(updated?.lastExecutionOutput).toContain('boom');
  });

  it('records success status when callback completes', async () => {
    const task = createTask({
      description: 'successful callback task',
      executeAt: Date.now() - 1,
      isRecurring: false,
    });

    const ticker = new SchedulerTicker({
      onTaskDue: async () => {
        await Promise.resolve();
      },
    });

    await (ticker as any).handleDueTask(task);

    const updated = getTask(task.id);
    expect(updated?.lastExecutionStatus).toBe('success');
    expect(updated?.isEnabled).toBe(false);
  });
});
