/**
 * History search using FTS5 (BM25)
 */

import { getDatabase } from './database.js';
import type { Message, MessageRole } from './messages.js';

export interface HistorySearchOptions {
  limit?: number;
  offset?: number;
  dateFrom?: string;
  dateTo?: string;
  sessionId?: string;
  role?: MessageRole;
}

export interface HistorySearchResult {
  messageId: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  sessionTitle?: string;
  rank: number;
}

export interface PaginatedSearchResults {
  results: HistorySearchResult[];
  total: number;
  page: number;
  perPage: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/**
 * Search history using FTS5 BM25 ranking
 */
export function searchHistory(
  query: string,
  options: HistorySearchOptions = {}
): PaginatedSearchResults {
  const db = getDatabase();
  const limit = options.limit || 10;
  const offset = options.offset || 0;

  // Build the search query with filters
  let sql = `
    SELECT 
      m.id as message_id,
      m.session_id,
      m.role,
      m.content,
      m.created_at,
      s.title as session_title,
      rank
    FROM messages_fts fts
    JOIN messages m ON m.rowid = fts.rowid
    JOIN sessions s ON s.id = m.session_id
    WHERE messages_fts MATCH ?
  `;
  
  const params: (string | number)[] = [query];

  // Add filters
  if (options.sessionId) {
    sql += ' AND m.session_id = ?';
    params.push(options.sessionId);
  }

  if (options.role) {
    sql += ' AND m.role = ?';
    params.push(options.role);
  }

  if (options.dateFrom) {
    sql += ' AND m.created_at >= ?';
    params.push(new Date(options.dateFrom).getTime());
  }

  if (options.dateTo) {
    sql += ' AND m.created_at <= ?';
    params.push(new Date(options.dateTo).getTime());
  }

  // Get total count (subquery for count)
  const countSql = `SELECT COUNT(*) as count FROM (${sql})`;
  const countRow = db.prepare(countSql).get(...params) as { count: number };
  const total = countRow.count;

  // Add ordering and pagination
  sql += ' ORDER BY rank LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as SearchRow[];

  const page = Math.floor(offset / limit) + 1;

  return {
    results: rows.map(row => ({
      messageId: row.message_id,
      sessionId: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      timestamp: row.created_at,
      sessionTitle: row.session_title || undefined,
      rank: row.rank,
    })),
    total,
    page,
    perPage: limit,
    hasNext: offset + limit < total,
    hasPrev: offset > 0,
  };
}

/**
 * Search within a specific session
 */
export function searchSessionHistory(
  sessionId: string,
  query: string,
  options: Omit<HistorySearchOptions, 'sessionId'> = {}
): PaginatedSearchResults {
  return searchHistory(query, { ...options, sessionId });
}

/**
 * Get messages from date range
 */
export function getMessagesByDateRange(
  from: Date,
  to: Date,
  options: { limit?: number; offset?: number } = {}
): Message[] {
  const db = getDatabase();
  const limit = options.limit || 100;
  const offset = options.offset || 0;

  const rows = db.prepare(`
    SELECT 
      m.id,
      m.session_id,
      m.role,
      m.content,
      m.tool_calls,
      m.metadata,
      m.created_at
    FROM messages m
    WHERE m.created_at >= ? AND m.created_at <= ?
    ORDER BY m.created_at ASC
    LIMIT ? OFFSET ?
  `).all(from.getTime(), to.getTime(), limit, offset) as RawMessageRow[];

  return rows.map(row => ({
    id: row.id,
    sessionId: row.session_id,
    role: row.role as MessageRole,
    content: row.content,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
  }));
}

// Helper types
interface SearchRow {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
  session_title: string | null;
  rank: number;
}

interface RawMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  metadata: string | null;
  created_at: number;
}
