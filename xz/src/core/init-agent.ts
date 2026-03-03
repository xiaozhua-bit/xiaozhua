/**
 * Initialization Agent
 * Guides user through natural conversation to create SOUL.md and USER.md
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { createLLMClient, type Message, type Tool } from './llm.js';
import { loadConfig } from '../config/index.js';
import { getXZHome, ensureXZHome } from '../config/index.js';

const INIT_SYSTEM_PROMPT = `You are an AI Agent in **INITIALIZATION MODE**.

Your task is to have a natural conversation with the user to understand:
1. What they want to call you (your name)
2. What they want you to call them
3. Their personality, interests, background
4. Their communication preferences
5. Your role/purpose as their AI assistant
6. Any other preferences they have

**GUIDELINES:**
- Start with a warm, friendly greeting
- Ask ONE question at a time naturally
- Don't make it feel like a form - have a real conversation
- Listen carefully to their responses
- Ask follow-up questions to understand them better
- When you have enough information, ask if they're ready to proceed

**IMPORTANT:**
- The user doesn't know you're collecting info for identity files
- Just have a friendly "getting to know each other" chat
- Gather at least: your name, their name, your role, their style preferences

**FINAL STEP:**
When you have gathered sufficient information, you MUST use the \`complete_initialization\` tool to create the identity files. Do this when:
- You know what they want to call you
- You know what to call them
- You understand their general preferences
- You have a sense of your role/purpose

The tool will create SOUL.md (your identity) and USER.md (their profile) based on the conversation.`;

const COMPLETION_TOOL: Tool = {
  name: 'complete_initialization',
  description: 'Complete the initialization by creating SOUL.md and USER.md files',
  parameters: {
    type: 'object',
    properties: {
      agentName: {
        type: 'string',
        description: 'The name the user wants to call the AI agent',
      },
      agentRole: {
        type: 'string',
        description: 'The role/personality of the AI agent based on the conversation',
      },
      userName: {
        type: 'string',
        description: 'What the AI should call the user',
      },
      userProfile: {
        type: 'string',
        description: 'Description of the user: personality, interests, background',
      },
      communicationStyle: {
        type: 'string',
        description: 'How the user prefers to communicate (concise, detailed, casual, professional, technical)',
      },
      preferredLanguage: {
        type: 'string',
        description: 'Primary language preference: zh, en, or auto',
      },
      additionalPreferences: {
        type: 'string',
        description: 'Any other preferences or notes from the conversation',
      },
    },
    required: ['agentName', 'agentRole', 'userName', 'userProfile', 'communicationStyle', 'preferredLanguage'],
  },
};

export interface InitAgentOptions {
  onMessage?: (message: Message) => void;
  onComplete?: () => void;
}

export class InitAgent {
  private llm: ReturnType<typeof createLLMClient>;
  private config: ReturnType<typeof loadConfig>;
  private messages: Message[] = [];
  private onMessage?: (message: Message) => void;
  private onComplete?: () => void;
  private completed = false;

  constructor(options: InitAgentOptions = {}) {
    this.config = loadConfig();
    this.llm = createLLMClient(this.config);
    this.onMessage = options.onMessage;
    this.onComplete = options.onComplete;

    // Start with system prompt
    this.messages.push({ role: 'system', content: INIT_SYSTEM_PROMPT });
  }

  /**
   * Start the initialization conversation
   */
  async start(): Promise<void> {
    // Get initial greeting from AI
    const response = await this.llm.chat(this.messages, { tools: [COMPLETION_TOOL] });

    if (response.content) {
      this.addMessage('assistant', response.content);
    }
  }

  /**
   * Send user message and get response
   */
  async sendMessage(content: string): Promise<void> {
    if (this.completed) return;

    this.addMessage('user', content);

    try {
      const response = await this.llm.chat(this.messages, { tools: [COMPLETION_TOOL] });

      // Check if AI wants to complete initialization
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const toolCall of response.toolCalls) {
          if (toolCall.function.name === 'complete_initialization') {
            const args = JSON.parse(toolCall.function.arguments);
            await this.completeInitialization(args);
            return;
          }
        }
      }

      if (response.content) {
        this.addMessage('assistant', response.content);
      }
    } catch (error) {
      this.addMessage('system', `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check if initialization is complete
   */
  isCompleted(): boolean {
    return this.completed;
  }

  /**
   * Complete initialization by creating identity files
   */
  private async completeInitialization(args: {
    agentName: string;
    agentRole: string;
    userName: string;
    userProfile: string;
    communicationStyle: string;
    preferredLanguage: string;
    additionalPreferences?: string;
  }): Promise<void> {
    try {
      const home = ensureXZHome();

      // Generate SOUL.md
      const soulContent = this.generateSOUL({
        name: args.agentName,
        role: args.agentRole,
        style: args.communicationStyle,
        language: args.preferredLanguage,
      });

      // Generate USER.md
      const userContent = this.generateUSER({
        name: args.userName,
        profile: args.userProfile,
        style: args.communicationStyle,
        language: args.preferredLanguage,
        additional: args.additionalPreferences,
      });

      // Generate MEMORY.md
      const memoryContent = this.generateMEMORY();

      // Write files
      writeFileSync(join(home, 'SOUL.md'), soulContent, 'utf-8');
      writeFileSync(join(home, 'USER.md'), userContent, 'utf-8');
      writeFileSync(join(home, 'MEMORY.md'), memoryContent, 'utf-8');

      this.completed = true;

      // Notify completion
      this.addMessage('system', `✓ Identity files created in ${home}`);
      this.addMessage('assistant', `Great! I've created my identity files. I'm **${args.agentName}**, and I'll remember to call you **${args.userName}**. Let's get started!`);

      this.onComplete?.();
    } catch (error) {
      this.addMessage('system', `Failed to create identity files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private addMessage(role: Message['role'], content: string): void {
    this.messages.push({ role, content });
    this.onMessage?.({ role, content });
  }

  private generateSOUL(params: {
    name: string;
    role: string;
    style: string;
    language: string;
  }): string {
    const styleDescriptions: Record<string, string> = {
      concise: 'clear and concise',
      detailed: 'thorough and detailed',
      casual: 'casual and friendly',
      professional: 'professional and formal',
      technical: 'precise and technical',
    };

    const languageNames: Record<string, string> = {
      zh: 'Chinese (中文)',
      en: 'English',
      auto: "the user's input language",
    };

    return `# SOUL.md

## Identity

You are **${params.name}**, ${params.role}.

## Core Values

- Be helpful, harmless, and honest
- Respect user privacy and preferences
- Learn and adapt from interactions
- Maintain consistency with your defined personality

## Communication Style

- **Style**: ${styleDescriptions[params.style] || params.style}
- **Language**: Primary language is ${languageNames[params.language] || params.language}
- **Tone**: Adapt to match the user's communication style while maintaining your core identity

## Guidelines

- Always address the user by their preferred name
- Remember their preferences and adapt accordingly
- Be proactive in understanding context
- When uncertain, ask clarifying questions
`;
  }

  private generateUSER(params: {
    name: string;
    profile: string;
    style: string;
    language: string;
    additional?: string;
  }): string {
    const styleDescriptions: Record<string, string> = {
      concise: 'Prefers short, direct responses',
      detailed: 'Appreciates thorough explanations',
      casual: 'Enjoys relaxed, conversational tone',
      professional: 'Expects formal, business-like communication',
      technical: 'Values precise, technical language',
    };

    const languagePrefs: Record<string, string> = {
      zh: 'Primary communication in Chinese (中文)',
      en: 'Primary communication in English',
      auto: 'Adapt to the language of the conversation',
    };

    return `# USER.md

## Profile

**Name**: ${params.name}

## About

${params.profile}

## Communication Preferences

- **Style**: ${styleDescriptions[params.style] || params.style}
- **Language**: ${languagePrefs[params.language] || params.language}
${params.additional ? `\n## Additional Preferences\n\n${params.additional}` : ''}

## Interaction Notes

- Agent should address user as "${params.name}"
- Adapt responses based on the communication style preferences above
- Remember and reference relevant personal details when appropriate

## History

*This section will be updated with important information learned about the user over time.*
`;
  }

  private generateMEMORY(): string {
    return `# MEMORY.md

## Key Facts

Important information, decisions, and observations will be stored here.

## Daily Logs

- Daily notes are stored in separate files (see memory/ directory)
- Each day has its own markdown file for detailed logs

## How to Use

- Add important facts as bullet points under relevant sections
- Use headings to organize information
- Keep entries concise but informative
- Update or remove outdated information
`;
  }
}

/**
 * Create initialization agent instance
 */
export function createInitAgent(options?: InitAgentOptions): InitAgent {
  return new InitAgent(options);
}
