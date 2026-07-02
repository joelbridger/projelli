// connectorEventBridge — closes a small window opened by lazy-loading
// ConnectorSourcePanels (see ConnectorSourcePanels.tsx): each connector
// citation viewer installs its `lantern:open-<connector>` listener inside its
// own `useEffect`, which doesn't run until that lazy chunk has loaded. A
// citation click that lands before the chunk loads would otherwise fire into
// a CustomEvent nobody is listening for yet and be silently dropped.
//
// Fix: install a tiny, always-eager listener (no heavy imports — just
// `window.addEventListener` and the event-name constants, which are already
// part of the startup bundle) that buffers the latest event per connector
// type until the real panels take over, then replays whatever was buffered.

import {
  EV_OPEN_CRM,
  EV_OPEN_ONEDRIVE,
  EV_OPEN_ESIGN,
  EV_OPEN_MEETING,
  EV_OPEN_BOX,
  EV_OPEN_SHAREFILE,
  EV_OPEN_JOTFORM,
  EV_OPEN_ZOCKS,
  EV_OPEN_ADDEPAR,
} from '@/config/identity';

const CONNECTOR_EVENT_NAMES = [
  EV_OPEN_CRM,
  EV_OPEN_ONEDRIVE,
  EV_OPEN_ESIGN,
  EV_OPEN_MEETING,
  EV_OPEN_BOX,
  EV_OPEN_SHAREFILE,
  EV_OPEN_JOTFORM,
  EV_OPEN_ZOCKS,
  EV_OPEN_ADDEPAR,
];

let panelsReady = false;
const pending = new Map<string, unknown>();
let onFirstEvent: (() => void) | null = null;

function bufferConnectorEvent(e: Event): void {
  if (panelsReady) return; // the real panels' own listeners handle this now
  const isFirst = pending.size === 0;
  pending.set(e.type, (e as CustomEvent).detail);
  // Tell the caller to actually mount <ConnectorSourcePanels> now — rendering
  // it (even behind a closed/no-op state) would start its import() the
  // moment React tries to render it, regardless of whether anything is
  // "open". Mounting it lazily-on-first-event is what makes the chunk fetch
  // happen only when a citation is actually clicked, not on every cold start.
  if (isFirst) onFirstEvent?.();
}

/**
 * Install the early bridge. Call once, near app mount — before
 * `ConnectorSourcePanels` has necessarily loaded. `notifyFirstEvent` fires
 * (once) the first time any connector citation event arrives, so the caller
 * can mount the lazy panels only then instead of unconditionally.
 */
export function installEarlyConnectorEventBridge(notifyFirstEvent: () => void): () => void {
  onFirstEvent = notifyFirstEvent;
  for (const name of CONNECTOR_EVENT_NAMES) {
    window.addEventListener(name, bufferConnectorEvent);
  }
  return () => {
    onFirstEvent = null;
    for (const name of CONNECTOR_EVENT_NAMES) {
      window.removeEventListener(name, bufferConnectorEvent);
    }
  };
}

/**
 * Called once the real connector panels have mounted (and installed their
 * own listeners). Replays anything the early bridge buffered while the lazy
 * chunk was loading, then hands off — later events reach the panels directly.
 */
export function handOffToConnectorPanels(): void {
  panelsReady = true;
  for (const [type, detail] of pending) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }
  pending.clear();
}
