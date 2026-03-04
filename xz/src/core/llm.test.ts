import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMClient } from './llm.js';
import type { XZConfig } from '../config/types.js';

const TEST_CONFIG: XZConfig = {
  model: {
    provider: 'openai',
    model: 'gpt-4o',
    baseUrl: 'https://example.com/v1',
  },
  auth: {
    type: 'api_key',
    apiKey: 'test-api-key',
  },
  context: {
    maxTokens: 4096,
    preloadIdentity: true,
    preloadMemory: true,
  },
  scheduler: {
    enabled: false,
    checkIntervalMs: 1000,
  },
  memory: {
    hybridSearch: true,
    semanticWeight: 0.7,
    keywordWeight: 0.3,
  },
  heartbeat: {
    enabled: false,
    intervalMs: 1000,
    autoExecuteTasks: false,
    maxConsecutiveRuns: 1,
    idleThresholdMs: 1000,
    checkPendingTasks: false,
    proactiveMode: false,
  },
  setup: {
    completed: true,
  },
};

const USER_MESSAGE = [{ role: 'user', content: 'hello' }] as const;

function buildSuccessResponse(content = 'ok'): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('LLMClient connection retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('retries connection errors up to 5 times and then succeeds', async () => {
    const client = new LLMClient(TEST_CONFIG);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    let attempts = 0;

    fetchMock.mockImplementation(async () => {
      attempts += 1;
      if (attempts <= 5) {
        throw new TypeError('fetch failed', {
          cause: { code: 'ECONNRESET' },
        } as ErrorOptions);
      }
      return buildSuccessResponse('retried');
    });

    const resultPromise = client.chat([...USER_MESSAGE]);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.content).toBe('retried');
    expect(attempts).toBe(6);
  });

  it('throws after exhausting retries for connection errors', async () => {
    const client = new LLMClient(TEST_CONFIG);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    let attempts = 0;

    fetchMock.mockImplementation(async () => {
      attempts += 1;
      throw new TypeError('connection error');
    });

    const resultPromise = client.chat([...USER_MESSAGE]);
    const assertion = expect(resultPromise).rejects.toThrow('connection error');
    await vi.runAllTimersAsync();

    await assertion;
    expect(attempts).toBe(6);
  });
});
