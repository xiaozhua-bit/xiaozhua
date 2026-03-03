/**
 * Configuration management for xz AI Agent
 * Handles config loading, saving, and first-run detection
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parse, stringify } from '@iarna/toml';
import { XZConfig, DEFAULT_CONFIG, Provider, ProviderOption } from './types.js';
import { validateConfig, ValidationResult } from './validators.js';
import { detectKimiCredentials } from './kimi.js';

// Config paths
export const CONFIG_DIR = getXZHome();
export const CONFIG_FILE = join(CONFIG_DIR, 'config.toml');

/**
 * Get XZ_HOME directory path
 * Uses XZ_HOME env var, or defaults to ~/.xz
 */
export function getXZHome(): string {
  return process.env.XZ_HOME || join(homedir(), '.xz');
}

/**
 * Ensure XZ_HOME directory exists
 */
export function ensureXZHome(): string {
  const home = getXZHome();
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true });
  }
  return home;
}

/**
 * Check if this is the first run (config doesn't exist)
 */
export function isFirstRun(): boolean {
  return !existsSync(CONFIG_FILE);
}

// Re-export wizard
export { runSetupWizard } from './wizard.js';

/**
 * Load configuration from file
 * Returns default config if file doesn't exist
 */
export function loadConfig(): XZConfig {
  if (!existsSync(CONFIG_FILE)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = parse(content) as Partial<XZConfig>;
    
    // Merge with defaults
    return mergeWithDefaults(parsed);
  } catch (error) {
    console.error('Failed to load config:', error);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to file
 */
export function saveConfig(config: XZConfig): void {
  // Validate before saving
  const validation = validateConfig(config);
  if (!validation.valid) {
    throw new ConfigValidationError('Invalid configuration', validation);
  }

  // Ensure directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Convert to TOML and save
  const toml = stringify(config as unknown as import('@iarna/toml').JsonMap);
  writeFileSync(CONFIG_FILE, toml);
}

/**
 * Merge partial config with defaults
 */
function mergeWithDefaults(partial: Partial<XZConfig>): XZConfig {
  return {
    model: {
      ...DEFAULT_CONFIG.model,
      ...partial.model,
    },
    auth: {
      ...DEFAULT_CONFIG.auth,
      ...partial.auth,
    },
    context: {
      ...DEFAULT_CONFIG.context,
      ...partial.context,
    },
    scheduler: {
      ...DEFAULT_CONFIG.scheduler,
      ...partial.scheduler,
    },
    memory: {
      ...DEFAULT_CONFIG.memory,
      ...partial.memory,
    },
    heartbeat: {
      ...DEFAULT_CONFIG.heartbeat,
      ...partial.heartbeat,
    },
    setup: {
      ...DEFAULT_CONFIG.setup,
      ...partial.setup,
    },
  };
}

/**
 * Detect available providers
 */
export function detectAvailableProviders(): ProviderOption[] {
  return [
    {
      id: 'kimi',
      name: 'Kimi Code (推荐)',
      description: '模型: kimi-for-coding (256K context)',
      detected: detectKimiCredentials(),
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: '需要 OPENAI_API_KEY 环境变量',
      detected: !!process.env.OPENAI_API_KEY,
    },
    {
      id: 'anthropic',
      name: 'Anthropic (Claude)',
      description: '需要 ANTHROPIC_API_KEY 环境变量',
      detected: !!process.env.ANTHROPIC_API_KEY,
    },
    {
      id: 'custom',
      name: '自定义 OpenAI-compatible',
      description: '兼容 OpenAI API 的第三方服务',
      detected: false,
    },
  ];
}

/**
 * Create config from provider selection
 */
export function createConfigFromProvider(
  provider: Provider,
  options: { apiKey?: string; customModel?: string; customBaseUrl?: string } = {}
): XZConfig {
  const config: XZConfig = { ...DEFAULT_CONFIG };

  switch (provider) {
    case 'kimi':
      config.model = {
        provider: 'kimi',
        model: 'kimi-for-coding',
        baseUrl: 'https://api.kimi.com/coding/v1',
      };
      config.auth = {
        type: 'oauth',
        oauthCredentialsPath: '~/.kimi/credentials/kimi-code.json',
      };
      break;

    case 'openai':
      config.model = {
        provider: 'openai',
        model: options.customModel || 'gpt-4o',
        baseUrl: 'https://api.openai.com/v1',
      };
      config.auth = {
        type: 'api_key',
        apiKey: options.apiKey || process.env.OPENAI_API_KEY || '',
      };
      break;

    case 'anthropic':
      config.model = {
        provider: 'anthropic',
        model: options.customModel || 'claude-3-opus-20240229',
        baseUrl: 'https://api.anthropic.com/v1',
      };
      config.auth = {
        type: 'api_key',
        apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY || '',
      };
      break;

    case 'custom':
      config.model = {
        provider: 'custom',
        model: options.customModel || '',
        baseUrl: options.customBaseUrl || '',
      };
      config.auth = {
        type: 'api_key',
        apiKey: options.apiKey || '',
      };
      break;
  }

  return config;
}

/**
 * Custom error for config validation failures
 */
export class ConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly validation: ValidationResult
  ) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Custom error for first run
 */
export class FirstRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirstRunError';
  }
}

// Re-export types
export * from './types.js';
export * from './validators.js';
export * from './kimi.js';
export * from './reloader.js';
