// Message Types
export type MessageRole = 'user' | 'assistant' | 'system';

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  id: string;
  type: 'message';
  role: MessageRole;
  content: string;
  timestamp?: string | number;
  createdAt?: number;
  toolCalls?: ToolCall[];  // Nested tool calls from history API
}

export interface ToolCallMessage {
  id: string;
  type: 'tool_call';
  name: string;
  args: unknown;
  timestamp?: string;
}

// Server Events
export interface StatusMessage {
  type: 'status';
  data: {
    sessionId: string;
    stats: ContextStats;
  };
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  data: HeartbeatStatus;
}

export interface StreamStartMessage {
  type: 'stream_start';
}

export interface StreamDeltaMessage {
  type: 'stream_delta';
  content: string;
}

export interface StreamEndMessage {
  type: 'stream_end';
}

export interface ErrorMessage {
  type: 'error';
  content: string;
}

export type ServerMessage = 
  | ChatMessage 
  | ToolCallMessage 
  | StatusMessage 
  | HeartbeatMessage
  | StreamStartMessage 
  | StreamDeltaMessage 
  | StreamEndMessage 
  | ErrorMessage;

// WebSocket
export interface WebSocketMessage {
  type: 'message' | 'command' | 'ping';
  content?: string;
  command?: string;
  args?: string[];
}

// Config
export interface Config {
  model: {
    provider: string;
    model: string;
    baseUrl: string;
  };
  heartbeat: {
    enabled: boolean;
    intervalMs: number;
  };
}

// Session
export interface Session {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
}

// Heartbeat
export interface HeartbeatStatus {
  context: {
    isRunning: boolean;
    runCount: number;
    totalTasksExecuted: number;
    lastRunAt: string | null;
    lastUserActivityAt: string;
  };
  state: 'idle' | 'waiting' | 'executing';
  nextRunInMs: number;
}

// Context Stats
export interface ContextStats {
  usedTokens: number;
  messageCount: number;
}
