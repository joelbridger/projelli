/**
 * Local-only egress enforcement.
 *
 * The egress INDICATOR (resolveEgress) already tells the user "nothing leaves"
 * in Local-only mode. This module is the matching ENFORCEMENT at the actual AI
 * send points, so the indicator can never lie: a send that would route to a
 * cloud provider while Local-only is in effect is blocked/forced local.
 *
 * Redline + inline-edit already resolve their provider through
 * `useActiveEgressProvider` (which returns 'ollama' in Local-only), so they are
 * safe. The two paths that route by a chat's STORED provider (chat send) or by
 * KEY PRESENCE (Ask) bypass that and need this guard.
 */

import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { isLocalProviderId, type ChatProviderId } from '@/platform/providers/providerFactory';

/** True when Local-only confidentiality mode is in effect (global or matter-forced). */
export function isLocalOnlyMode(): boolean {
  return getConfidentialityMode() === 'local-only';
}

/** Thrown when a cloud AI send is attempted while Local-only mode is on. The
 *  chat/ask UI surfaces the message so the user knows why the send was blocked. */
export class LocalOnlyEgressError extends Error {
  constructor(provider: string) {
    super(
      `Local-only mode is on, so nothing can be sent to a cloud AI provider. ` +
        `This chat is set to "${provider}". Switch it to a local model, or turn off ` +
        `Local-only mode in the Privacy Center, to send.`,
    );
    this.name = 'LocalOnlyEgressError';
  }
}

/**
 * Fail-closed guard for SEND paths that route by a stored/explicit provider id
 * (the chat send path). Throws `LocalOnlyEgressError` when Local-only is on and
 * the provider would send to the cloud, so a stored cloud chat can never leak
 * while the indicator says "nothing leaves".
 */
export function assertLocalOnlyAllowsSend(provider: string): void {
  if (isLocalOnlyMode() && !isLocalProviderId(provider as ChatProviderId)) {
    throw new LocalOnlyEgressError(provider);
  }
}
