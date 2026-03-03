/**
 * Knowledge search using FTS5 (BM25)
 * Future: add vector search for semantic similarity
 */

import { getDatabase } from '../history/database.js';
import type { KnowledgeChunk, SearchResult, PaginatedSearchResult, SearchOptions } from './types.js';

/**
 * Search knowledge using FTS5 BM25 ranking
 * Simple keyword-based search (semantic search TBD)
 */
export function searchKnowledge(
  query: string,
  options: SearchOptions = {}
): PaginatedSearchResult {
  const db = getDatabase();
  const limit = options.limit || 10;
  const offset = options.offset || 0;

  // Use FTS5 for keyword search
  let sql = `
    SELECT 
      k.id,
      k.file,
      k.line_start,
      k.line_end,
      k.content,
      k.tags,
      k.created_at,
      k.updated_at,
      rank
    FROM knowledge_fts fts
    JOIN knowledge_chunks k ON k.rowid = fts.rowid
    WHERE knowledge_fts MATCH ?
  `;
  
  const params: (string | number)[] = [query];

  // Get total count
  const countSql = `SELECT COUNT(*) as count FROM (${sql})`;
  const countRow = db.prepare(countSql).get(...params) as { count: number };
  const total = countRow.count;

  // Add ordering and pagination
  sql += ' ORDER BY rank LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as SearchRow[];

  const page = Math.floor(offset / limit) + 1;

  const items: SearchResult[] = rows.map(row => ({
    chunk: {
      id: row.id,
      file: row.file,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      content: row.content,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    score: 1 / (1 + Math.abs(row.rank)), // Convert rank to score (0-1)
    matchType: 'keyword',
  }));

  return {
    items,
    total,
    page,
    perPage: limit,
    hasNext: offset + limit < total,
    hasPrev: offset > 0,
  };
}

/**
 * Get content from a specific file range
 */
export function getFileContent(
  file: string,
  options: { startLine?: number; endLine?: number } = {}
): string | null {
  const db = getDatabase();
  
  let sql = 'SELECT content, line_start, line_end FROM knowledge_chunks WHERE file = ?';
  const params: (string | number)[] = [file];

  if (options.startLine !== undefined) {
    sql += ' AND line_end >= ?';
    params.push(options.startLine);
  }

  if (options.endLine !== undefined) {
    sql += ' AND line_start <= ?';
    params.push(options.endLine);
  }

  sql += ' ORDER BY line_start ASC';

  const rows = db.prepare(sql).all(...params) as Array<{
    content: string;
    line_start: number;
    line_end: number;
  }>;

  if (rows.length === 0) return null;

  // Filter by exact line range if specified
  let content = rows.map(r => r.content).join('\n');

  if (options.startLine !== undefined || options.endLine !== undefined) {
    const lines = content.split('\n');
    const startIdx = options.startLine ? options.startLine - rows[0].line_start : 0;
    const endIdx = options.endLine 
      ? options.endLine - rows[0].line_start + 1 
      : lines.length;
    
    content = lines.slice(Math.max(0, startIdx), endIdx).join('\n');
  }

  return content;
}

/**
 * List all files in knowledge base
 */
export function listFiles(): string[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT DISTINCT file FROM knowledge_chunks ORDER BY file ASC
  `).all() as Array<{ file: string }>;

  return rows.map(r => r.file);
}

/**
 * Get recent knowledge chunks
 */
export function getRecentChunks(limit: number = 10): KnowledgeChunk[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT * FROM knowledge_chunks
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit) as ChunkRow[];

  return rows.map(row => ({
    id: row.id,
    file: row.file,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    content: row.content,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

// Helper types
interface SearchRow {
  id: string;
  file: string;
  line_start: number;
  line_end: number;
  content: string;
  tags: string | null;
  created_at: number;
  updated_at: number;
  rank: number;
}

interface ChunkRow {
  id: string;
  file: string;
  line_start: number;
  line_end: number;
  content: string;
  tags: string | null;
  created_at: number;
  updated_at: number;
}
