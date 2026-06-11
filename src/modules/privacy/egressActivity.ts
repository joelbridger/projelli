/**
 * F-120 — positive cloud-egress signal. Counts provider HTTP requests in
 * flight so the status bar can show a quiet "sending" state when egress is
 * actually happening (loud when safe, visible when not). Instrumented at
 * the single choke point every cloud provider uses (getCorsSafeFetch).
 * Note: fetch resolves at response HEADERS, so a streaming chat shows the
 * pulse for the send + first byte; the StatusBar holds it briefly so it
 * never reads as a flicker.
 */
import { create } from 'zustand';

interface EgressActivityState {
  activeCount: number;
  lastActivityAt: number;
  begin: () => void;
  end: () => void;
}

export const useEgressActivityStore = create<EgressActivityState>((set) => ({
  activeCount: 0,
  lastActivityAt: 0,
  begin: () => set((s) => ({ activeCount: s.activeCount + 1, lastActivityAt: Date.now() })),
  end: () => set((s) => ({ activeCount: Math.max(0, s.activeCount - 1), lastActivityAt: Date.now() })),
}));

/** Wrap a fetch so every call signals begin/end, success or failure. */
export function instrumentEgressFetch(fetchFn: typeof globalThis.fetch): typeof globalThis.fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const { begin, end } = useEgressActivityStore.getState();
    begin();
    try {
      return await fetchFn(input as RequestInfo, init);
    } finally {
      end();
    }
  };
  return wrapped as typeof globalThis.fetch;
}
