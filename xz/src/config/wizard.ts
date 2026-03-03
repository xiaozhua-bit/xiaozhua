/**
 * First-run setup wizard for xz AI Agent
 * Beautiful interactive configuration using @clack/prompts
 */

import * as p from '@clack/prompts';
import color from 'picocolors';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { XZConfig, Provider, ProviderOption } from './types.js';
import { saveConfig, detectAvailableProviders, createConfigFromProvider, ensureXZHome } from './index.js';

const PROVIDER_ICONS: Record<string, string> = {
  kimi: '🌙',
  openai: '🤖',
  anthropic: '🧠',
  custom: '⚙️',
};

/**
 * Run the interactive setup wizard
 */
export async function runSetupWizard(): Promise<void> {
  console.clear();
  
  // Header
  p.intro(`${color.cyan('🤖 xz')} - ${color.dim('AI Agent with Memory')}`);
  
  // Detect available providers
  const providers = detectAvailableProviders();
  
  // Provider selection with nice UI
  const providerOptions = providers.map((p, i) => ({
    value: i,
    label: `${PROVIDER_ICONS[p.id] || '•'} ${p.name}`,
    hint: p.detected ? color.green('✓ detected') : p.description,
  }));

  const selected = await p.select({
    message: 'Select your LLM provider',
    options: providerOptions,
    initialValue: providers.findIndex(p => p.detected) ?? 0,
  });

  if (p.isCancel(selected)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  const selectedProvider = providers[selected as number];
  
  // Configure based on provider
  const config = await configureProviderWithClack(selectedProvider);
  
  // Mark setup complete
  config.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  };

  // Save with spinner
  const s = p.spinner();
  s.start('Saving configuration...');
  
  try {
    saveConfig(config);
    await delay(500); // Small delay for UX
    s.stop('Configuration saved!');
    
    // Show summary
    p.note(
      `${color.dim('Provider:')} ${color.cyan(config.model.provider)}\n` +
      `${color.dim('Model:')} ${color.cyan(config.model.model)}\n` +
      `${color.dim('Config:')} ${color.dim('~/.xz/config.toml')}`,
      'Setup Complete'
    );
    
    const shouldStart = await p.confirm({
      message: 'Start xz now?',
      initialValue: true,
    });
    
    if (p.isCancel(shouldStart) || !shouldStart) {
      p.outro('Run `xz` anytime to start. Goodbye! 👋');
      process.exit(0);
    }
    
  } catch (error) {
    s.stop('Failed to save configuration');
    p.cancel(error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

/**
 * Configure provider with beautiful prompts
 */
async function configureProviderWithClack(provider: ProviderOption): Promise<XZConfig> {
  const options: { apiKey?: string; customModel?: string; customBaseUrl?: string } = {};

  p.log.step(`Configuring ${provider.name}`);

  switch (provider.id) {
    case 'kimi': {
      p.log.info('Using Kimi Code OAuth authentication');
      p.log.info(color.dim('Credentials: ~/.kimi/credentials/kimi-code.json'));
      
      // Verify credentials exist
      const { detectKimiCredentials } = await import('./kimi.js');
      if (!detectKimiCredentials()) {
        const proceed = await p.confirm({
          message: 'Kimi credentials not found. Run `kimi login` first. Continue anyway?',
          initialValue: false,
        });
        if (p.isCancel(proceed) || !proceed) {
          p.cancel('Please run `kimi login` and try again');
          process.exit(0);
        }
      }
      break;
    }

    case 'openai': {
      if (!process.env.OPENAI_API_KEY) {
        const key = await p.password({
          message: 'Enter your OpenAI API Key',
          validate: (value) => {
            if (!value || value.length < 10) return 'Please enter a valid API key';
            if (!value.startsWith('sk-')) return 'API key should start with sk-';
          },
        });
        if (p.isCancel(key)) {
          p.cancel('Setup cancelled');
          process.exit(0);
        }
        options.apiKey = key;
      } else {
        p.log.success('Using OPENAI_API_KEY from environment');
      }

      const model = await p.select({
        message: 'Select model',
        options: [
          { value: 'gpt-4o', label: 'GPT-4o', hint: 'Best quality' },
          { value: 'gpt-4o-mini', label: 'GPT-4o Mini', hint: 'Faster & cheaper' },
          { value: 'gpt-4-turbo', label: 'GPT-4 Turbo', hint: 'Legacy' },
        ],
        initialValue: 'gpt-4o',
      });
      
      if (p.isCancel(model)) {
        p.cancel('Setup cancelled');
        process.exit(0);
      }
      options.customModel = model as string;
      break;
    }

    case 'anthropic': {
      if (!process.env.ANTHROPIC_API_KEY) {
        const key = await p.password({
          message: 'Enter your Anthropic API Key',
          validate: (value) => {
            if (!value || value.length < 10) return 'Please enter a valid API key';
          },
        });
        if (p.isCancel(key)) {
          p.cancel('Setup cancelled');
          process.exit(0);
        }
        options.apiKey = key;
      } else {
        p.log.success('Using ANTHROPIC_API_KEY from environment');
      }

      const model = await p.select({
        message: 'Select model',
        options: [
          { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus', hint: 'Most capable' },
          { value: 'claude-3-sonnet-20240229', label: 'Claude 3 Sonnet', hint: 'Balanced' },
          { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku', hint: 'Fastest' },
        ],
        initialValue: 'claude-3-sonnet-20240229',
      });
      
      if (p.isCancel(model)) {
        p.cancel('Setup cancelled');
        process.exit(0);
      }
      options.customModel = model as string;
      break;
    }

    case 'custom': {
      p.log.info('Custom OpenAI-compatible provider');
      
      const baseUrl = await p.text({
        message: 'API Base URL',
        placeholder: 'https://api.example.com/v1',
        validate: (value) => {
          if (!value) return 'Please enter a base URL';
          try { new URL(value); } catch { return 'Please enter a valid URL'; }
        },
      });
      if (p.isCancel(baseUrl)) {
        p.cancel('Setup cancelled');
        process.exit(0);
      }
      options.customBaseUrl = baseUrl as string;

      const model = await p.text({
        message: 'Model name',
        placeholder: 'llama-3-70b',
        validate: (value) => {
          if (!value) return 'Please enter a model name';
        },
      });
      if (p.isCancel(model)) {
        p.cancel('Setup cancelled');
        process.exit(0);
      }
      options.customModel = model as string;

      const key = await p.password({
        message: 'API Key (optional)',
      });
      if (!p.isCancel(key) && key) {
        options.apiKey = key;
      }
      break;
    }
  }

  // Optional: Configure heartbeat
  const enableHeartbeat = await p.confirm({
    message: 'Enable autonomous heartbeat? (agent wakes up periodically)',
    initialValue: false,
  });

  const config = createConfigFromProvider(provider.id, options);
  
  if (!p.isCancel(enableHeartbeat)) {
    config.heartbeat.enabled = enableHeartbeat;
    
    if (enableHeartbeat) {
      const interval = await p.select({
        message: 'Heartbeat interval',
        options: [
          { value: 10 * 60 * 1000, label: '10 minutes' },
          { value: 30 * 60 * 1000, label: '30 minutes', hint: 'recommended' },
          { value: 60 * 60 * 1000, label: '1 hour' },
        ],
        initialValue: 30 * 60 * 1000,
      });
      if (!p.isCancel(interval)) {
        config.heartbeat.intervalMs = interval as number;
      }
    }
  }

  return config;
}

/**
 * Quick setup for specific provider (non-interactive)
 */
export async function quickSetup(provider: Provider, apiKey?: string): Promise<void> {
  const s = p.spinner();
  s.start(`Configuring ${provider}...`);
  
  const config = createConfigFromProvider(provider, { apiKey });
  config.setup = {
    completed: true,
    completedAt: new Date().toISOString(),
  };
  saveConfig(config);
  
  await delay(300);
  s.stop(`Configured ${provider}`);
}

/**
 * Run the identity setup wizard
 * Guides user to create SOUL.md and USER.md
 */
export async function runIdentityWizard(): Promise<void> {
  p.log.step(color.cyan('Let\'s personalize your AI Agent'));
  p.log.message(color.dim('This will create your agent\'s identity and profile.\n'));

  // 1. Agent name
  const agentName = await p.text({
    message: 'What would you like to name your AI agent?',
    placeholder: 'e.g., Claude, Kimi, Assistant',
    validate: (value) => {
      if (!value || value.trim().length === 0) return 'Please enter a name';
      if (value.trim().length > 30) return 'Name should be 30 characters or less';
    },
  });

  if (p.isCancel(agentName)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // 2. How to address user
  const userName = await p.text({
    message: 'What should I call you?',
    placeholder: 'e.g., your name or nickname',
    validate: (value) => {
      if (!value || value.trim().length === 0) return 'Please enter how you\'d like to be called';
    },
  });

  if (p.isCancel(userName)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // 3. User personality & preferences
  const userTraits = await p.text({
    message: 'Tell me about yourself (personality, interests, background)',
    placeholder: 'e.g., software engineer who loves hiking, detail-oriented, prefers concise answers',
  });

  if (p.isCancel(userTraits)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // 4. Communication style
  const communicationStyle = await p.select({
    message: 'How do you prefer to communicate?',
    options: [
      { value: 'concise', label: 'Concise & Direct', hint: 'Short, to-the-point responses' },
      { value: 'detailed', label: 'Detailed & Thorough', hint: 'Comprehensive explanations' },
      { value: 'casual', label: 'Casual & Friendly', hint: 'Relaxed, conversational tone' },
      { value: 'professional', label: 'Professional', hint: 'Formal, business-like tone' },
      { value: 'technical', label: 'Technical', hint: 'Precise, technical language' },
    ],
    initialValue: 'concise',
  });

  if (p.isCancel(communicationStyle)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // 5. Preferred language
  const preferredLanguage = await p.select({
    message: 'What language should we primarily use?',
    options: [
      { value: 'zh', label: '中文 (Chinese)', hint: '简体中文或繁體中文' },
      { value: 'en', label: 'English', hint: 'Primary language' },
      { value: 'auto', label: 'Auto-detect', hint: 'Match your input language' },
    ],
    initialValue: 'auto',
  });

  if (p.isCancel(preferredLanguage)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // 6. Agent role/personality suggestions
  const agentRole = await p.text({
    message: `What role should ${agentName} play?`,
    placeholder: 'e.g., helpful coding assistant, creative writing partner, thoughtful advisor',
  });

  if (p.isCancel(agentRole)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // 7. Additional preferences
  const additionalPrefs = await p.text({
    message: 'Any other preferences or things I should know? (optional)',
    placeholder: 'e.g., prefer code examples in TypeScript, dislike verbose greetings',
  });

  if (p.isCancel(additionalPrefs)) {
    p.cancel('Setup cancelled');
    process.exit(0);
  }

  // Generate files
  const s = p.spinner();
  s.start('Creating your personalized agent...');

  try {
    const home = ensureXZHome();

    // Generate SOUL.md
    const soulContent = generateSOUL({
      name: agentName as string,
      role: agentRole as string,
      style: communicationStyle as string,
      language: preferredLanguage as string,
    });

    // Generate USER.md
    const userContent = generateUSER({
      name: userName as string,
      traits: userTraits as string,
      style: communicationStyle as string,
      language: preferredLanguage as string,
      additional: additionalPrefs as string | undefined,
    });

    // Generate MEMORY.md
    const memoryContent = generateMEMORY();

    // Write files
    writeFileSync(join(home, 'SOUL.md'), soulContent, 'utf-8');
    writeFileSync(join(home, 'USER.md'), userContent, 'utf-8');
    writeFileSync(join(home, 'MEMORY.md'), memoryContent, 'utf-8');

    await delay(500);
    s.stop('Identity created!');

    p.note(
      `${color.dim('Agent:')} ${color.cyan(agentName as string)}\n` +
      `${color.dim('User:')} ${color.cyan(userName as string)}\n` +
      `${color.dim('Style:')} ${color.dim(communicationStyle as string)}\n` +
      `${color.dim('Language:')} ${color.dim(preferredLanguage as string)}`,
      'Profile Summary'
    );

    p.log.message(color.dim(`\nFiles created in ${home}:`));
    p.log.message(color.dim('  • SOUL.md - Agent identity'));
    p.log.message(color.dim('  • USER.md - Your profile'));
    p.log.message(color.dim('  • MEMORY.md - Knowledge base\n'));

  } catch (error) {
    s.stop('Failed to create identity files');
    p.cancel(error instanceof Error ? error.message : 'Unknown error');
    throw error;
  }
}

interface SOULParams {
  name: string;
  role: string;
  style: string;
  language: string;
}

interface USERParams {
  name: string;
  traits: string;
  style: string;
  language: string;
  additional?: string;
}

function generateSOUL(params: SOULParams): string {
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
    auto: 'the user\'s input language',
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

## Notes

- This identity was co-created with the user during initial setup
- Update this file as the relationship evolves
- The USER.md file contains important information about the user
`;
}

function generateUSER(params: USERParams): string {
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

${params.traits}

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

function generateMEMORY(): string {
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

## Example Sections

### Projects
- Current projects and their status

### Preferences
- Specific tools, technologies, or approaches the user prefers

### Important Dates
- Deadlines, milestones, or significant events

### Learnings
- Insights gained from past interactions
`;
}

/**
 * Small delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
