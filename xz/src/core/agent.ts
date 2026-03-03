/**
 * Agent orchestrator
 * Manages conversation flow, tool execution, and LLM interaction
 */

import { loadConfig } from '../config/index.js';
import { createSession, createMessage, listMessages, type Message as HistoryMessage } from '../history/index.js';
import { getSchedulerTicker } from '../scheduler/index.js';
import { createLLMClient, type Message, type LLMResponse, type Tool, type ToolCall } from './llm.js';
import { buildSystemPrompt, loadSkillsForPrompt } from './prompt.js';

// Tool definitions
const TOOLS: Tool[] = [
  {
    name: 'bash',
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
    },
  },
  {
    name: 'memory_search',
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
    },
  },
  {
    name: 'edit_file',
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
    },
  },
  {
    name: 'schedule_task',
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
    },
  },
  {
    name: 'update_config',
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
    },
  },
];

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
  private llm: ReturnType<typeof createLLMClient>;
  private config: ReturnType<typeof loadConfig>;
  private onMessage?: (message: Message) => void;
  private onToolCall?: (name: string, args: unknown) => void;
  private onAssistantStreamStart?: () => void;
  private onAssistantStreamDelta?: (delta: string) => void;
  private onAssistantReasoningDelta?: (delta: string) => void;
  private onAssistantStreamEnd?: () => void;
  private systemPrompt: string | null = null;

  constructor(options: AgentOptions = {}) {
    this.config = loadConfig();
    this.llm = createLLMClient(this.config);
    this.onMessage = options.onMessage;
    this.onToolCall = options.onToolCall;
    this.onAssistantStreamStart = options.onAssistantStreamStart;
    this.onAssistantStreamDelta = options.onAssistantStreamDelta;
    this.onAssistantReasoningDelta = options.onAssistantReasoningDelta;
    this.onAssistantStreamEnd = options.onAssistantStreamEnd;

    // Create or resume session
    if (options.sessionId) {
      this.sessionId = options.sessionId;
    } else {
      const session = createSession({ title: 'New Conversation' });
      this.sessionId = session.id;
    }

    // Initialize system prompt
    this.initSystemPrompt();
  }

  /**
   * Initialize system prompt
   */
  private async initSystemPrompt(): Promise<void> {
    const skills = await loadSkillsForPrompt();
    this.systemPrompt = await buildSystemPrompt({ skills });
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
    // Save user message
    this.saveMessage('user', content);

    // Get conversation history
    const history = this.getHistory();

    // Build messages for LLM
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt || '' },
      ...history,
    ];

    await this.runConversationLoop(messages, 'Sorry, I encountered an error processing your request.');
  }

  /**
   * Handle scheduled task wakeup
   */
  async handleWakeup(taskDescription: string): Promise<void> {
    const content = `[Scheduled Task: ${taskDescription}]`;
    
    // Add system message for the task
    this.saveMessage('system', content);

    // Get conversation history
    const history = this.getHistory();

    // Build messages for LLM
    const messages: Message[] = [
      { role: 'system', content: this.systemPrompt || '' },
      ...history,
    ];

    await this.runConversationLoop(messages, 'Failed to process scheduled task.');
  }

  /**
   * Main agent loop: assistant turn -> tool execution -> next assistant turn.
   * Continues until the assistant returns a final response without tool calls.
   */
  private async runConversationLoop(messages: Message[], errorReply: string): Promise<void> {
    while (true) {
      let response: LLMResponse;
      try {
        response = await this.chatWithStreaming(messages, { tools: TOOLS });
      } catch (error) {
        console.error('LLM error:', error);
        this.saveMessage('assistant', errorReply);
        return;
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        await this.handleToolCalls(
          response.toolCalls,
          messages,
          response.content,
          response.reasoningContent ?? null
        );
        continue;
      }

      if (response.content) {
        this.saveMessage('assistant', response.content);
      }
      return;
    }
  }

  /**
   * Handle tool calls from LLM
   */
  private async handleToolCalls(
    toolCalls: NonNullable<LLMResponse['toolCalls']>,
    messages: Message[],
    assistantContent: string | null = null,
    assistantReasoningContent: string | null = null
  ): Promise<void> {
    // OpenAI-compatible APIs require the assistant tool call message to appear
    // immediately before the corresponding tool response messages.
    // Kimi thinking mode also expects reasoning_content on assistant tool-call messages.
    messages.push({
      role: 'assistant',
      content: assistantContent ?? '',
      tool_calls: toolCalls,
      reasoning_content: assistantReasoningContent ?? '',
    });

    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsStr) as Record<string, unknown>;
      } catch {
        args = {};
      }

      this.onToolCall?.(name, args);

      let result: string;

      switch (name) {
        case 'bash':
          result = await this.executeBash(String(args.command ?? ''), Number(args.timeout ?? 60));
          break;
        case 'memory_search':
          result = await this.executeMemorySearch(String(args.query ?? ''), Number(args.limit ?? 5));
          break;
        case 'edit_file':
          result = await this.executeEditFile(
            String(args.path ?? ''),
            String(args.oldText ?? args.old_text ?? ''),
            String(args.newText ?? args.new_text ?? '')
          );
          break;
        case 'schedule_task':
          result = await this.executeScheduleTask(
            String(args.description ?? ''),
            String(args.when ?? ''),
            String(args.recurring ?? 'none')
          );
          break;
        case 'update_config':
          result = await this.executeUpdateConfig(String(args.path ?? ''), args.value);
          break;
        default:
          result = `Unknown tool: ${name}`;
      }

      // Add tool response to messages
      messages.push({
        role: 'tool',
        content: result,
        tool_call_id: toolCall.id,
      });
    }
  }

  private async chatWithStreaming(messages: Message[], options: { tools: Tool[] }): Promise<LLMResponse> {
    let streamStarted = false;

    try {
      const response = await this.llm.chatStream(messages, options, {
        onContent: (delta) => {
          if (!streamStarted) {
            streamStarted = true;
            this.onAssistantStreamStart?.();
          }
          this.onAssistantStreamDelta?.(delta);
        },
        onReasoning: (delta) => {
          if (!streamStarted) {
            streamStarted = true;
            this.onAssistantStreamStart?.();
          }
          this.onAssistantReasoningDelta?.(delta);
        },
      });

      return response;
    } finally {
      if (streamStarted) {
        this.onAssistantStreamEnd?.();
      }
    }
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
    recurring: string = 'none'
  ): Promise<string> {
    const { createTask } = await import('../scheduler/index.js');

    // Parse time
    const now = Date.now();
    let executeAt: number | undefined;
    let intervalSeconds: number | undefined;
    let isRecurring = false;

    // "in X minutes"
    const inMatch = when.match(/in\s+(\d+)\s*min/i);
    if (inMatch) {
      executeAt = now + parseInt(inMatch[1]) * 60 * 1000;
    }

    // HH:MM
    const timeMatch = when.match(/^(\d{1,2}):(\d{2})$/);
    if (timeMatch) {
      const target = new Date();
      target.setHours(parseInt(timeMatch[1]), parseInt(timeMatch[2]), 0, 0);
      if (target.getTime() <= now) {
        target.setDate(target.getDate() + 1);
      }
      executeAt = target.getTime();
      isRecurring = true;
      intervalSeconds = 24 * 60 * 60;
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
    createMessage({ sessionId: this.sessionId, role, content });
    this.onMessage?.({ role, content });
  }

  /**
   * Get conversation history
   */
  private getHistory(): Message[] {
    const { messages } = listMessages(this.sessionId, { limit: 50 });
    return messages.map(m => ({
      role: m.role as Message['role'],
      content: m.content,
      tool_calls: m.toolCalls as ToolCall[] | undefined,
    }));
  }
}

/**
 * Create agent instance
 */
export function createAgent(options?: AgentOptions): Agent {
  return new Agent(options);
}
