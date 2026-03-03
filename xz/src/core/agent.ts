/**
 * Agent orchestrator
 * Wraps @mariozechner/pi-agent-core while keeping xz's public Agent interface.
 */

import { Agent as CoreAgent, type AgentEvent, type AgentMessage, type AgentTool } from '@mariozechner/pi-agent-core';
import { loadConfig } from '../config/index.js';
import { ensureFreshKimiCredentials, loadKimiCredentials } from '../config/kimi.js';
import { createSession, createMessage, listMessages, type Message as HistoryMessage } from '../history/index.js';
import type { Message } from './llm.js';
import { buildSystemPrompt, loadSkillsForPrompt } from './prompt.js';

const DEFAULT_ERROR_REPLY = 'Sorry, I encountered an error processing your request.';
const WAKEUP_ERROR_REPLY = 'Failed to process scheduled task.';

const EMPTY_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
} as const;

type RuntimeModel = {
  id: string;
  name: string;
  api: 'anthropic-messages' | 'openai-completions';
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  headers?: Record<string, string>;
};

export interface AgentOptions {
  sessionId?: string;
  onMessage?: (message: Message) => void;
  onToolCall?: (name: string, args: unknown) => void;
  onAssistantStreamStart?: () => void;
  onAssistantStreamDelta?: (delta: string) => void;
  onAssistantReasoningDelta?: (delta: string) => void;
  onAssistantStreamEnd?: () => void;
}

export class Agent {
  private sessionId: string;
  private core: CoreAgent;
  private config: ReturnType<typeof loadConfig>;
  private onMessage?: (message: Message) => void;
  private onToolCall?: (name: string, args: unknown) => void;
  private onAssistantStreamStart?: () => void;
  private onAssistantStreamDelta?: (delta: string) => void;
  private onAssistantReasoningDelta?: (delta: string) => void;
  private onAssistantStreamEnd?: () => void;
  private systemPrompt: string = '';
  private ready: Promise<void>;
  private isAssistantStreamOpen = false;
  private suppressNextUserMessage = false;

  constructor(options: AgentOptions = {}) {
    this.config = loadConfig();
    this.onMessage = options.onMessage;
    this.onToolCall = options.onToolCall;
    this.onAssistantStreamStart = options.onAssistantStreamStart;
    this.onAssistantStreamDelta = options.onAssistantStreamDelta;
    this.onAssistantReasoningDelta = options.onAssistantReasoningDelta;
    this.onAssistantStreamEnd = options.onAssistantStreamEnd;

    if (options.sessionId) {
      this.sessionId = options.sessionId;
    } else {
      const session = createSession({ title: 'New Conversation' });
      this.sessionId = session.id;
    }

    const initialModel = this.buildRuntimeModel();
    const initialMessages = this.buildInitialMessages(initialModel);

    this.core = new CoreAgent({
      initialState: {
        systemPrompt: '',
        model: initialModel as never,
        tools: this.buildTools(),
        messages: initialMessages,
        thinkingLevel: this.config.model.provider === 'kimi' ? 'medium' : 'off',
      },
      sessionId: this.sessionId,
      getApiKey: async () => this.resolveApiKey(),
    });

    this.core.subscribe((event) => this.handleCoreEvent(event));
    this.ready = this.initSystemPrompt();
  }

