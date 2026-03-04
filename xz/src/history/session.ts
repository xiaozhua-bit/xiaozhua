/**
 * Session management for chat history
 */

import { getDatabase } from './database.js';

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  title?: string;
  messageCount: number;
}

export interface CreateSessionInput {
  id?: string;
  title?: string;
}

export interface ListSessionsOptions {
  limit?: number;
  offset?: number;
}

export interface PaginatedSessions {
  sessions: Session[];
  total: number;
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Create a new session
 */
export function createSession(input: CreateSessionInput = {}): Session {
  const db = getDatabase();
  
  const session: Session = {
    id: input.id || generateSessionId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: input.title,
    messageCount: 0,
  };

  const stmt = db.prepare(`
    INSERT INTO sessions (id, created_at, updated_at, title, message_count)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    session.id,
    session.createdAt,
    session.updatedAt,
    session.title || null,
    session.messageCount
  );

  return session;
}

/**
 * Get a session by ID
 */
export function getSession(id: string): Session | null {
  const db = getDatabase();
  
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
  
  if (!row) return null;
  
  return rowToSession(row);
}

/**
 * List sessions with pagination
 */
export function listSessions(options: ListSessionsOptions = {}): PaginatedSessions {
  const db = getDatabase();
  const limit = options.limit || 10;
  const offset = options.offset || 0;

  // Get total count
  const countRow = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
  const total = countRow.count;

  // Get sessions
  const rows = db.prepare(`
    SELECT * FROM sessions
    ORDER BY updated_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as SessionRow[];

  const page = Math.floor(offset / limit) + 1;

  // Enrich sessions with titles if missing
  const sessions = rows.map(row => {
    const session = rowToSession(row);
    if (!session.title) {
      // Try to get first user message as title
      const firstMessage = db.prepare(`
        SELECT content FROM messages 
        WHERE session_id = ? AND role = 'user' 
        ORDER BY created_at ASC 
        LIMIT 1
      `).get(session.id) as { content: string } | undefined;
      
      if (firstMessage) {
        // Use first 30 chars of first user message
        session.title = firstMessage.content.slice(0, 30) + (firstMessage.content.length > 30 ? '...' : '');
      } else {
        // Fallback to session ID prefix
        session.title = `会话 ${session.id.slice(-8)}`;
      }
    }
    return session;
  });

  return {
    sessions,
    total,
    page,
    perPage: limit,
    hasNext: offset + limit < total,
    hasPrev: offset > 0,
  };
}

/**
 * Update session title
 */
export function updateSessionTitle(id: string, title: string): void {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?
  `).run(title, Date.now(), id);
}

/**
 * Update session message count
 */
export function updateMessageCount(id: string, count: number): void {
  const db = getDatabase();
  
  db.prepare(`
    UPDATE sessions SET message_count = ?, updated_at = ? WHERE id = ?
  `).run(count, Date.now(), id);
}

/**
 * Delete a session (cascades to messages)
 */
export function deleteSession(id: string): void {
  const db = getDatabase();
  
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

/**
 * Get the most recent session
 */
export function getRecentSession(): Session | null {
  const db = getDatabase();
  
  const row = db.prepare(`
    SELECT * FROM sessions
    ORDER BY updated_at DESC
    LIMIT 1
  `).get() as SessionRow | undefined;
  
  return row ? rowToSession(row) : null;
}

// Helper types
interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  title: string | null;
  message_count: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    title: row.title || undefined,
    messageCount: row.message_count,
  };
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
