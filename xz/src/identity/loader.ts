/**
 * Identity document loader
 * Loads SOUL.md (agent identity) and USER.md (user identity)
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { getXZHome, ensureXZHome } from '../config/index.js';

const SOUL_FILE = 'SOUL.md';
const USER_FILE = 'USER.md';
const MEMORY_FILE = 'MEMORY.md';

/**
 * Get the identity documents directory
 */
function getIdentityDir(): string {
  return ensureXZHome();
}

export interface IdentityDocs {
  soul: string | null;
  user: string | null;
  memory: string | null;
}

/**
 * Load identity documents
 */
export function loadIdentityDocs(): IdentityDocs {
  const dir = getIdentityDir();
  return {
    soul: loadDoc(join(dir, SOUL_FILE)),
    user: loadDoc(join(dir, USER_FILE)),
    memory: loadDoc(join(dir, MEMORY_FILE)),
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
  const dir = getXZHome();
  return existsSync(join(dir, SOUL_FILE)) ||
         existsSync(join(dir, USER_FILE)) ||
         existsSync(join(dir, MEMORY_FILE));
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
