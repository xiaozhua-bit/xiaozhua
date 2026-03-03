/**
 * Scheduled task management
 */

import { getDatabase } from '../history/database.js';
import type { ScheduledTask, CreateTaskInput, TaskExecution, ListTasksOptions } from './types.js';

/**
 * Create a new scheduled task
 */
export function createTask(input: CreateTaskInput): ScheduledTask {
  const db = getDatabase();
  const now = Date.now();
  
  const task: ScheduledTask = {
    id: generateTaskId(),
    description: input.description,
    cron: input.cron,
    executeAt: input.executeAt,
    intervalSeconds: input.intervalSeconds,
    isRecurring: input.isRecurring || false,
    isEnabled: true,
    createdAt: now,
    updatedAt: now,
  };

  const stmt = db.prepare(`
    INSERT INTO scheduled_tasks 
    (id, description, cron, execute_at, interval_seconds, is_recurring, is_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    task.id,
    task.description,
    task.cron || null,
    task.executeAt || null,
    task.intervalSeconds || null,
    task.isRecurring ? 1 : 0,
    task.isEnabled ? 1 : 0,
    task.createdAt,
    task.updatedAt
  );

  return task;
}

/**
 * Get a task by ID
 */
export function getTask(id: string): ScheduledTask | null {
  const db = getDatabase();
  
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as TaskRow | undefined;
  
  return row ? rowToTask(row) : null;
}

/**
 * List tasks with pagination
 */
export function listTasks(options: ListTasksOptions = {}): ScheduledTask[] {
  const db = getDatabase();
  const limit = options.limit || 50;
  const offset = options.offset || 0;

  let sql = 'SELECT * FROM scheduled_tasks';
  const params: number[] = [];

  if (options.enabledOnly) {
    sql += ' WHERE is_enabled = 1';
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}

/**
 * Get all enabled tasks that are due
 */
export function getDueTasks(now: number = Date.now()): ScheduledTask[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE is_enabled = 1
      AND (
        (execute_at IS NOT NULL AND execute_at <= ?)
        OR
        (is_recurring = 1 AND (
          last_executed_at IS NULL 
          OR (last_executed_at + interval_seconds * 1000) <= ?
        ))
      )
  `).all(now, now) as TaskRow[];

  return rows.map(rowToTask);
}

/**
 * Get the next scheduled task
 */
export function getNextTask(): ScheduledTask | null {
  const db = getDatabase();

  const row = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE is_enabled = 1
      AND execute_at IS NOT NULL
    ORDER BY execute_at ASC
    LIMIT 1
  `).get() as TaskRow | undefined;

  return row ? rowToTask(row) : null;
}

/**
 * Update task last execution info
 */
export function updateTaskExecution(
  id: string,
  status: 'success' | 'failed',
  output?: string
): void {
  const db = getDatabase();
  const now = Date.now();

  db.prepare(`
    UPDATE scheduled_tasks
    SET last_executed_at = ?,
        last_execution_status = ?,
        last_execution_output = ?,
        updated_at = ?
    WHERE id = ?
  `).run(now, status, output || null, now, id);
}

/**
 * Disable a task (for one-time tasks after execution)
 */
export function disableTask(id: string): void {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE scheduled_tasks
    SET is_enabled = 0, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), id);
}

/**
 * Enable a task
 */
export function enableTask(id: string): void {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE scheduled_tasks
    SET is_enabled = 1, updated_at = ?
    WHERE id = ?
  `).run(Date.now(), id);
}

/**
 * Delete a task
 */
export function deleteTask(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

/**
 * Log a task execution
 */
export function logExecution(
  taskId: string,
  startedAt: number,
  status: 'success' | 'failed',
  output?: string,
  error?: string
): void {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO task_executions
    (id, task_id, started_at, completed_at, status, output, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    generateExecutionId(),
    taskId,
    startedAt,
    Date.now(),
    status,
    output || null,
    error || null
  );
}

// Helper types
interface TaskRow {
  id: string;
  description: string;
  cron: string | null;
  execute_at: number | null;
  interval_seconds: number | null;
  is_recurring: number;
  is_enabled: number;
  last_executed_at: number | null;
  last_execution_status: string | null;
  last_execution_output: string | null;
  created_at: number;
  updated_at: number;
}

function rowToTask(row: TaskRow): ScheduledTask {
  return {
    id: row.id,
    description: row.description,
    cron: row.cron || undefined,
    executeAt: row.execute_at || undefined,
    intervalSeconds: row.interval_seconds || undefined,
    isRecurring: row.is_recurring === 1,
    isEnabled: row.is_enabled === 1,
    lastExecutedAt: row.last_executed_at || undefined,
    lastExecutionStatus: row.last_execution_status as 'success' | 'failed' | undefined,
    lastExecutionOutput: row.last_execution_output || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateExecutionId(): string {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
