import { describe, expect, it } from 'vitest';
import { ClientSubscriptionCapError, CrmDocumentRouter, InMemorySyncMetrics } from '@/platform/crm/sync';

describe('D1 lazy-subscription load budgets', () => {
  it('keeps the numeric bootstrap allocation at or below 64 MiB with chunks at or below 768 KiB', () => {
    const metrics = new InMemorySyncMetrics();
    metrics.beginBootstrap();
    // Frozen 03 §1.3 allocation: 10 MiB firm + 30 MiB records + 15 MiB notes + 1 MiB control.
    for (const [stream, bytes] of [['firm', 10], ['record', 30], ['task-notes', 15], ['overhead', 1]] as const) {
      let remaining = bytes * 1024 * 1024;
      while (remaining > 0) {
        const chunk = Math.min(remaining, 768 * 1024);
        metrics.recordTransfer(stream, 'checkpoint', chunk);
        remaining -= chunk;
      }
    }
    expect(metrics.snapshot().bootstrapBytes).toBe(56 * 1024 * 1024);
    expect(() => metrics.recordTransfer('record', 'tail', 768 * 1024 + 1)).toThrow('768 KiB');
  });

  it('subscribes to at most twelve record/task-notes pairs, never all 80 households', async () => {
    const started: string[] = [];
    const stopped: string[] = [];
    const router = new CrmDocumentRouter({
      startDocument: async (doc) => { started.push(`${doc.matterId}/${doc.docId}`); },
      stopDocument: async (doc) => { stopped.push(`${doc.matterId}/${doc.docId}`); },
      metrics: new InMemorySyncMetrics(),
    });
    for (let index = 1; index <= 12; index += 1) await router.openClient(`household-${String(index)}`, { taskNotes: true });
    await router.openClient('household-13', { taskNotes: true });
    expect(router.activeClientMatterIds()).toHaveLength(12);
    expect(router.activeClientMatterIds()).not.toContain('household-1');
    expect(started).not.toContain('household-80/crm:record');
    expect(stopped).toEqual(expect.arrayContaining(['household-1/crm:record', 'household-1/crm:task-notes']));
  });

  it('requires an explicit unpin instead of silently expanding subscriptions past twelve clients', async () => {
    const router = new CrmDocumentRouter({ startDocument: async () => {}, stopDocument: async () => {}, metrics: new InMemorySyncMetrics() });
    for (let index = 1; index <= 12; index += 1) {
      await router.openClient(`household-${String(index)}`);
      router.setPinned(`household-${String(index)}`, true);
    }
    await expect(router.openClient('household-13')).rejects.toBeInstanceOf(ClientSubscriptionCapError);
  });

  // EXAM-BLOCKED: no Northcrest fixture or timing/byte transfer harness is wired to the sync engine.
  it.skip('keeps restart and 30-day offline recovery within the D1 transfer and completion ceilings');
  // EXAM-BLOCKED: no merged key-wall access harness exposes protected-content read checks.
  it.skip('removes revoked client access before protected content can be read, then restores eligible docs');
});
