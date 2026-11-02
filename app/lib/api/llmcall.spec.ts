import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LLMManager } from '~/lib/modules/llm/manager';
import { resetRateLimitState } from '~/lib/security';

const generateTextMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();

  return {
    ...actual,
    generateText: generateTextMock,
  };
});

const { action } = await import('~/routes/api.llmcall');

const modelResult = {
  text: '<selection>\n  <templateName>blank</templateName>\n  <title>Demo</title>\n</selection>',
  finishReason: 'stop',
  usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
};

const modelDetails = {
  name: 'claude-3-5-sonnet-20241022',
  label: 'Claude 3.5 Sonnet',
  provider: 'Anthropic',
  maxTokenAllowed: 200000,
  maxCompletionTokens: 4096,
};

function post(body: unknown, ip = '203.0.113.77') {
  return action({
    request: new Request('http://example.test/api/llmcall', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'cf-connecting-ip': ip,
      },
      body: JSON.stringify(body),
    }),
    params: {},
    context: { cloudflare: { env: {} } },
  } as any) as Promise<Response>;
}

const validBody = {
  system: 'select a template',
  message: 'build a todo app',
  model: modelDetails.name,
  provider: { name: 'Anthropic' },
  streamOutput: false,
};

describe('POST /api/llmcall', () => {
  beforeEach(() => {
    resetRateLimitState();
    generateTextMock.mockReset();
    generateTextMock.mockResolvedValue(modelResult);
    vi.spyOn(LLMManager.prototype, 'updateModelList').mockResolvedValue([modelDetails]);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetRateLimitState();
  });

  it('returns the model result unchanged while the request is under the 10/minute limit', async () => {
    const response = await post(validBody);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(body).toEqual(modelResult);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing 400 response when the model is missing', async () => {
    const response = await post({ ...validBody, model: undefined });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('Invalid or missing model');
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it('returns 429 once the llmcall limit is exhausted and does not call the model', async () => {
    let lastStatus = 0;
    let lastBody = '';

    for (let i = 0; i < 10; i++) {
      const response = await post(validBody, '203.0.113.78');

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(modelResult);
    }

    const blocked = await post(validBody, '203.0.113.78');

    lastStatus = blocked.status;
    lastBody = await blocked.text();

    expect(lastStatus).toBe(429);
    expect(lastBody).toBe('Rate limit exceeded');
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(generateTextMock).toHaveBeenCalledTimes(10);
  });

  it('does not apply the llmcall rate limit to /api/chat', () => {
    const chatSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../routes/api.chat.ts'), 'utf8');

    expect(chatSource).not.toMatch(/withSecurity|checkRateLimit/);
  });
});
