/**
 * LLM integration for xz
 * Supports OpenAI-compatible APIs including Kimi, OpenAI, Anthropic
 */

import type { XZConfig } from '../config/types.js';
import { loadKimiCredentials } from '../config/kimi.js';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
}

export interface LLMResponse {
  content: string | null;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * LLM client
 */
export class LLMClient {
  private config: XZConfig;
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: XZConfig) {
    this.config = config;
    this.baseUrl = config.model.baseUrl;
    this.headers = this.buildHeaders();
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: Message[],
    options: LLMOptions = {}
  ): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    
    const body: Record<string, unknown> = {
      model: options.model || this.config.model.model,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} ${error}`);
    }

    const data = await response.json() as OpenAIResponse;
    
    const choice = data.choices[0];
    const message = choice.message;

    return {
      content: message.content,
      toolCalls: message.tool_calls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Build request headers based on auth type
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add User-Agent for Kimi Code compatibility
    if (this.config.model.provider === 'kimi') {
      headers['User-Agent'] = 'claude-code/0.1.0';
    }

    if (this.config.auth.type === 'oauth') {
      // Try to load Kimi credentials
      const creds = loadKimiCredentials();
      if (creds) {
        headers['Authorization'] = `Bearer ${creds.access_token}`;
      }
    } else if (this.config.auth.type === 'api_key' && this.config.auth.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.auth.apiKey}`;
    }

    return headers;
  }
}

// OpenAI API response types
interface OpenAIResponse {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Create LLM client from config
 */
export function createLLMClient(config: XZConfig): LLMClient {
  return new LLMClient(config);
}
