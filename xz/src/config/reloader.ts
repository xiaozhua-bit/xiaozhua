/**
 * Config hot-reload with file watching
 * Allows agent to modify its own configuration
 */

import { watch, FSWatcher } from 'fs';
import { loadConfig, CONFIG_FILE } from './index.js';
import type { XZConfig } from './types.js';

export interface ConfigReloadOptions {
  onChange?: (newConfig: XZConfig, oldConfig: XZConfig) => void;
  debounceMs?: number;
}

/**
 * Config reloader with hot-reload support
 */
export class ConfigReloader {
  private watcher: FSWatcher | null = null;
  private currentConfig: XZConfig;
  private onChange?: (newConfig: XZConfig, oldConfig: XZConfig) => void;
  private debounceTimer: NodeJS.Timeout | null = null;
  private debounceMs: number;

  constructor(options: ConfigReloadOptions = {}) {
    this.onChange = options.onChange;
    this.debounceMs = options.debounceMs ?? 500;
    this.currentConfig = loadConfig();
  }

  /**
   * Start watching config file for changes
   */
  start(): void {
    if (this.watcher) return;

    this.watcher = watch(CONFIG_FILE, (eventType) => {
      if (eventType === 'change') {
        this.handleChange();
      }
    });
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  /**
   * Get current config
   */
  getConfig(): XZConfig {
    return { ...this.currentConfig };
  }

  /**
   * Force reload config
   */
  reload(): XZConfig {
    const oldConfig = this.currentConfig;
    this.currentConfig = loadConfig();
    
    if (this.configChanged(oldConfig, this.currentConfig)) {
      this.onChange?.(this.currentConfig, oldConfig);
    }
    
    return this.currentConfig;
  }

  /**
   * Handle file change with debounce
   */
  private handleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      try {
        this.reload();
      } catch (error) {
        console.warn('Config reload failed:', error);
      }
    }, this.debounceMs);
  }

  /**
   * Check if config actually changed
   */
  private configChanged(oldConfig: XZConfig, newConfig: XZConfig): boolean {
    return JSON.stringify(oldConfig) !== JSON.stringify(newConfig);
  }
}

// Global instance
let globalReloader: ConfigReloader | null = null;

/**
 * Get or create global config reloader
 */
export function getConfigReloader(options?: ConfigReloadOptions): ConfigReloader {
  if (!globalReloader) {
    globalReloader = new ConfigReloader(options);
  }
  return globalReloader;
}

/**
 * Stop config reloader
 */
export function stopConfigReloader(): void {
  if (globalReloader) {
    globalReloader.stop();
    globalReloader = null;
  }
}

/**
 * Start config hot-reload with callback
 */
export function startConfigHotReload(
  onChange: (newConfig: XZConfig, oldConfig: XZConfig, changes: string[]) => void
): ConfigReloader {
  const reloader = getConfigReloader({
    onChange: (newConfig, oldConfig) => {
      const changes = detectChanges(oldConfig, newConfig);
      onChange(newConfig, oldConfig, changes);
    },
  });

  reloader.start();
  return reloader;
}

/**
 * Detect what changed between configs
 */
function detectChanges(oldConfig: XZConfig, newConfig: XZConfig): string[] {
  const changes: string[] = [];

  // Check heartbeat changes
  if (JSON.stringify(oldConfig.heartbeat) !== JSON.stringify(newConfig.heartbeat)) {
    if (oldConfig.heartbeat.enabled !== newConfig.heartbeat.enabled) {
      changes.push(`heartbeat.enabled: ${oldConfig.heartbeat.enabled} → ${newConfig.heartbeat.enabled}`);
    }
    if (oldConfig.heartbeat.intervalMs !== newConfig.heartbeat.intervalMs) {
      changes.push(`heartbeat.interval: ${oldConfig.heartbeat.intervalMs}ms → ${newConfig.heartbeat.intervalMs}ms`);
    }
    if (oldConfig.heartbeat.proactiveMode !== newConfig.heartbeat.proactiveMode) {
      changes.push(`heartbeat.proactiveMode: ${oldConfig.heartbeat.proactiveMode} → ${newConfig.heartbeat.proactiveMode}`);
    }
  }

  // Check model changes
  if (oldConfig.model.model !== newConfig.model.model) {
    changes.push(`model: ${oldConfig.model.model} → ${newConfig.model.model}`);
  }

  // Check scheduler changes
  if (oldConfig.scheduler.enabled !== newConfig.scheduler.enabled) {
    changes.push(`scheduler.enabled: ${oldConfig.scheduler.enabled} → ${newConfig.scheduler.enabled}`);
  }

  return changes;
}
