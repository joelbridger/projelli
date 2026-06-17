/**
 * resolveAssuredRoute — decide, at AI-send time, whether the next request
 * should route through the firm zero-retention proxy.
 *
 * Returns an {@link AssuredRoute} ONLY when ALL of:
 *   - the active confidentiality mode is 'assured', AND
 *   - the firm is signed in with a live access token + active seat token, AND
 *   - the firm has a MANAGED key configured for this provider
 *     (`assuredProviders` includes it), AND
 *   - the provider is a cloud provider the proxy supports (anthropic/openai/google).
 *
 * Otherwise returns `undefined`, so the provider stays BYOK-direct (or local).
 * This is the single seam the chat + redline surfaces call; it keeps all the
 * "should we use assured?" policy in one pure-ish place.
 */

import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import {
  getFirmAccessToken,
  getFirmSeatToken,
  getAssuredProviders,
} from '@/platform/firm/firmStore';
import type { AssuredRoute } from './assuredInference';
import type { AssuredProvider } from './contract';

const ASSURED_PROVIDERS: ReadonlySet<string> = new Set(['anthropic', 'openai', 'google']);

export function isAssuredProvider(provider: string): provider is AssuredProvider {
  return ASSURED_PROVIDERS.has(provider);
}

/**
 * Resolve the assured route for a given provider + model, reading the current
 * confidentiality mode and firm session. Non-reactive (call at send time).
 */
export function resolveAssuredRoute(
  provider: string,
  model: string,
  stream = true,
): AssuredRoute | undefined {
  if (getConfidentialityMode() !== 'assured') return undefined;
  if (!isAssuredProvider(provider)) return undefined;
  if (!getAssuredProviders().includes(provider)) return undefined;
  const accessToken = getFirmAccessToken();
  const seatToken = getFirmSeatToken();
  if (!accessToken || !seatToken) return undefined;
  return { provider, model, accessToken, seatToken, stream };
}
