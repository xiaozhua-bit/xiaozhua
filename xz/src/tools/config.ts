/**
 * Config tool - allows agent to modify its own configuration
 */

import { loadConfig, saveConfig, type XZConfig } from '../config/index.js';

export type ConfigPath = 
  | 'model.provider'
  | 'model.model'
  | 'heartbeat.enabled'
  | 'heartbeat.intervalMs'
  | 'heartbeat.proactiveMode'
  | 'heartbeat.checkPendingTasks'
  | 'heartbeat.idleThresholdMs'
  | 'heartbeat.maxConsecutiveRuns'
  | 'scheduler.enabled'
  | 'context.maxTokens';

/**
 * Get configuration value
 */
export function getConfigValue(path: string): unknown {
  const config = loadConfig();
  return getNestedValue(config as unknown as Record<string, unknown>, path);
}

/**
 * Set configuration value
 */
export function setConfigValue(path: string, value: unknown): void {
  const config = loadConfig();
  setNestedValue(config as unknown as Record<string, unknown>, path, value);
  saveConfig(config);
}

/**
 * Update heartbeat configuration
 */
export function updateHeartbeatConfig(
  updates: Partial<XZConfig['heartbeat']>
): XZConfig['heartbeat'] {
  const config = loadConfig();
  config.heartbeat = { ...config.heartbeat, ...updates };
  saveConfig(config);
  return config.heartbeat;
}

/**
 * Enable heartbeat
 */
export function enableHeartbeat(intervalMinutes?: number): void {
  const updates: Partial<XZConfig['heartbeat']> = { enabled: true };
  if (intervalMinutes) {
    updates.intervalMs = intervalMinutes * 60 * 1000;
  }
  updateHeartbeatConfig(updates);
}

/**
 * Disable heartbeat
 */
export function disableHeartbeat(): void {
  updateHeartbeatConfig({ enabled: false });
}

/**
 * Get current configuration as formatted string
 */
export function getConfigSummary(): string {
  const config = loadConfig();
  
  return `
## Model
- Provider: ${config.model.provider}
- Model: ${config.model.model}

## Heartbeat (Autonomous Execution)
- Enabled: ${config.heartbeat.enabled}
- Interval: ${formatDuration(config.heartbeat.intervalMs)}
- Proactive Mode: ${config.heartbeat.proactiveMode}
- Check Pending Tasks: ${config.heartbeat.checkPendingTasks}
- Idle Threshold: ${formatDuration(config.heartbeat.idleThresholdMs)}
- Max Consecutive Runs: ${config.heartbeat.maxConsecutiveRuns}

## Scheduler
- Enabled: ${config.scheduler.enabled}
- Check Interval: ${formatDuration(config.scheduler.checkIntervalMs)}

## Context
- Max Tokens: ${config.context.maxTokens}
- Preload Identity: ${config.context.preloadIdentity}
- Preload Memory: ${config.context.preloadMemory}
`;
}

// Helper functions
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  
  current[parts[parts.length - 1]] = value;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
