import { afterEach, describe, expect, it, vi } from 'vitest';
import { isReasoningModel } from './constants';

describe('isReasoningModel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches OpenAI reasoning model name prefixes', () => {
    expect(isReasoningModel('o1-mini')).toBe(true);
    expect(isReasoningModel('o3')).toBe(true);
    expect(isReasoningModel('gpt-5')).toBe(true);
    expect(isReasoningModel('GPT-5-turbo')).toBe(true);
  });

  it('does not treat standard chat models as reasoning models', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('claude-3-5-sonnet')).toBe(false);
    expect(isReasoningModel('openai-o1')).toBe(false);
  });

  it('does not write to the console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    isReasoningModel('gpt-4o');
    isReasoningModel('o1');

    expect(spy).not.toHaveBeenCalled();
  });
});
