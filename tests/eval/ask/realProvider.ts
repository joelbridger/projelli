/**
 * Build a REAL model provider for the nightly answer-quality run from env.
 *
 * This is used only by `realModel.eval.test.ts` (and the nightly script), never
 * by the gate. It reads a key + model from the environment so the nightly can be
 * pointed at whichever model users actually run, and returns `null` when no key
 * is present (so the test self-skips rather than throwing).
 *
 *   ASK_EVAL_PROVIDER   openai | anthropic         (default: openai)
 *   ASK_EVAL_MODEL      model id                    (default: gpt-4o-mini / claude-haiku-4-5)
 *   ASK_EVAL_JUDGE_*    same three for the judge    (default: same as the answerer)
 *   OPENAI_API_KEY / ANTHROPIC_API_KEY              the key
 */

import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import type { Provider } from '@/platform/providers/Provider';

export interface RealProviderInfo {
  provider: Provider;
  providerId: 'openai' | 'anthropic';
  model: string;
}

function defaultModel(providerId: 'openai' | 'anthropic'): string {
  return providerId === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini';
}

function keyFor(providerId: 'openai' | 'anthropic'): string | undefined {
  return providerId === 'anthropic'
    ? process.env['ANTHROPIC_API_KEY'] ?? process.env['CLAUDE_API_KEY']
    : process.env['OPENAI_API_KEY'];
}

function build(providerId: 'openai' | 'anthropic', model: string, apiKey: string): Provider {
  return providerId === 'anthropic'
    ? new ClaudeProvider({ apiKey, model })
    : new OpenAIProvider({ apiKey, model });
}

/** The provider that ANSWERS the eval questions. `null` if no key is set. */
export function makeRealProvider(): RealProviderInfo | null {
  const providerId = (process.env['ASK_EVAL_PROVIDER'] ?? 'openai').toLowerCase() === 'anthropic'
    ? 'anthropic' : 'openai';
  const apiKey = keyFor(providerId);
  if (!apiKey) return null;
  const model = process.env['ASK_EVAL_MODEL'] ?? defaultModel(providerId);
  return { provider: build(providerId, model, apiKey), providerId, model };
}

/** The provider that JUDGES answers. Defaults to the answerer's provider/key. */
export function makeJudgeProvider(): RealProviderInfo | null {
  const providerId = (process.env['ASK_EVAL_JUDGE_PROVIDER'] ?? process.env['ASK_EVAL_PROVIDER'] ?? 'openai')
    .toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
  const apiKey = keyFor(providerId);
  if (!apiKey) return null;
  const model = process.env['ASK_EVAL_JUDGE_MODEL'] ?? process.env['ASK_EVAL_MODEL'] ?? defaultModel(providerId);
  return { provider: build(providerId, model, apiKey), providerId, model };
}
