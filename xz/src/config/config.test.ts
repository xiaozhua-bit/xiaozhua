import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, rmdirSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  isFirstRun,
  loadConfig,
  saveConfig,
  detectAvailableProviders,
  createConfigFromProvider,
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_CONFIG,
} from './index.js';

// Test helpers
const TEST_CONFIG_DIR = join(homedir(), '.xz-test');
const TEST_CONFIG_FILE = join(TEST_CONFIG_DIR, 'config.toml');

describe('config', () => {
  beforeEach(() => {
    // Clean up any existing test config
    if (existsSync(TEST_CONFIG_FILE)) {
      unlinkSync(TEST_CONFIG_FILE);
    }
    if (existsSync(TEST_CONFIG_DIR)) {
      rmdirSync(TEST_CONFIG_DIR);
    }
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_CONFIG_FILE)) {
      unlinkSync(TEST_CONFIG_FILE);
    }
    if (existsSync(TEST_CONFIG_DIR)) {
      rmdirSync(TEST_CONFIG_DIR);
    }
  });

  it('should detect first run when config does not exist', () => {
    // This test runs against the actual config file, so we'll skip if it exists
    if (existsSync(CONFIG_FILE)) {
      console.log('Skipping first-run test: config file exists');
      return;
    }
    expect(isFirstRun()).toBe(true);
  });

  it('should return default config when loading without file', () => {
    const config = loadConfig();
    expect(config.model.provider).toBe(DEFAULT_CONFIG.model.provider);
    expect(config.context.maxTokens).toBe(DEFAULT_CONFIG.context.maxTokens);
  });

  it('should detect available providers', () => {
    const providers = detectAvailableProviders();
    expect(providers.length).toBeGreaterThan(0);
    expect(providers.some(p => p.id === 'kimi')).toBe(true);
    expect(providers.some(p => p.id === 'openai')).toBe(true);
  });

  it('should create config from provider selection', () => {
    const config = createConfigFromProvider('kimi');
    expect(config.model.provider).toBe('kimi');
    expect(config.model.model).toBe('kimi-for-coding');
    expect(config.auth.type).toBe('oauth');
  });

  it('should create OpenAI config with custom model', () => {
    const config = createConfigFromProvider('openai', {
      apiKey: 'test-key',
      customModel: 'gpt-4o-mini',
    });
    expect(config.model.provider).toBe('openai');
    expect(config.model.model).toBe('gpt-4o-mini');
    expect(config.auth.apiKey).toBe('test-key');
  });

  it('should create Anthropic config', () => {
    const config = createConfigFromProvider('anthropic');
    expect(config.model.provider).toBe('anthropic');
    expect(config.auth.type).toBe('api_key');
  });
});
