/**
 * Message storage for chat history
 */

import { getDatabase } from './database.js';
import { updateMessageCount } from './session.js';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface CreateMessageInput {
  id?: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  metadata?: Record<string, unknown>;
}

export interface ListMessagesOptions {
  limit?: number;
  offset?: number;
}

export interface PaginatedMessages {
  messages: Message[];
  total: number;
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Create a new message
 */
export function createMessage(input: CreateMessageInput): Message {
  const db = getDatabase();
  
  const message: Message = {
    id: input.id || generateMessageId(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    toolCalls: input.toolCalls,
    metadata: input.metadata,
    createdAt: Date.now(),
  };

  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, tool_calls, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    message.id,
    message.sessionId,
    message.role,
    message.content,
    message.toolCalls ? JSON.stringify(message.toolCalls) : null,
    message.metadata ? JSON.stringify(message.metadata) : null,
    message.createdAt
  );

  // Update session message count
  const countRow = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
  ).get(message.sessionId) as { count: number };
  
  updateMessageCount(message.sessionId, countRow.count);

  return message;
}

/**
 * Get a message by ID
 */
export function getMessage(id: string): Message | null {
  const db = getDatabase();
  
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  
  return row ? rowToMessage(row) : null;
}

/**
 * List messages for a session
 */
export function listMessages(
  sessionId: string,
  options: ListMessagesOptions = {}
): PaginatedMessages {
  const db = getDatabase();
  const limit = options.limit || 20;
  const offset = options.offset || 0;

  // Get total count
  const countRow = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
  ).get(sessionId) as { count: number };
  const total = countRow.count;

  // Get messages
  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE session_id = ?
    ORDER BY created_at ASC
    LIMIT ? OFFSET ?
  `).all(sessionId, limit, offset) as MessageRow[];

  const page = Math.floor(offset / limit) + 1;

  return {
    messages: rows.map(rowToMessage),
    total,
    page,
    perPage: limit,
    hasNext: offset + limit < total,
    hasPrev: offset > 0,
  };
}

/**
 * Get recent messages for a session (most recent first)
 */
export function getRecentMessages(
  sessionId: string,
  limit: number = 10
): Message[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(sessionId, limit) as MessageRow[];

  return rows.map(rowToMessage).reverse();
}

/**
 * Delete a message
 */
export function deleteMessage(id: string): void {
  const db = getDatabase();
  
  const msg = getMessage(id);
  if (!msg) return;

  db.prepare('DELETE FROM messages WHERE id = ?').run(id);

  // Update session count
  const countRow = db.prepare(
    'SELECT COUNT(*) as count FROM messages WHERE session_id = ?'
  ).get(msg.sessionId) as { count: number };
  
  updateMessageCount(msg.sessionId, countRow.count);
}

// Helper types
interface MessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  metadata: string | null;
  created_at: number;
}

function rowToMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  };
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
