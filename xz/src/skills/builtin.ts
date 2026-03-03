/**
 * Built-in skills that wrap xz CLI commands
 * These are registered automatically
 */

import type { Skill } from './types.js';

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'memory-search',
    description: 'Search knowledge memory for facts, decisions, or observations',
    argumentHint: '<query> [--page N]',
    disableModelInvocation: false,
    source: 'builtin',
    priority: 1000,
    content: `
Search the knowledge base when you need to recall information not in the pre-loaded MEMORY.md.

**Usage from agent:**
\`\`\`bash
xz memory search "<query>" --limit 5
\`\`\`

**When to use:**
- User asks about something from past conversations
- Need specific details not in current context
- Looking for user preferences or decisions

**Handling results:**
- Results include file path, line numbers, and snippet
- Use \`xz memory get <file> --start-line N --end-line N\` to read full content
- Ask user if they want to see more results (--page 2, etc.)
`,
  },
  {
    name: 'history-search',
    description: 'Search chat history for past conversations',
    argumentHint: '<query> [--page N] [--date-from YYYY-MM-DD]',
    disableModelInvocation: false,
    source: 'builtin',
    priority: 1000,
    content: `
Search past chat sessions when user references earlier discussions.

**Usage from agent:**
\`\`\`bash
xz history search "<query>" --limit 5
\`\`\`

**When to use:**
- User says "like we discussed yesterday"
- Need context from earlier sessions
- Looking for specific decisions or code from past chats

**Handling pagination:**
- Default shows 10 results per page
- If user wants more, use \`--page 2\`, etc.
- To see full session: \`xz history session <session-id> --limit 20\`
`,
  },
  {
    name: 'get-session',
    description: 'Get full message history of a specific chat session',
    argumentHint: '<session-id> [--offset N]',
    disableModelInvocation: true,
    source: 'builtin',
    priority: 1000,
    content: `
Retrieve a complete session. Use when the user asks to see what was discussed.

**Usage:**
\`\`\`bash
xz history session <session-id> --limit 20 --offset 0
\`\`\`

**Pagination:**
- Use --offset to paginate through long sessions
- Increase offset by limit for next page
`,
  },
];

/**
 * Register built-in skills to a registry
 */
export function registerBuiltinSkills(registry: { register: (skill: Skill) => void }): void {
  for (const skill of BUILTIN_SKILLS) {
    registry.register(skill);
  }
}
