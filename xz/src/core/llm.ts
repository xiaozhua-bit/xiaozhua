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
  reasoning_content?: string | null;
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
  reasoningContent?: string | null;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMStreamHandlers {
  onContent?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
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
    const body = this.buildRequestBody(messages, options);
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
    const reasoningContent = message.reasoning_content ?? message.reasoning?.content ?? null;

    return {
      content: message.content,
      reasoningContent,
      toolCalls: message.tool_calls,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * Stream chat completion using Server-Sent Events
   */
  async chatStream(
    messages: Message[],
    options: LLMOptions = {},
    handlers: LLMStreamHandlers = {}
  ): Promise<LLMResponse> {
    const url = `${this.baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      ...this.buildRequestBody(messages, options),
      stream: true,
      stream_options: {
        include_usage: true,
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} ${error}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const data = (await response.json()) as OpenAIResponse;
      const choice = data.choices[0];
      const message = choice.message;
      const reasoningContent = message.reasoning_content ?? message.reasoning?.content ?? null;
      return {
        content: message.content,
        reasoningContent,
        toolCalls: message.tool_calls,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
    }

    if (!response.body) {
      return this.chat(messages, options);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let content = '';
    let reasoning = '';
    let usage: LLMResponse['usage'];
    const toolCallMap = new Map<number, ToolCall>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') {
          continue;
        }

        let chunk: OpenAIStreamChunk;
        try {
          chunk = JSON.parse(payload) as OpenAIStreamChunk;
        } catch {
          continue;
        }

        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          continue;
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content;
          handlers.onContent?.(delta.content);
        }

        const reasoningDelta = [delta.reasoning_content, delta.reasoning?.content]
          .find((part) => typeof part === 'string' && part.length > 0);
        if (typeof reasoningDelta === 'string') {
          reasoning += reasoningDelta;
          handlers.onReasoning?.(reasoningDelta);
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const toolDelta of delta.tool_calls) {
            const index = toolDelta.index ?? 0;
            const existing = toolCallMap.get(index) ?? {
              id: toolDelta.id ?? `call_${index}`,
              type: 'function',
              function: {
                name: '',
                arguments: '',
              },
            };

            if (toolDelta.id) {
              existing.id = toolDelta.id;
            }

            const functionDelta = toolDelta.function;
            if (functionDelta?.name) {
              existing.function.name += functionDelta.name;
            }
            if (functionDelta?.arguments) {
              existing.function.arguments += functionDelta.arguments;
            }

            toolCallMap.set(index, existing);
          }
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const payload = buffer.trim().slice(5).trim();
      if (payload && payload !== '[DONE]') {
        try {
          const chunk = JSON.parse(payload) as OpenAIStreamChunk;
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            };
          }
        } catch {
          // Ignore trailing partial data
        }
      }
    }

    const toolCalls = [...toolCallMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map((entry) => entry[1])
      .filter((toolCall) => toolCall.function.name.length > 0);

    const hasToolCalls = toolCalls.length > 0;
    const finalContent = content.length > 0
      ? content
      : (!hasToolCalls && reasoning.length > 0 ? reasoning : null);
    const reasoningContent = reasoning.length > 0 ? reasoning : null;

    return {
      content: finalContent,
      reasoningContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }

  private buildRequestBody(messages: Message[], options: LLMOptions): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.model || this.config.model.model,
      messages: messages.map((m) => {
        const message: Record<string, unknown> = {
          role: m.role,
          content: m.content,
        };

        if (m.tool_calls) {
          message.tool_calls = m.tool_calls;
        }
        if (m.tool_call_id) {
          message.tool_call_id = m.tool_call_id;
        }
        if (Object.prototype.hasOwnProperty.call(m, 'reasoning_content')) {
          message.reasoning_content = m.reasoning_content ?? '';
        }

        return message;
      }),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    return body;
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
      reasoning_content?: string | null;
      reasoning?: {
        content?: string | null;
      };
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

interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: {
        content?: string | null;
      };
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
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