  /**
   * Initialize system prompt
   */
  private async initSystemPrompt(): Promise<void> {
    try {
      const skills = await loadSkillsForPrompt();
      this.systemPrompt = await buildSystemPrompt({ skills });
      this.core.setSystemPrompt(this.systemPrompt);
    } catch (error) {
      console.error('Failed to initialize system prompt:', error);
      this.systemPrompt = '';
      this.core.setSystemPrompt(this.systemPrompt);
    }
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Send a message and get response
   */
  async sendMessage(content: string): Promise<void> {
    await this.runPrompt(content, DEFAULT_ERROR_REPLY);
  }

  /**
   * Handle scheduled task wakeup
   */
  async handleWakeup(taskDescription: string): Promise<void> {
    const content = `[Scheduled Task: ${taskDescription}]`;
    this.saveMessage('system', content);

    // Keep wakeup marker as system in history/UI, but send as user prompt to the model.
    await this.runPrompt(content, WAKEUP_ERROR_REPLY, true);
  }

  /**
   * Run one prompt through pi-agent-core with compatibility handling.
   */
  private async runPrompt(content: string, errorReply: string, suppressUserMessage = false): Promise<void> {
    await this.ready;
    await this.refreshRuntimeModel();
    this.suppressNextUserMessage = suppressUserMessage;

    try {
      await this.core.prompt(content);
    } catch (error) {
      console.error('LLM error:', error);
      this.closeAssistantStreamIfNeeded();
      this.saveMessage('assistant', errorReply);
    } finally {
      this.suppressNextUserMessage = false;
    }
  }

  private handleCoreEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'message_start': {
        const message = event.message as { role?: string };
        if (message.role === 'user') {
          if (this.suppressNextUserMessage) {
            this.suppressNextUserMessage = false;
            return;
          }
          const content = this.extractUserContent(event.message);
          if (content.length > 0) {
            this.saveMessage('user', content);
          }
        }
        break;
      }
      case 'message_update': {
        const message = event.message as { role?: string };
        if (message.role !== 'assistant') {
          return;
        }

        const update = event.assistantMessageEvent;
        if (update.type === 'text_delta') {
          this.openAssistantStreamIfNeeded();
          this.onAssistantStreamDelta?.(update.delta);
        } else if (update.type === 'thinking_delta') {
          this.openAssistantStreamIfNeeded();
          this.onAssistantReasoningDelta?.(update.delta);
        }
        break;
      }
      case 'message_end': {
        const message = event.message as { role?: string };
        if (message.role !== 'assistant') {
          return;
        }

        this.closeAssistantStreamIfNeeded();

        const finalContent = this.extractAssistantContent(event.message);
        if (finalContent) {
          this.saveMessage('assistant', finalContent);
        }
        break;
      }
      case 'tool_execution_start':
        this.onToolCall?.(event.toolName, event.args);
        break;
      case 'agent_end':
        this.closeAssistantStreamIfNeeded();
        break;
    }
  }

  private openAssistantStreamIfNeeded(): void {
    if (this.isAssistantStreamOpen) {
      return;
    }
    this.isAssistantStreamOpen = true;
    this.onAssistantStreamStart?.();
  }

  private closeAssistantStreamIfNeeded(): void {
    if (!this.isAssistantStreamOpen) {
      return;
    }
    this.isAssistantStreamOpen = false;
    this.onAssistantStreamEnd?.();
  }

  private extractUserContent(message: AgentMessage): string {
    const input = (message as { content?: unknown }).content;

    if (typeof input === 'string') {
      return input;
    }

    if (Array.isArray(input)) {
      return input
        .filter((part): part is { type: string; text?: string } => typeof part === 'object' && part !== null)
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('');
    }

    return '';
  }

  private extractAssistantContent(message: AgentMessage): string | null {
    const assistant = message as {
      content?: unknown;
      errorMessage?: string;
    };

    const contentBlocks = Array.isArray(assistant.content) ? assistant.content : [];
    const hasToolCall = contentBlocks.some(
      (part) => typeof part === 'object' && part !== null && (part as { type?: string }).type === 'toolCall',
    );

    // Keep compatibility with previous behavior: assistant tool-call turns are not persisted.
    if (hasToolCall) {
      return null;
    }

    const text = contentBlocks
      .filter((part): part is { type: string; text?: string } => typeof part === 'object' && part !== null)
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text as string)
      .join('');

    if (text.trim().length > 0) {
      return text;
    }

    const thinking = contentBlocks
      .filter((part): part is { type: string; thinking?: string } => typeof part === 'object' && part !== null)
      .filter((part) => part.type === 'thinking' && typeof part.thinking === 'string')
      .map((part) => part.thinking as string)
      .join('');

    if (thinking.trim().length > 0) {
      return thinking;
    }

    if (assistant.errorMessage && assistant.errorMessage.trim().length > 0) {
      return assistant.errorMessage;
    }

    return null;
  }

  private async refreshRuntimeModel(): Promise<void> {
    this.config = loadConfig();
    const kimiAccessToken = await this.getKimiAccessToken();
    this.core.setModel(this.buildRuntimeModel(kimiAccessToken) as never);
    this.core.sessionId = this.sessionId;
  }

  private async resolveApiKey(): Promise<string | undefined> {
    if (this.config.model.provider === 'kimi') {
      return await this.getKimiAccessToken();
    }

    if (this.config.auth.type === 'api_key' && this.config.auth.apiKey) {
      return this.config.auth.apiKey;
    }

    if (this.config.model.provider === 'openai') {
      return process.env.OPENAI_API_KEY;
    }

    if (this.config.model.provider === 'anthropic') {
      return process.env.ANTHROPIC_API_KEY;
    }

    return process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  }

  private async getKimiAccessToken(): Promise<string | undefined> {
    if (this.config.model.provider !== 'kimi') {
      return undefined;
    }

    if (this.config.auth.type === 'oauth') {
      const creds = await ensureFreshKimiCredentials(this.config.auth.oauthClientId || '');
      return creds?.access_token || process.env.KIMI_API_KEY;
    }

    return this.config.auth.apiKey || process.env.KIMI_API_KEY;
  }

  private buildRuntimeModel(kimiAccessToken?: string): RuntimeModel {
    const contextWindow = Math.max(this.config.context.maxTokens, 1000);
    const maxTokens = 32768;

    if (this.config.model.provider === 'kimi') {
      const token =
        kimiAccessToken ||
        (this.config.auth.type === 'oauth'
          ? loadKimiCredentials()?.access_token
          : (this.config.auth.apiKey || process.env.KIMI_API_KEY));

      const headers: Record<string, string> = {
        'User-Agent': 'claude-code/0.1.0',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      return {
        id: this.mapKimiModelId(this.config.model.model),
        name: 'Kimi For Coding',
        api: 'anthropic-messages',
        provider: 'kimi-coding',
        baseUrl: this.normalizeAnthropicBaseUrl(this.config.model.baseUrl),
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
        headers,
      };
    }

    if (this.config.model.provider === 'anthropic') {
      return {
        id: this.config.model.model,
        name: this.config.model.model,
        api: 'anthropic-messages',
        provider: 'anthropic',
        baseUrl: this.normalizeAnthropicBaseUrl(this.config.model.baseUrl),
        reasoning: true,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
      };
    }

    return {
      id: this.config.model.model,
      name: this.config.model.model,
      api: 'openai-completions',
      provider: this.config.model.provider,
      baseUrl: this.normalizeBaseUrl(this.config.model.baseUrl),
      reasoning: false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
    };
  }

  private mapKimiModelId(model: string): string {
    const normalized = model.trim().toLowerCase();

    if (!normalized || normalized === 'kimi-for-coding') {
      return 'k2p5';
    }
    if (normalized === 'k2.5' || normalized === 'kimi-k2.5' || normalized === 'k2p5') {
      return 'k2p5';
    }
    if (normalized.includes('thinking')) {
      return 'kimi-k2-thinking';
    }
    return model;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, '');
  }

  private normalizeAnthropicBaseUrl(baseUrl: string): string {
    const normalized = this.normalizeBaseUrl(baseUrl);
    if (normalized.endsWith('/v1')) {
      return normalized.slice(0, -3);
    }
    return normalized;
  }

  private buildInitialMessages(model: RuntimeModel): AgentMessage[] {
    const { messages } = listMessages(this.sessionId, { limit: 50 });
    const out: AgentMessage[] = [];

    for (const message of messages) {
      if (message.role === 'user') {
        out.push({
          role: 'user',
          content: [{ type: 'text', text: message.content }],
          timestamp: message.createdAt,
        } as AgentMessage);
      } else if (message.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: [{ type: 'text', text: message.content }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
          stopReason: 'stop',
          timestamp: message.createdAt,
        } as AgentMessage);
      }
    }

    return out;
  }

  private buildTools(): AgentTool<any>[] {
    return [
      {
        name: 'bash',
        label: 'Bash',
        description: 'Execute bash commands including xz CLI for memory/history search',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The bash command to execute',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in seconds',
              default: 60,
            },
          },
          required: ['command'],
        } as any,
        execute: async (_toolCallId, args) => {
          this.onToolCall?.('bash', args);
          const result = await this.executeBash(String(args.command ?? ''), Number(args.timeout ?? 60));
          return this.toolText(result);
        },
      },
      {
        name: 'memory_search',
        label: 'Memory Search',
        description: 'Search knowledge memory for facts and information',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            limit: {
              type: 'number',
              description: 'Max results',
              default: 5,
            },
          },
          required: ['query'],
        } as any,
        execute: async (_toolCallId, args) => {
          this.onToolCall?.('memory_search', args);
          const result = await this.executeMemorySearch(String(args.query ?? ''), Number(args.limit ?? 5));
          return this.toolText(result);
        },
      },
      {
        name: 'edit_file',
        label: 'Edit File',
        description: 'Edit an existing file by replacing one exact text block with new text',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'File path to edit (relative to current working directory or absolute path)',
            },
            oldText: {
              type: 'string',
              description: 'Exact text to replace (must appear exactly once)',
            },
            newText: {
              type: 'string',
              description: 'Replacement text',
            },
          },
          required: ['path', 'oldText', 'newText'],
        } as any,
        execute: async (_toolCallId, args) => {
          this.onToolCall?.('edit_file', args);
          const result = await this.executeEditFile(
            String(args.path ?? ''),
            String(args.oldText ?? args.old_text ?? ''),
            String(args.newText ?? args.new_text ?? ''),
          );
          return this.toolText(result);
        },
      },
      {
        name: 'schedule_task',
        label: 'Schedule Task',
        description: 'Schedule a task for future execution',
        parameters: {
          type: 'object',
          properties: {
            description: {
              type: 'string',
              description: 'What to do when triggered',
            },
            when: {
              type: 'string',
              description: 'When to execute (HH:MM, "in X minutes", ISO timestamp)',
            },
            recurring: {
              type: 'string',
              enum: ['daily', 'hourly', 'none'],
              default: 'none',
            },
          },
          required: ['description', 'when'],
        } as any,
        execute: async (_toolCallId, args) => {
          this.onToolCall?.('schedule_task', args);
          const result = await this.executeScheduleTask(
            String(args.description ?? ''),
            String(args.when ?? ''),
            String(args.recurring ?? 'none'),
          );
          return this.toolText(result);
        },
      },
      {
        name: 'update_config',
        label: 'Update Config',
        description: 'Update agent configuration (e.g., heartbeat settings)',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Config path (e.g., "heartbeat.enabled", "heartbeat.intervalMs")',
              enum: [
                'heartbeat.enabled',
                'heartbeat.intervalMs',
                'heartbeat.proactiveMode',
                'heartbeat.checkPendingTasks',
                'heartbeat.idleThresholdMs',
                'heartbeat.maxConsecutiveRuns',
              ],
            },
            value: {
              description: 'New value',
            },
          },
          required: ['path', 'value'],
        } as any,
        execute: async (_toolCallId, args) => {
          this.onToolCall?.('update_config', args);
          const result = await this.executeUpdateConfig(String(args.path ?? ''), args.value);
          return this.toolText(result);
        },
      },
    ];
  }

  private toolText(text: string): { content: [{ type: 'text'; text: string }]; details: Record<string, never> } {
    return {
      content: [{ type: 'text', text }],
      details: {},
    };
  }

  /**
   * Execute bash command
   */
  private async executeBash(command: string, timeout = 60): Promise<string> {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, { timeout: timeout * 1000 });
      return stdout || stderr || 'Command completed with no output';
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Execute memory search
   */
  private async executeMemorySearch(query: string, limit = 5): Promise<string> {
    const { searchKnowledge } = await import('../knowledge/index.js');
    const results = searchKnowledge(query, { limit });

    if (results.items.length === 0) {
      return 'No results found.';
    }

    return results.items
      .map((r, i) => `${i + 1}. ${r.chunk.file}:${r.chunk.lineStart}-${r.chunk.lineEnd}: ${r.chunk.content.slice(0, 100)}`)
      .join('\n');
  }

  /**
   * Edit file by exact single replacement
   */
  private async executeEditFile(path: string, oldText: string, newText: string): Promise<string> {
    if (!path) {
      return 'Error: "path" is required';
    }
    if (!oldText) {
      return 'Error: "oldText" is required';
    }

    const { isAbsolute, resolve } = await import('path');
    const { readFile, writeFile } = await import('fs/promises');

    const targetPath = isAbsolute(path) ? path : resolve(process.cwd(), path);

    let content: string;
    try {
      content = await readFile(targetPath, 'utf-8');
    } catch (error) {
      return `Error reading file ${path}: ${error instanceof Error ? error.message : String(error)}`;
    }

    const matches = content.split(oldText).length - 1;
    if (matches === 0) {
      return `Error: oldText not found in ${path}. The text must match exactly.`;
    }
    if (matches > 1) {
      return `Error: oldText appears ${matches} times in ${path}. Provide a more specific block.`;
    }

    const updated = content.replace(oldText, newText);
    if (updated === content) {
      return `No change applied to ${path}.`;
    }

    try {
      await writeFile(targetPath, updated, 'utf-8');
    } catch (error) {
      return `Error writing file ${path}: ${error instanceof Error ? error.message : String(error)}`;
    }

    return `Edited ${path}: replaced ${oldText.length} chars with ${newText.length} chars.`;
  }

  /**
   * Execute update config
   */
  private async executeUpdateConfig(path: string, value: unknown): Promise<string> {
    const { setConfigValue, getConfigSummary } = await import('../tools/config.js');

    try {
      setConfigValue(path, value);
      return `Configuration updated: ${path} = ${JSON.stringify(value)}\n\nCurrent config:\n${getConfigSummary()}`;
    } catch (error) {
      return `Failed to update config: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Execute schedule task
   */
  private async executeScheduleTask(
    description: string,
    when: string,
    recurring: string = 'none',
  ): Promise<string> {
    const { createTask } = await import('../scheduler/index.js');

    const now = Date.now();
    let executeAt: number | undefined;
    let intervalSeconds: number | undefined;
    let isRecurring = false;

    const inMatch = when.match(/in\s+(\d+)\s*min/i);
    if (inMatch) {
      executeAt = now + parseInt(inMatch[1], 10) * 60 * 1000;
    }

    const timeMatch = when.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const target = new Date();
      target.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
      if (target.getTime() <= now) {
        target.setDate(target.getDate() + 1);
      }
      executeAt = target.getTime();
      isRecurring = recurring !== 'none';
      if (recurring === 'hourly') {
        intervalSeconds = 60 * 60;
      } else if (recurring === 'daily') {
        intervalSeconds = 24 * 60 * 60;
      }
    }

    if (!executeAt) {
      return `Could not parse time: ${when}`;
    }

    const task = createTask({
      description,
      executeAt,
      intervalSeconds,
      isRecurring,
    });

    return `Task scheduled: ${task.id} at ${new Date(task.executeAt!).toLocaleString()}`;
  }

  /**
   * Save message to history
   */
  private saveMessage(role: Message['role'], content: string): void {
    createMessage({ sessionId: this.sessionId, role: role as HistoryMessage['role'], content });
    this.onMessage?.({ role, content });
  }
}

/**
 * Create agent instance
 */
export function createAgent(options?: AgentOptions): Agent {
  return new Agent(options);
}
