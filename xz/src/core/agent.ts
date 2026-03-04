/**
 * Agent orchestrator
 * Wraps @mariozechner/pi-agent-core while keeping xz's public Agent interface.
 */

import {
  Agent as CoreAgent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@mariozechner/pi-agent-core";
import { existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { loadConfig, getXZHome } from "../config/index.js";
import {
  ensureFreshKimiCredentials,
  loadKimiCredentials,
} from "../config/kimi.js";
import {
  createSession,
  createMessage,
  getRecentMessages,
  type Message as HistoryMessage,
  type ToolCall as HistoryToolCall,
} from "../history/index.js";
import type { Message } from "./llm.js";
import { buildSystemPrompt, loadSkillsForPrompt } from "./prompt.js";

const DEFAULT_ERROR_REPLY =
  "Sorry, I encountered an error processing your request.";
const WAKEUP_ERROR_REPLY = "Failed to process scheduled task.";
const CONTEXT_WINDOW_MESSAGES = 50;
const CONNECTION_ERROR_MAX_RETRIES = 5;
const CONNECTION_RETRY_BASE_DELAY_MS = 500;
const CONNECTION_ERROR_PATTERN =
  /(connection error|network error|fetch failed|failed to fetch|socket hang up|timed out|timeout|econn|enotfound|ehostunreach|upstream connect|connection refused|temporary failure)/i;

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
  api: "anthropic-messages" | "openai-completions";
  provider: string;
  baseUrl: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
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

export interface AgentContextStats {
  usedTokens: number;
  messageCount: number;
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
  private systemPrompt: string = "";
  private systemPromptSourceSignature = "";
  private ready: Promise<void>;
  private isAssistantStreamOpen = false;
  private suppressNextUserMessage = false;
  private abortRequested = false;
  private connectionRetriesRemaining = 0;
  private connectionRetryLoopActive = false;

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
      const session = createSession({ title: "New Conversation" });
      this.sessionId = session.id;
    }

    const initialModel = this.buildRuntimeModel();
    const initialMessages = this.buildInitialMessages(initialModel);

    this.core = new CoreAgent({
      initialState: {
        systemPrompt: "",
        model: initialModel as never,
        tools: this.buildTools(),
        messages: initialMessages,
        thinkingLevel: this.config.model.provider === "kimi" ? "medium" : "off",
      },
      sessionId: this.sessionId,
      getApiKey: async () => this.resolveApiKey(),
    });

    this.core.subscribe((event) => this.handleCoreEvent(event));
    this.ready = this.initSystemPrompt();
  }

  /**
   * Initialize system prompt with identity docs and skills.
   */
  private async initSystemPrompt(): Promise<void> {
    await this.refreshSystemPromptIfSourcesChanged(true);
  }

  private async refreshSystemPromptIfSourcesChanged(
    force = false,
  ): Promise<void> {
    const signature = this.computeSystemPromptSourceSignature();
    if (!force && signature === this.systemPromptSourceSignature) {
      return;
    }

    try {
      const skills = await loadSkillsForPrompt();
      this.systemPrompt = await buildSystemPrompt({ skills });
      this.core.setSystemPrompt(this.systemPrompt);
      this.systemPromptSourceSignature = signature;
    } catch (error) {
      console.error("Failed to initialize system prompt:", error);
      if (!this.systemPrompt) {
        this.systemPrompt = "";
        this.core.setSystemPrompt(this.systemPrompt);
      }
    }
  }

  private computeSystemPromptSourceSignature(): string {
    const xzHome = getXZHome();
    const parts: string[] = [];

    const identityFiles = [
      join(xzHome, "SOUL.md"),
      join(xzHome, "USER.md"),
      join(xzHome, "MEMORY.md"),
    ];
    for (const file of identityFiles) {
      parts.push(this.getFileSignature(file));
    }

    const skillDirs = [
      join(xzHome, "skills"),
      join(homedir(), ".agents", "skills"),
      join(process.cwd(), ".agents", "skills"),
      join(homedir(), ".claude", "skills"),
    ];

    for (const dir of skillDirs) {
      parts.push(...this.getSkillDirSignatures(dir));
    }

    return parts.join("|");
  }

  private getFileSignature(path: string): string {
    try {
      if (!existsSync(path)) {
        return `${path}:missing`;
      }

      const stat = statSync(path);
      return `${path}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
    } catch {
      return `${path}:error`;
    }
  }

  private getSkillDirSignatures(dir: string): string[] {
    if (!existsSync(dir)) {
      return [`${dir}:missing`];
    }

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const signatures = [`${dir}:exists:${entries.length}`];

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        signatures.push(
          this.getFileSignature(join(dir, entry.name, "SKILL.md")),
        );
      }

      return signatures;
    } catch {
      return [`${dir}:error`];
    }
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get context stats from the core agent state.
   * This reflects the real message list used for model calls.
   */
  getContextStats(): AgentContextStats {
    const messages = this.core.state.messages;
    const usedTokens = messages.reduce(
      (sum, message) => sum + this.estimateTokensForMessage(message),
      0,
    );

    return {
      usedTokens,
      messageCount: messages.length,
    };
  }

  isRunning(): boolean {
    return this.core.state.isStreaming;
  }

  cancelCurrentRun(): boolean {
    if (!this.core.state.isStreaming) {
      return false;
    }

    this.abortRequested = true;
    this.closeAssistantStreamIfNeeded();
    this.core.abort();
    void this.cleanupAfterAbort();
    return true;
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
    this.saveMessage("system", content);

    // Keep wakeup marker as system in history/UI, but send as user prompt to the model.
    await this.runPrompt(content, WAKEUP_ERROR_REPLY, true);
  }

  /**
   * Run one prompt through pi-agent-core with compatibility handling.
   */
  private async runPrompt(
    content: string,
    errorReply: string,
    suppressUserMessage = false,
  ): Promise<void> {
    await this.ready;
    await this.refreshRuntimeModel();
    await this.refreshSystemPromptIfSourcesChanged();
    this.abortRequested = false;
    this.suppressNextUserMessage = suppressUserMessage;
    this.connectionRetriesRemaining = CONNECTION_ERROR_MAX_RETRIES;
    this.connectionRetryLoopActive = true;
    let continueFromCurrentState = false;

    try {
      while (true) {
        if (continueFromCurrentState) {
          await this.core.continue();
        } else {
          await this.core.prompt(content);
        }

        if (this.abortRequested) {
          return;
        }

        const errorMessage = this.getCoreErrorMessage();
        if (
          !errorMessage ||
          !this.isConnectionErrorMessage(errorMessage) ||
          this.connectionRetriesRemaining <= 0
        ) {
          break;
        }

        if (!this.pruneTrailingConnectionErrorMarker()) {
          break;
        }

        this.connectionRetriesRemaining -= 1;
        continueFromCurrentState = true;
        await this.waitBeforeConnectionRetry();
      }
    } catch (error) {
      console.error("LLM error:", error);
      this.closeAssistantStreamIfNeeded();
      this.saveMessage("assistant", errorReply);
    } finally {
      this.connectionRetryLoopActive = false;
      this.connectionRetriesRemaining = 0;
      this.suppressNextUserMessage = false;
    }
  }

  private handleCoreEvent(event: AgentEvent): void {
    switch (event.type) {
      case "message_start": {
        const message = event.message as { role?: string };
        if (message.role === "user") {
          if (this.suppressNextUserMessage) {
            this.suppressNextUserMessage = false;
            return;
          }
          const content = this.extractUserContent(event.message);
          if (content.length > 0) {
            this.saveMessage("user", content);
          }
        }
        break;
      }
      case "message_update": {
        const message = event.message as { role?: string };
        if (message.role !== "assistant") {
          return;
        }

        if (this.abortRequested) {
          return;
        }

        const update = event.assistantMessageEvent;
        if (update.type === "text_delta") {
          this.openAssistantStreamIfNeeded();
          this.onAssistantStreamDelta?.(update.delta);
        } else if (update.type === "thinking_delta") {
          this.openAssistantStreamIfNeeded();
          this.onAssistantReasoningDelta?.(update.delta);
        }
        break;
      }
      case "message_end": {
        const message = event.message as { role?: string };
        if (message.role === "assistant") {
          this.closeAssistantStreamIfNeeded();

          if (this.abortRequested) {
            return;
          }

          const payload = this.extractAssistantPayload(event.message);
          if (payload) {
            if (this.shouldSuppressRetryableConnectionError(event.message)) {
              return;
            }
            this.saveMessage("assistant", payload.content, {
              toolCalls: payload.toolCalls,
              emit: payload.content.trim().length > 0,
            });
          }
          return;
        }

        if (message.role === "toolResult") {
          const payload = this.extractToolResultPayload(event.message);
          if (payload) {
            this.saveMessage("tool", payload.content, {
              metadata: payload.metadata,
              emit: false,
            });
          }
        }
        return;
      }
      case "tool_execution_start":
        this.onToolCall?.(event.toolName, event.args);
        break;
      case "agent_end":
        this.closeAssistantStreamIfNeeded();
        this.abortRequested = false;
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

  private async cleanupAfterAbort(): Promise<void> {
    try {
      await this.core.waitForIdle();
      this.pruneTrailingAbortMarker();
    } finally {
      this.abortRequested = false;
    }
  }

  private pruneTrailingAbortMarker(): void {
    const messages = [...this.core.state.messages];
    const last = messages[messages.length - 1] as
      | {
          role?: unknown;
          stopReason?: unknown;
          errorMessage?: unknown;
          content?: unknown;
        }
      | undefined;

    if (!last || last.role !== "assistant") {
      return;
    }

    const stopReason =
      typeof last.stopReason === "string" ? last.stopReason : "";
    const errorMessage =
      typeof last.errorMessage === "string" ? last.errorMessage : "";
    const text = this.extractTextForTokenEstimate(last.content).trim();

    const isAbortMarker =
      stopReason === "aborted" || /abort/i.test(errorMessage);
    if (!isAbortMarker || text.length > 0) {
      return;
    }

    messages.pop();
    this.core.replaceMessages(messages);
  }

  private shouldSuppressRetryableConnectionError(message: AgentMessage): boolean {
    if (
      !this.connectionRetryLoopActive ||
      this.connectionRetriesRemaining <= 0 ||
      this.abortRequested
    ) {
      return false;
    }

    const assistantMessage = message as {
      role?: unknown;
      stopReason?: unknown;
      errorMessage?: unknown;
      content?: unknown;
    };
    if (assistantMessage.role !== "assistant") {
      return false;
    }

    const stopReason =
      typeof assistantMessage.stopReason === "string"
        ? assistantMessage.stopReason
        : "";
    const errorMessage =
      typeof assistantMessage.errorMessage === "string"
        ? assistantMessage.errorMessage
        : "";
    const text = this.extractTextForTokenEstimate(assistantMessage.content).trim();

    return (
      stopReason === "error" &&
      text.length === 0 &&
      this.isConnectionErrorMessage(errorMessage)
    );
  }

  private pruneTrailingConnectionErrorMarker(): boolean {
    const messages = [...this.core.state.messages];
    const last = messages[messages.length - 1] as
      | {
          role?: unknown;
          stopReason?: unknown;
          errorMessage?: unknown;
          content?: unknown;
        }
      | undefined;

    if (!last || last.role !== "assistant") {
      return false;
    }

    const stopReason =
      typeof last.stopReason === "string" ? last.stopReason : "";
    const errorMessage =
      typeof last.errorMessage === "string" ? last.errorMessage : "";
    const text = this.extractTextForTokenEstimate(last.content).trim();

    if (
      stopReason !== "error" ||
      text.length > 0 ||
      !this.isConnectionErrorMessage(errorMessage)
    ) {
      return false;
    }

    messages.pop();
    this.core.replaceMessages(messages);
    return true;
  }

  private getCoreErrorMessage(): string | null {
    const state = this.core.state as { error?: unknown };
    if (typeof state.error !== "string" || state.error.trim().length === 0) {
      return null;
    }
    return state.error;
  }

  private isConnectionErrorMessage(message: string): boolean {
    return CONNECTION_ERROR_PATTERN.test(message.trim());
  }

  private async waitBeforeConnectionRetry(): Promise<void> {
    if (this.abortRequested) {
      return;
    }

    const attempt =
      CONNECTION_ERROR_MAX_RETRIES - this.connectionRetriesRemaining;
    const delayMs = Math.min(CONNECTION_RETRY_BASE_DELAY_MS * attempt, 2500);
    if (delayMs <= 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private extractUserContent(message: AgentMessage): string {
    const input = (message as { content?: unknown }).content;

    if (typeof input === "string") {
      return input;
    }

    if (Array.isArray(input)) {
      return input
        .filter(
          (part): part is { type: string; text?: string } =>
            typeof part === "object" && part !== null,
        )
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("");
    }

    return "";
  }

  private extractAssistantPayload(message: AgentMessage): {
    content: string;
    toolCalls?: HistoryToolCall[];
  } | null {
    const assistant = message as {
      content?: unknown;
      errorMessage?: string;
    };

    const contentBlocks = Array.isArray(assistant.content)
      ? assistant.content
      : [];
    const text = contentBlocks
      .filter(
        (part): part is { type: string; text?: string } =>
          typeof part === "object" && part !== null,
      )
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");

    const thinking = contentBlocks
      .filter(
        (part): part is { type: string; thinking?: string } =>
          typeof part === "object" && part !== null,
      )
      .filter(
        (part) => part.type === "thinking" && typeof part.thinking === "string",
      )
      .map((part) => part.thinking as string)
      .join("");

    const toolCalls = contentBlocks
      .filter(
        (
          part,
        ): part is {
          type: string;
          id?: string;
          name?: string;
          arguments?: unknown;
        } => typeof part === "object" && part !== null,
      )
      .filter(
        (part) => part.type === "toolCall" && typeof part.name === "string",
      )
      .map(
        (part, index) =>
          ({
            id:
              typeof part.id === "string" && part.id.trim().length > 0
                ? part.id
                : `tool_call_${index}`,
            type: "function",
            function: {
              name: part.name as string,
              arguments: this.stringifyToolArguments(part.arguments),
            },
          }) satisfies HistoryToolCall,
      );

    let content = "";
    if (text.trim().length > 0) {
      content = text;
    } else if (thinking.trim().length > 0) {
      content = thinking;
    } else if (
      assistant.errorMessage &&
      assistant.errorMessage.trim().length > 0
    ) {
      content = assistant.errorMessage;
    }

    if (content.length === 0 && toolCalls.length === 0) {
      return null;
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private extractToolResultPayload(message: AgentMessage): {
    content: string;
    metadata: Record<string, unknown>;
  } | null {
    const toolResult = message as {
      content?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      details?: unknown;
      isError?: unknown;
    };

    const contentBlocks = Array.isArray(toolResult.content)
      ? toolResult.content
      : [];
    const text = contentBlocks
      .filter(
        (part): part is { type: string; text?: string } =>
          typeof part === "object" && part !== null,
      )
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string)
      .join("");

    const metadata: Record<string, unknown> = {};
    if (
      typeof toolResult.toolCallId === "string" &&
      toolResult.toolCallId.trim().length > 0
    ) {
      metadata.toolCallId = toolResult.toolCallId;
    }
    if (
      typeof toolResult.toolName === "string" &&
      toolResult.toolName.trim().length > 0
    ) {
      metadata.toolName = toolResult.toolName;
    }
    if (typeof toolResult.isError === "boolean") {
      metadata.isError = toolResult.isError;
    }
    if (toolResult.details !== undefined) {
      metadata.details = toolResult.details;
    }

    if (text.length === 0 && Object.keys(metadata).length === 0) {
      return null;
    }

    return { content: text, metadata };
  }

  private estimateTokensForMessage(message: AgentMessage): number {
    const role = (message as { role?: unknown }).role;

    if (role === "toolResult") {
      const toolMessage = message as {
        toolName?: unknown;
        toolCallId?: unknown;
        content?: unknown;
      };
      const headParts: string[] = [];
      if (typeof toolMessage.toolName === "string") {
        headParts.push(toolMessage.toolName);
      }
      if (typeof toolMessage.toolCallId === "string") {
        headParts.push(toolMessage.toolCallId);
      }
      const content = this.extractTextForTokenEstimate(toolMessage.content);
      const merged = `${headParts.join(" ")} ${content}`.trim();
      return this.estimateTextTokens(merged);
    }

    const content = this.extractTextForTokenEstimate(
      (message as { content?: unknown }).content,
    );
    return this.estimateTextTokens(content);
  }

  private extractTextForTokenEstimate(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (!Array.isArray(content)) {
      return "";
    }

    return content
      .map((part) => this.extractContentPartTextForTokenEstimate(part))
      .filter((text) => text.length > 0)
      .join(" ");
  }

  private extractContentPartTextForTokenEstimate(part: unknown): string {
    if (!this.isRecord(part)) {
      return "";
    }

    const type = part.type;
    if (typeof type !== "string") {
      return "";
    }

    if (type === "text" && typeof part.text === "string") {
      return part.text;
    }

    if (type === "thinking" && typeof part.thinking === "string") {
      return part.thinking;
    }

    if (type === "toolCall") {
      const name = typeof part.name === "string" ? part.name : "";
      const args = this.stringifyToolArguments(part.arguments);
      return `${name} ${args}`.trim();
    }

    return "";
  }

  private estimateTextTokens(text: string): number {
    const normalized = text.trim();
    if (!normalized) {
      return 0;
    }
    return Math.ceil(normalized.length / 4) + 4;
  }

  private async refreshRuntimeModel(): Promise<void> {
    this.config = loadConfig();
    const kimiAccessToken = await this.getKimiAccessToken();
    this.core.setModel(this.buildRuntimeModel(kimiAccessToken) as never);
    this.core.sessionId = this.sessionId;
  }

  private async resolveApiKey(): Promise<string | undefined> {
    if (this.config.model.provider === "kimi") {
      return await this.getKimiAccessToken();
    }

    if (this.config.auth.type === "api_key" && this.config.auth.apiKey) {
      return this.config.auth.apiKey;
    }

    if (this.config.model.provider === "openai") {
      return process.env.OPENAI_API_KEY;
    }

    if (this.config.model.provider === "anthropic") {
      return process.env.ANTHROPIC_API_KEY;
    }

    return process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  }

  private async getKimiAccessToken(): Promise<string | undefined> {
    if (this.config.model.provider !== "kimi") {
      return undefined;
    }

    if (this.config.auth.type === "oauth") {
      const creds = await ensureFreshKimiCredentials(
        this.config.auth.oauthClientId || "",
      );
      return creds?.access_token || process.env.KIMI_API_KEY;
    }

    return this.config.auth.apiKey || process.env.KIMI_API_KEY;
  }

  private buildRuntimeModel(kimiAccessToken?: string): RuntimeModel {
    const contextWindow = Math.max(this.config.context.maxTokens, 1000);
    const maxTokens = 32768;

    if (this.config.model.provider === "kimi") {
      const token =
        kimiAccessToken ||
        (this.config.auth.type === "oauth"
          ? loadKimiCredentials()?.access_token
          : this.config.auth.apiKey || process.env.KIMI_API_KEY);

      const headers: Record<string, string> = {
        "User-Agent": "claude-code/0.1.0",
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      return {
        id: this.mapKimiModelId(this.config.model.model),
        name: "Kimi For Coding",
        api: "anthropic-messages",
        provider: "kimi-coding",
        baseUrl: this.normalizeAnthropicBaseUrl(this.config.model.baseUrl),
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
        headers,
      };
    }

    if (this.config.model.provider === "anthropic") {
      return {
        id: this.config.model.model,
        name: this.config.model.model,
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: this.normalizeAnthropicBaseUrl(this.config.model.baseUrl),
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens,
      };
    }

    return {
      id: this.config.model.model,
      name: this.config.model.model,
      api: "openai-completions",
      provider: this.config.model.provider,
      baseUrl: this.normalizeBaseUrl(this.config.model.baseUrl),
      reasoning: false,
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens,
    };
  }

  private mapKimiModelId(model: string): string {
    const normalized = model.trim().toLowerCase();

    if (!normalized || normalized === "kimi-for-coding") {
      return "k2p5";
    }
    if (
      normalized === "k2.5" ||
      normalized === "kimi-k2.5" ||
      normalized === "k2p5"
    ) {
      return "k2p5";
    }
    if (normalized.includes("thinking")) {
      return "kimi-k2-thinking";
    }
    return model;
  }

  private normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
  }

  private normalizeAnthropicBaseUrl(baseUrl: string): string {
    const normalized = this.normalizeBaseUrl(baseUrl);
    if (normalized.endsWith("/v1")) {
      return normalized.slice(0, -3);
    }
    return normalized;
  }

  private buildInitialMessages(model: RuntimeModel): AgentMessage[] {
    const messages = getRecentMessages(this.sessionId, CONTEXT_WINDOW_MESSAGES);
    const out: AgentMessage[] = [];

    for (const message of messages) {
      if (message.role === "user") {
        out.push({
          role: "user",
          content: [{ type: "text", text: message.content }],
          timestamp: message.createdAt,
        } as AgentMessage);
      } else if (message.role === "assistant") {
        const content: Array<
          | { type: "text"; text: string }
          | {
              type: "toolCall";
              id: string;
              name: string;
              arguments: Record<string, unknown>;
            }
        > = [];

        if (message.content.length > 0) {
          content.push({ type: "text", text: message.content });
        }

        for (const toolCall of message.toolCalls ?? []) {
          if (!toolCall.function?.name) {
            continue;
          }

          content.push({
            type: "toolCall",
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: this.parseToolArguments(toolCall.function.arguments),
          });
        }

        if (content.length === 0) {
          continue;
        }

        out.push({
          role: "assistant",
          content,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: { ...EMPTY_USAGE, cost: { ...EMPTY_USAGE.cost } },
          stopReason: "stop",
          timestamp: message.createdAt,
        } as AgentMessage);
      } else if (message.role === "tool") {
        const metadata = this.asRecord(message.metadata);
        const toolCallId =
          typeof metadata.toolCallId === "string" &&
          metadata.toolCallId.trim().length > 0
            ? metadata.toolCallId
            : message.id;
        const toolName =
          typeof metadata.toolName === "string" &&
          metadata.toolName.trim().length > 0
            ? metadata.toolName
            : "tool";
        const isError = metadata.isError === true;
        const details = Object.prototype.hasOwnProperty.call(
          metadata,
          "details",
        )
          ? metadata.details
          : {};

        out.push({
          role: "toolResult",
          toolCallId,
          toolName,
          content: [{ type: "text", text: message.content }],
          details,
          isError,
          timestamp: message.createdAt,
        } as AgentMessage);
      }
    }

    return out;
  }

  private stringifyToolArguments(argumentsValue: unknown): string {
    if (argumentsValue === undefined) {
      return "{}";
    }

    try {
      return JSON.stringify(argumentsValue);
    } catch {
      return "{}";
    }
  }

  private parseToolArguments(argumentsValue: string): Record<string, unknown> {
    if (!argumentsValue) {
      return {};
    }

    try {
      const parsed = JSON.parse(argumentsValue) as unknown;
      if (this.isRecord(parsed)) {
        return parsed;
      }
      if (Array.isArray(parsed)) {
        return { items: parsed };
      }
      return { value: parsed };
    } catch {
      return { raw: argumentsValue };
    }
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (this.isRecord(value)) {
      return value;
    }
    return {};
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private buildTools(): AgentTool<any>[] {
    return [
      {
        name: "bash",
        label: "Bash",
        description:
          "Execute bash commands including xz CLI for memory/history search",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "The bash command to execute",
            },
            timeout: {
              type: "number",
              description: "Timeout in seconds",
              default: 60,
            },
          },
          required: ["command"],
        } as any,
        execute: async (_toolCallId, args) => {
          const result = await this.executeBash(
            String(args.command ?? ""),
            Number(args.timeout ?? 60),
          );
          return this.toolText(result);
        },
      },
      {
        name: "load_skill",
        label: "Load Skill",
        description:
          "Load full instructions for a single installed skill by name",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Skill name from <available_skills>",
            },
          },
          required: ["name"],
        } as any,
        execute: async (_toolCallId, args) => {
          const result = await this.executeLoadSkill(String(args.name ?? ""));
          return this.toolText(result);
        },
      },
      {
        name: "memory_search",
        label: "Memory Search",
        description:
          "Search knowledge memory for facts and information using FTS5 BM25 ranking",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search query - use keywords or phrases to find relevant memories",
            },
            limit: {
              type: "number",
              description: "Max results to return (default: 5)",
              default: 5,
            },
          },
          required: ["query"],
        } as any,
        execute: async (_toolCallId, args) => {
          const result = await this.executeMemorySearch(
            String(args.query ?? ""),
            Number(args.limit ?? 5),
          );
          return this.toolText(result);
        },
      },
      {
        name: "edit_file",
        label: "Edit File",
        description:
          "Edit an existing file by replacing one exact text block with new text",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "File path to edit (relative to current working directory or absolute path)",
            },
            oldText: {
              type: "string",
              description: "Exact text to replace (must appear exactly once)",
            },
            newText: {
              type: "string",
              description: "Replacement text",
            },
          },
          required: ["path", "oldText", "newText"],
        } as any,
        execute: async (_toolCallId, args) => {
          const result = await this.executeEditFile(
            String(args.path ?? ""),
            String(args.oldText ?? args.old_text ?? ""),
            String(args.newText ?? args.new_text ?? ""),
          );
          return this.toolText(result);
        },
      },
      {
        name: "schedule_task",
        label: "Schedule Task",
        description: "Schedule a task for future execution",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "What to do when triggered",
            },
            when: {
              type: "string",
              description:
                'When to execute (HH:MM, "in X minutes", ISO timestamp)',
            },
            recurring: {
              type: "string",
              enum: ["daily", "hourly", "none"],
              default: "none",
            },
          },
          required: ["description", "when"],
        } as any,
        execute: async (_toolCallId, args) => {
          const result = await this.executeScheduleTask(
            String(args.description ?? ""),
            String(args.when ?? ""),
            String(args.recurring ?? "none"),
          );
          return this.toolText(result);
        },
      },
    ];
  }

  private toolText(text: string): {
    content: [{ type: "text"; text: string }];
    details: Record<string, never>;
  } {
    return {
      content: [{ type: "text", text }],
      details: {},
    };
  }

  /**
   * Execute bash command
   */
  private async executeBash(command: string, timeout = 60): Promise<string> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: timeout * 1000,
      });
      return stdout || stderr || "Command completed with no output";
    } catch (error) {
      return `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Execute memory search
   */
  private async executeMemorySearch(query: string, limit = 5): Promise<string> {
    const { searchKnowledge } = await import("../knowledge/index.js");
    const results = searchKnowledge(query, { limit });

    if (results.items.length === 0) {
      return "No results found.";
    }

    return results.items
      .map(
        (r, i) =>
          `${i + 1}. ${r.chunk.file}:${r.chunk.lineStart}-${r.chunk.lineEnd}: ${r.chunk.content.slice(0, 100)}`,
      )
      .join("\n");
  }

  /**
   * Load full skill instructions by skill name (lazy-load pattern)
   */
  private async executeLoadSkill(name: string): Promise<string> {
    const requested = name.trim();
    if (!requested) {
      return 'Error: "name" is required';
    }

    const { getSkillRegistry } = await import("../skills/index.js");
    const { registerBuiltinSkills } = await import("../skills/builtin.js");

    const registry = getSkillRegistry();
    await registry.load();
    registerBuiltinSkills(registry);

    let skill = registry.get(requested);
    if (!skill) {
      skill = registry
        .list()
        .find((s) => s.name.toLowerCase() === requested.toLowerCase());
    }

    if (!skill) {
      const available = registry
        .list()
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n");
      return `Skill not found: ${requested}\n\nAvailable skills:\n${available}`;
    }

    const lines = [
      `# Skill: ${skill.name}`,
      `Description: ${skill.description}`,
      skill.argumentHint ? `Argument hint: ${skill.argumentHint}` : "",
      `Disable model invocation: ${skill.disableModelInvocation ? "true" : "false"}`,
      `Source: ${skill.source}`,
      "",
      skill.content,
    ].filter((line) => line.length > 0);

    return lines.join("\n");
  }

  /**
   * Execute memory get - retrieve specific file content by line range
   */
  private async executeMemoryGet(
    file: string,
    startLine: number,
    endLine?: number,
  ): Promise<string> {
    const { getFileContent } = await import("../knowledge/index.js");
    const content = getFileContent(file, { startLine, endLine });

    if (content === null) {
      return `File not found or no content in range: ${file}`;
    }

    return content;
  }

  /**
   * Edit file by exact single replacement
   */
  private async executeEditFile(
    path: string,
    oldText: string,
    newText: string,
  ): Promise<string> {
    if (!path) {
      return 'Error: "path" is required';
    }
    if (!oldText) {
      return 'Error: "oldText" is required';
    }

    const { isAbsolute, resolve } = await import("path");
    const { readFile, writeFile } = await import("fs/promises");

    const targetPath = isAbsolute(path) ? path : resolve(process.cwd(), path);

    let content: string;
    try {
      content = await readFile(targetPath, "utf-8");
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
      await writeFile(targetPath, updated, "utf-8");
    } catch (error) {
      return `Error writing file ${path}: ${error instanceof Error ? error.message : String(error)}`;
    }

    return `Edited ${path}: replaced ${oldText.length} chars with ${newText.length} chars.`;
  }

  /**
   * Execute update config
   */
  private async executeUpdateConfig(
    path: string,
    value: unknown,
  ): Promise<string> {
    const { setConfigValue, getConfigSummary } =
      await import("../tools/config.js");

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
    recurring: string = "none",
  ): Promise<string> {
    const { createTask } = await import("../scheduler/index.js");

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
      target.setHours(
        parseInt(timeMatch[1], 10),
        parseInt(timeMatch[2], 10),
        0,
        0,
      );
      if (target.getTime() <= now) {
        target.setDate(target.getDate() + 1);
      }
      executeAt = target.getTime();
      isRecurring = recurring !== "none";
      if (recurring === "hourly") {
        intervalSeconds = 60 * 60;
      } else if (recurring === "daily") {
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
  private saveMessage(
    role: Message["role"],
    content: string,
    options: {
      toolCalls?: HistoryToolCall[];
      metadata?: Record<string, unknown>;
      emit?: boolean;
    } = {},
  ): void {
    createMessage({
      sessionId: this.sessionId,
      role: role as HistoryMessage["role"],
      content,
      toolCalls: options.toolCalls,
      metadata: options.metadata,
    });

    if (options.emit !== false) {
      this.onMessage?.({ role, content });
    }
  }
}

/**
 * Create agent instance
 */
export function createAgent(options?: AgentOptions): Agent {
  return new Agent(options);
}
