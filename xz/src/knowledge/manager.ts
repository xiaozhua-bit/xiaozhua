/**
 * Knowledge chunk management
 * Handles CRUD operations for knowledge chunks in SQLite
 */

import { getDatabase } from '../history/database.js';
import type { KnowledgeChunk } from './types.js';

export interface CreateChunkInput {
  file: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  tags?: string[];
}

export interface UpdateChunkInput {
  content?: string;
  tags?: string[];
}

/**
 * Create a new knowledge chunk
 */
export function createChunk(input: CreateChunkInput): KnowledgeChunk {
  const db = getDatabase();
  const now = Date.now();
  
  const chunk: KnowledgeChunk = {
    id: generateChunkId(),
    file: input.file,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    content: input.content,
    tags: input.tags,
    createdAt: now,
    updatedAt: now,
  };

  const stmt = db.prepare(`
    INSERT INTO knowledge_chunks (id, file, line_start, line_end, content, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    chunk.id,
    chunk.file,
    chunk.lineStart,
    chunk.lineEnd,
    chunk.content,
    chunk.tags ? JSON.stringify(chunk.tags) : null,
    chunk.createdAt,
    chunk.updatedAt
  );

  return chunk;
}

/**
 * Get a chunk by ID
 */
export function getChunk(id: string): KnowledgeChunk | null {
  const db = getDatabase();
  
  const row = db.prepare('SELECT * FROM knowledge_chunks WHERE id = ?').get(id) as ChunkRow | undefined;
  
  return row ? rowToChunk(row) : null;
}

/**
 * Get chunks by file
 */
export function getChunksByFile(file: string): KnowledgeChunk[] {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT * FROM knowledge_chunks 
    WHERE file = ?
    ORDER BY line_start ASC
  `).all(file) as ChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Update a chunk
 */
export function updateChunk(id: string, input: UpdateChunkInput): KnowledgeChunk | null {
  const db = getDatabase();
  const existing = getChunk(id);
  
  if (!existing) return null;

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.content !== undefined) {
    updates.push('content = ?');
    params.push(input.content);
  }

  if (input.tags !== undefined) {
    updates.push('tags = ?');
    params.push(JSON.stringify(input.tags));
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  db.prepare(`
    UPDATE knowledge_chunks 
    SET ${updates.join(', ')}
    WHERE id = ?
  `).run(...params);

  return getChunk(id);
}

/**
 * Delete a chunk
 */
export function deleteChunk(id: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(id);
}

/**
 * Delete all chunks for a file
 */
export function deleteChunksByFile(file: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM knowledge_chunks WHERE file = ?').run(file);
}

/**
 * Get content range from a file
 */
export function getContentRange(
  file: string,
  lineStart: number,
  lineEnd: number
): string | null {
  const db = getDatabase();
  
  const rows = db.prepare(`
    SELECT content, line_start, line_end
    FROM knowledge_chunks
    WHERE file = ? AND line_start >= ? AND line_end <= ?
    ORDER BY line_start ASC
  `).all(file, lineStart, lineEnd) as Array<{ content: string; line_start: number; line_end: number }>;

  if (rows.length === 0) return null;

  return rows.map(r => r.content).join('\n');
}

// Helper types
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

function rowToChunk(row: ChunkRow): KnowledgeChunk {
  return {
    id: row.id,
    file: row.file,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    content: row.content,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function generateChunkId(): string {
  return `chunk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
