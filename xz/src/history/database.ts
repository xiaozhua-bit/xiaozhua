/**
 * SQLite database for history, knowledge, and scheduler
 * Single database file: data/agent.db
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Database path (relative to cwd or absolute)
const DATA_DIR = 'data';
const DB_PATH = join(DATA_DIR, 'agent.db');

let db: Database.Database | null = null;

/**
 * Get database connection (singleton)
 */
export function getDatabase(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    
    // Initialize schema
    initSchema(db);
  }
  return db;
}

/**
 * Close database connection
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Initialize database schema
 */
function initSchema(db: Database.Database): void {
  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      title TEXT,
      message_count INTEGER DEFAULT 0
    );
  `);

  // Messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system', 'tool')),
      content TEXT,
      tool_calls TEXT, -- JSON array
      metadata TEXT,   -- JSON object
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);

  // Messages FTS5 index
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      content='messages',
      content_rowid='rowid'
    );
  `);

  // Triggers to keep FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  // Knowledge chunks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      content TEXT NOT NULL,
      tags TEXT,  -- JSON array
      embedding_id TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // Knowledge FTS5 index
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      content,
      content='knowledge_chunks',
      content_rowid='rowid'
    );
  `);

  // Knowledge FTS triggers
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert AFTER INSERT ON knowledge_chunks BEGIN
      INSERT INTO knowledge_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete AFTER DELETE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
    END;
  `);

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_update AFTER UPDATE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      INSERT INTO knowledge_fts(rowid, content) VALUES (new.rowid, new.content);
    END;
  `);

  // Scheduled tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      cron TEXT,
      execute_at INTEGER,
      interval_seconds INTEGER,
      is_recurring BOOLEAN DEFAULT 0,
      is_enabled BOOLEAN DEFAULT 1,
      last_executed_at INTEGER,
      last_execution_status TEXT,
      last_execution_output TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // Task executions log
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      status TEXT,
      output TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
  `);

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_file ON knowledge_chunks(file);
    CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_chunks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_enabled ON scheduled_tasks(is_enabled, execute_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_next ON scheduled_tasks(execute_at) WHERE is_enabled = 1;
  `);
}

/**
 * Reset database (delete and recreate)
 */
export async function resetDatabase(): Promise<void> {
  closeDatabase();
  const { unlinkSync } = await import('fs');
  try {
    unlinkSync(DB_PATH);
  } catch {
    // File may not exist
  }
  db = null;
}
