/**
 * Identity document loader
 * Loads SOUL.md (agent identity) and USER.md (user identity)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const AGENTS_DIR = '.agents';
const SOUL_FILE = 'SOUL.md';
const USER_FILE = 'USER.md';
const MEMORY_FILE = 'MEMORY.md';

export interface IdentityDocs {
  soul: string | null;
  user: string | null;
  memory: string | null;
}

/**
 * Load identity documents
 */
export function loadIdentityDocs(): IdentityDocs {
  return {
    soul: loadDoc(join(AGENTS_DIR, SOUL_FILE)),
    user: loadDoc(join(AGENTS_DIR, USER_FILE)),
    memory: loadDoc(join(AGENTS_DIR, MEMORY_FILE)),
  };
}

/**
 * Load a single document
 */
function loadDoc(path: string): string | null {
  if (!existsSync(path)) {
    return null;
  }
  
  try {
    return readFileSync(path, 'utf-8');
  } catch (error) {
    console.warn(`Failed to load ${path}:`, error);
    return null;
  }
}

/**
 * Check if identity documents exist
 */
export function hasIdentityDocs(): boolean {
  return existsSync(join(AGENTS_DIR, SOUL_FILE)) ||
         existsSync(join(AGENTS_DIR, USER_FILE)) ||
         existsSync(join(AGENTS_DIR, MEMORY_FILE));
}

/**
 * Get default SOUL.md content for new users
 */
export function getDefaultSoul(): string {
  return `# SOUL.md

## Identity

You are xz, an AI agent with persistent memory and identity.

## Core Values

- Be helpful, harmless, and honest
- Respect user privacy
- Learn from interactions

## Communication Style

- Clear and concise
- Technical when appropriate
- Friendly but professional
`;
}

/**
 * Get default USER.md content for new users
 */
export function getDefaultUser(): string {
  return `# USER.md

## User Profile

Preferences and information about the user will be stored here.

## Notes

- Add user preferences as you learn them
- Track important context about the user
`;
}

/**
 * Get default MEMORY.md content for new users
 */
export function getDefaultMemory(): string {
  return `# MEMORY.md

## Key Facts

Important information, decisions, and observations will be stored here.

## Daily Logs

- See memory/YYYY-MM-DD.md for daily notes
`;
}
