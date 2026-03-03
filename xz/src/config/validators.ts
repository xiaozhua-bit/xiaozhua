/**
 * Configuration validation utilities
 */

import { XZConfig, Provider, AuthType } from './types.js';

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validate XZConfig
 */
export function validateConfig(config: Partial<XZConfig>): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate model config
  if (!config.model) {
    errors.push({ field: 'model', message: 'Model configuration is required' });
  } else {
    const validProviders: Provider[] = ['kimi', 'openai', 'anthropic', 'custom'];
    if (!validProviders.includes(config.model.provider)) {
      errors.push({ field: 'model.provider', message: `Invalid provider: ${config.model.provider}` });
    }

    if (!config.model.model) {
      errors.push({ field: 'model.model', message: 'Model name is required' });
    }

    if (!config.model.baseUrl) {
      errors.push({ field: 'model.baseUrl', message: 'Base URL is required' });
    } else {
      try {
        new URL(config.model.baseUrl);
      } catch {
        errors.push({ field: 'model.baseUrl', message: 'Invalid URL format' });
      }
    }
  }

  // Validate auth config
  if (!config.auth) {
    errors.push({ field: 'auth', message: 'Auth configuration is required' });
  } else {
    const validAuthTypes: AuthType[] = ['oauth', 'api_key'];
    if (!validAuthTypes.includes(config.auth.type)) {
      errors.push({ field: 'auth.type', message: `Invalid auth type: ${config.auth.type}` });
    }

    if (config.auth.type === 'oauth' && !config.auth.oauthCredentialsPath) {
      errors.push({ field: 'auth.oauthCredentialsPath', message: 'OAuth credentials path is required' });
    }

    if (config.auth.type === 'api_key' && !config.auth.apiKey) {
      errors.push({ field: 'auth.apiKey', message: 'API key is required' });
    }
  }

  // Validate context config
  if (config.context) {
    if (config.context.maxTokens < 1000) {
      errors.push({ field: 'context.maxTokens', message: 'Max tokens must be at least 1000' });
    }
  }

  // Validate memory config
  if (config.memory) {
    const totalWeight = (config.memory.semanticWeight || 0) + (config.memory.keywordWeight || 0);
    if (Math.abs(totalWeight - 1.0) > 0.01) {
      errors.push({ 
        field: 'memory', 
        message: `Semantic + keyword weights must equal 1.0, got ${totalWeight}` 
      });
    }
  }

  // Validate heartbeat config
  if (config.heartbeat) {
    if (config.heartbeat.intervalMs < 10000) {
      errors.push({ 
        field: 'heartbeat.intervalMs', 
        message: 'Heartbeat interval must be at least 10 seconds (10000ms)' 
      });
    }
    if (config.heartbeat.idleThresholdMs < 5000) {
      errors.push({ 
        field: 'heartbeat.idleThresholdMs', 
        message: 'Idle threshold must be at least 5 seconds (5000ms)' 
      });
    }
    if (config.heartbeat.maxConsecutiveRuns < 1) {
      errors.push({ 
        field: 'heartbeat.maxConsecutiveRuns', 
        message: 'Max consecutive runs must be at least 1' 
      });
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if configuration is complete for use
 */
export function isConfigComplete(config: Partial<XZConfig>): boolean {
  const result = validateConfig(config);
  return result.valid;
}
