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
}

export class Agent {
  private sessionId: string;
  private llm: ReturnType<typeof createLLMClient>;
  private config: ReturnType<typeof loadConfig>;
  private onMessage?: (message: Message) => void;
  private onToolCall?: (name: string, args: unknown) => void;
  private systemPrompt: string | null = null;

  constructor(options: AgentOptions = {}) {
    this.config = loadConfig();
    this.llm = createLLMClient(this.config);
    this.onMessage = options.onMessage;
    this.onToolCall = options.onToolCall;

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

    // Get response from LLM
    let response: LLMResponse;
    try {
      response = await this.llm.chat(messages, { tools: TOOLS });
    } catch (error) {
      console.error('LLM error:', error);
      this.saveMessage('assistant', 'Sorry, I encountered an error processing your request.');
      return;
    }

    // Handle tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      await this.handleToolCalls(response.toolCalls, messages);
    } else if (response.content) {
      // Save assistant response
      this.saveMessage('assistant', response.content);
    }
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

    // Get response
    let response: LLMResponse;
    try {
      response = await this.llm.chat(messages, { tools: TOOLS });
    } catch (error) {
      console.error('LLM error:', error);
      this.saveMessage('assistant', 'Failed to process scheduled task.');
      return;
    }

    // Handle response
    if (response.toolCalls && response.toolCalls.length > 0) {
      await this.handleToolCalls(response.toolCalls, messages);
    } else if (response.content) {
      this.saveMessage('assistant', response.content);
    }
  }

  /**
   * Handle tool calls from LLM
   */
  private async handleToolCalls(
    toolCalls: NonNullable<LLMResponse['toolCalls']>,
    messages: Message[]
  ): Promise<void> {
    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;
      const args = JSON.parse(argsStr);

      this.onToolCall?.(name, args);

      let result: string;

      switch (name) {
        case 'bash':
          result = await this.executeBash(args.command, args.timeout);
          break;
        case 'memory_search':
          result = await this.executeMemorySearch(args.query, args.limit);
          break;
        case 'schedule_task':
          result = await this.executeScheduleTask(args.description, args.when, args.recurring);
          break;
        case 'update_config':
          result = await this.executeUpdateConfig(args.path, args.value);
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

    // Get final response after tool calls
    const finalResponse = await this.llm.chat(messages, { tools: TOOLS });
    
    if (finalResponse.content) {
      this.saveMessage('assistant', finalResponse.content);
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
