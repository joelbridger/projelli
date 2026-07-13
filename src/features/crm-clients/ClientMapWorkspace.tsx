/* eslint-disable lantern-i18n/no-hardcoded-string -- this ports the existing Client Map controls into the frozen CRM tab surface. */
import { useCallback, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, Card } from '@/ui/kp';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { useClientMap } from '@/features/matters/useClientMap';
import { usePromptDialog } from '@/platform/hooks/usePromptDialog';
import { PromptDialog } from '@/ui/PromptDialog';
import { answerQuestion, flagForClient } from '@/features/matters/clientMap/guidedInterview';
import { dispatchOpenSource } from '@/features/matters/clientMap/openSource';

/** The pre-merge MatterHub Client Map build/refresh path, mounted in the live CRM Client Map tab. */
export function ClientMapWorkspace({ matterId }: { matterId: string }) {
  const clientMap = useClientMap(matterId);
  const { prompt, dialogProps } = usePromptDialog();
  const [syncing, setSyncing] = useState(false);

  const buildOrRefresh = useCallback(() => {
    void (async () => {
      if (syncing) return;
      setSyncing(true);
      try {
        if (!clientMap.map || clientMap.map.lastBuiltAt === '') await clientMap.generate();
        else await clientMap.checkForUpdates();
      } finally {
        setSyncing(false);
      }
    })().catch((error: unknown) => { console.error('Client Map build failed:', error); });
  }, [clientMap, syncing]);

  const editItem = useCallback((sectionKey: string, itemId: string) => {
    void (async () => {
      const existing = clientMap.map?.sections.find((section) => section.key === sectionKey)?.items.find((item) => item.id === itemId)?.text ?? '';
      const text = await prompt('Update this Client Map fact', existing, { title: 'Edit Client Map fact', confirmLabel: 'Save' });
      if (text?.trim()) {
        const { useClientMapStore } = await import('@/platform/clientMap/clientMapStore');
        useClientMapStore.getState().editItem(matterId, sectionKey, itemId, text.trim());
      }
    })().catch((error: unknown) => { console.error('Client Map edit failed:', error); });
  }, [clientMap.map, matterId, prompt]);

  const label = clientMap.map?.lastBuiltAt ? 'Refresh Client Map' : 'Build Client Map';
  return (
    <section data-testid="crm-client-map-workspace" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
      <Card variant="raised" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><strong>Client Map</strong><p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)' }}>Build a cited summary from this client’s saved records, or refresh it when the records change.</p></div>
        <Button size="sm" disabled={syncing || clientMap.status === 'generating'} onClick={buildOrRefresh} data-testid="clientmap-build-refresh">
          {syncing || clientMap.status === 'generating' ? <><Loader2 size={14} className="animate-spin" /> Building Client Map</> : label}
        </Button>
      </Card>
      {clientMap.status === 'error' ? <p role="alert">{clientMap.errorMessage ?? 'Client Map could not be built. Try again.'}</p> : null}
      {clientMap.status === 'empty' ? <Card variant="raised">No source material is ready for this Client Map yet. Add or sync this client’s records, then refresh.</Card> : null}
      {clientMap.map ? <ClientMapPanel map={clientMap.map} onOpenSource={(source) => { dispatchOpenSource(matterId, source); }} onEditItem={editItem} onAnswerQuestion={(gap) => { void prompt(`Answer: ${gap.text}`, '', { title: 'Add Client Map answer', confirmLabel: 'Save' }).then((text) => { if (text?.trim()) answerQuestion(matterId, gap.sectionKey, text.trim(), gap.text); }).catch((error: unknown) => { console.error('Client Map answer failed:', error); }); }} onFlagForClient={(gap) => { flagForClient(matterId, gap.text); }} /> : null}
      <PromptDialog {...dialogProps} />
    </section>
  );
}
