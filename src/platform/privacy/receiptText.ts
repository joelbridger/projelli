import { BRAND } from '@/config/brand';
import { brandText } from '@/config/brandText';
import {
  isLocalProvider,
  providerDisplayName,
  type EgressDestination,
  type EgressProvider,
} from '@/platform/privacy/egress';

export function receiptRouteText({
  providerId,
  destination,
  isDemoAnswer,
}: {
  providerId?: EgressProvider;
  destination?: EgressDestination;
  isDemoAnswer?: boolean;
}): string {
  if (!providerId) {
    return isDemoAnswer ? 'source-grounded demo answer' : 'answer from your AI engine';
  }

  const provider = providerDisplayName(providerId);
  if (destination === 'local' || (!destination && isLocalProvider(providerId))) {
    return `ran on ${provider}; 0 files left this machine`;
  }
  if (destination === 'assured-proxy') {
    return `via your firm's zero-retention proxy to ${provider}; ${BRAND.name} retained nothing`;
  }
  if (destination === 'demo-proxy') {
    return brandText(`sent through the ${BRAND.name} demo relay to ${provider}; do not use with client data`);
  }
  return brandText(`sent direct to ${provider}; nothing to ${BRAND.name}`);
}
