/**
 * First-run setup wizard for xz AI Agent
 * Beautiful interactive configuration using @clack/prompts
 */

import * as p from '@clack/prompts';
import color from 'picocolors';
import { XZConfig, Provider, ProviderOption } from './types.js';
import { saveConfig, detectAvailableProviders, createConfigFromProvider } from './index.js';

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
 * Small delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
