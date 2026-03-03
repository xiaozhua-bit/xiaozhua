/**
 * Configuration types for xz AI Agent
 */

export type Provider = 'kimi' | 'openai' | 'anthropic' | 'custom';
export type AuthType = 'oauth' | 'api_key';

export interface ModelConfig {
  provider: Provider;
  model: string;
  baseUrl: string;
}

export interface AuthConfig {
  type: AuthType;
  oauthCredentialsPath?: string;
  oauthClientId?: string;
  apiKey?: string;
}

export interface ContextConfig {
  maxTokens: number;
  preloadIdentity: boolean;
  preloadMemory: boolean;
}

export interface SchedulerConfig {
  enabled: boolean;
  checkIntervalMs: number;
}

export interface MemoryConfig {
  hybridSearch: boolean;
  semanticWeight: number;
  keywordWeight: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;        // 默认 30 分钟 = 1800000ms
  autoExecuteTasks: boolean;
  maxConsecutiveRuns: number;
  idleThresholdMs: number;   // 空闲判断阈值，默认 5 分钟
  checkPendingTasks: boolean; // 是否检查待办任务
  proactiveMode: boolean;    // 主动模式：根据记忆自主判断
}

export interface SetupConfig {
  completed: boolean;
  completedAt?: string;
}

export interface XZConfig {
  model: ModelConfig;
  auth: AuthConfig;
  context: ContextConfig;
  scheduler: SchedulerConfig;
  memory: MemoryConfig;
  heartbeat: HeartbeatConfig;
  setup: SetupConfig;
}

// Provider presets
export const PROVIDER_PRESETS: Record<Provider, { model: string; baseUrl: string; name: string }> = {
  kimi: {
    name: 'Kimi Code',
    model: 'kimi-for-coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
  },
  openai: {
    name: 'OpenAI',
    model: 'gpt-4o',
    baseUrl: 'https://api.openai.com/v1',
  },
  anthropic: {
    name: 'Anthropic',
    model: 'claude-3-opus-20240229',
    baseUrl: 'https://api.anthropic.com/v1',
  },
  custom: {
    name: 'Custom',
    model: '',
    baseUrl: '',
  },
};

// Default configuration
export const DEFAULT_CONFIG: XZConfig = {
  model: {
    provider: 'kimi',
    model: 'kimi-for-coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
  },
  auth: {
    type: 'oauth',
    oauthCredentialsPath: '~/.kimi/credentials/kimi-code.json',
    oauthClientId: '',
  },
  context: {
    maxTokens: 262144,
    preloadIdentity: true,
    preloadMemory: true,
  },
  scheduler: {
    enabled: true,
    checkIntervalMs: 2000,
  },
  memory: {
    hybridSearch: true,
    semanticWeight: 0.7,
    keywordWeight: 0.3,
  },
  heartbeat: {
    enabled: false,              // 默认关闭，需要手动开启
    intervalMs: 30 * 60 * 1000, // 30 分钟
    autoExecuteTasks: true,
    maxConsecutiveRuns: 3,       // 更保守的连续执行次数
    idleThresholdMs: 5 * 60 * 1000, // 5 分钟空闲阈值
    checkPendingTasks: true,
    proactiveMode: true,         // 主动模式：根据记忆自主判断
  },
  setup: {
    completed: false,
  },
};

// Provider option for wizard
export interface ProviderOption {
  id: Provider;
  name: string;
  description: string;
  detected: boolean;
}
