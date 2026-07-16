/**
 * The container hook that assembles the write orchestrator for the UI.
 *
 * It wires the REAL, durable pieces — the encrypted CRM live-record ledger, the
 * live flag, the home-calendar capability, and live busy time — to the
 * orchestrator, and the DEFERRED native pieces (grant load + provider execution)
 * to their fail-closed stand-ins. With no native grant, `prepare` refuses and no
 * write ever reaches egress, so mounting this hook is side-effect-safe beyond the
 * durable read it needs to show pending proposals.
 *
 * This hook must only ever be mounted behind the `calendar-write` flag — its
 * caller (`CalendarWriteReviewCard`) checks the flag first and returns before
 * this hook runs when the surface is dark.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFlag } from '@/platform/flags';
import {
  getBusyBlocks,
  useCalendarCapabilityStore,
  useCalendarEventStore,
} from '@/features/calendar';
import { loadLiveCrmRecords, type LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import {
  createCalendarWriteOrchestrator,
  type BusyInterval,
  type CalendarWriteDeps,
} from './orchestrator';
import { createLiveRecordProposalStore, type LiveRecordLike } from './proposalStore';
import { loadNativeWriteGrant, createDeferredProviderPort } from './nativeBridge';
import { newIdempotencyKey } from './idempotency';
import type { CalendarWriteProposal } from './types';

const BUSY_HORIZON_DAYS = 120;

export interface CalendarWriteQueue {
  readonly proposals: readonly CalendarWriteProposal[];
  readonly pendingCount: number;
  readonly refresh: () => Promise<void>;
  readonly approve: (proposalId: string) => Promise<void>;
  readonly resolvePending: () => Promise<void>;
}

export function useCalendarWrite(): CalendarWriteQueue {
  const enabled = useFlag('calendar-write');
  const live = useLiveCrmRecords();
  const capability = useCalendarCapabilityStore();
  const eventStore = useCalendarEventStore();
  const [proposals, setProposals] = useState<readonly CalendarWriteProposal[]>([]);

  // The store hooks return fresh objects each render, so the orchestrator is
  // built ONCE and reads the latest values through this ref (updated in an
  // effect, never during render). This keeps the orchestrator identity stable
  // and avoids a refresh loop.
  const latest = useRef({ enabled, live, capability, eventStore });
  useEffect(() => {
    latest.current = { enabled, live, capability, eventStore };
  });

  const orchestrator = useMemo(() => {
    const io = {
      save: (record: LiveRecordLike) => latest.current.live.save(record as LiveCrmRecord),
      load: () => loadLiveCrmRecords(latest.current.live.workspaceRoot),
    };
    const store = createLiveRecordProposalStore(io);
    const deps: CalendarWriteDeps = {
      isWriteEnabled: () => latest.current.enabled,
      loadGrant: (provider) => loadNativeWriteGrant(provider),
      getHomeCalendarId: () => Promise.resolve(latest.current.capability.state.homeCalendarId),
      refreshBusy: async ({ excludeProviderEventId }): Promise<readonly BusyInterval[]> => {
        // eslint-disable-next-line react-hooks/purity -- invoked at approve time inside the orchestrator, not during render; the current time is exactly what a live busy refresh needs.
        const nowMs = Date.now();
        const startUtc = new Date(nowMs).toISOString();
        const endUtc = new Date(nowMs + BUSY_HORIZON_DAYS * 86_400_000).toISOString();
        const occurrences = await latest.current.eventStore.listOccurrences({ startUtc, endUtc });
        const blocks = getBusyBlocks(
          { startUtc, endUtc },
          {
            capability: latest.current.capability.state,
            localOccurrences: occurrences.filter((o) => o.sourceEventId !== excludeProviderEventId),
          },
        );
        return blocks.map((b) => ({ startUtc: b.startUtc, endUtc: b.endUtc }));
      },
      provider: createDeferredProviderPort(),
      store,
      now: () => new Date().toISOString(),
      newProposalId: () => `calendar-write-${crypto.randomUUID()}`,
      newIdempotencyKey,
    };
    return createCalendarWriteOrchestrator(deps);
  }, []);

  const refresh = useCallback(async () => {
    const list = await orchestrator.listProposals();
    setProposals(list);
  }, [orchestrator]);

  const approve = useCallback(
    async (proposalId: string) => {
      await orchestrator.approve(proposalId);
      await refresh();
    },
    [orchestrator, refresh],
  );

  const resolvePending = useCallback(async () => {
    await orchestrator.resolvePending();
    await refresh();
  }, [orchestrator, refresh]);

  useEffect(() => {
    // eslint-disable-next-line lantern-async/no-silent-failure -- Best-effort initial load; a failed durable read leaves the queue empty, which is the fail-closed state, and refresh() re-runs after every approve/resolve.
    refresh().catch(() => {});
  }, [refresh]);

  const pendingCount = proposals.filter(
    (p) => p.status === 'prepared' || p.status === 'verify_pending',
  ).length;

  return { proposals, pendingCount, refresh, approve, resolvePending };
}
