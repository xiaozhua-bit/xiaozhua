/**
 * Scheduler types
 */

export interface ScheduledTask {
  id: string;
  description: string;
  cron?: string;
  executeAt?: number;
  intervalSeconds?: number;
  isRecurring: boolean;
  isEnabled: boolean;
  lastExecutedAt?: number;
  lastExecutionStatus?: 'success' | 'failed';
  lastExecutionOutput?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface CreateTaskInput {
  description: string;
  executeAt?: number;
  intervalSeconds?: number;
  isRecurring?: boolean;
  cron?: string;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  startedAt: number;
  completedAt?: number;
  status?: 'success' | 'failed';
  output?: string;
  error?: string;
}

export interface ListTasksOptions {
  limit?: number;
  offset?: number;
  enabledOnly?: boolean;
}

export type TaskCallback = (task: ScheduledTask) => void | Promise<void>;
