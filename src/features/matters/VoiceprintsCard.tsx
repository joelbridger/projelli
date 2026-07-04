// Voice profiles block on the client's page. Deletion is first-class:
// voiceprints are biometric data, deletable here, deletion audit-logged.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Fingerprint, Trash2 } from 'lucide-react';
import { Card, Button } from '@/ui/kp';
import { AuditService } from '@/platform/audit/AuditService';
import { voiceprintList, voiceprintDelete, type VoiceprintInfo } from '@/platform/utils/tauri-commands';

const audit = new AuditService('matters');

export function VoiceprintsCard({ matterId, workspaceRoot }: { matterId: string; workspaceRoot: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<VoiceprintInfo[]>([]);
  const [confirming, setConfirming] = useState<VoiceprintInfo | null>(null);

  useEffect(() => {
    void voiceprintList(workspaceRoot, matterId).then(setItems).catch(() => { setItems([]); });
  }, [workspaceRoot, matterId]);

  const remove = async (vp: VoiceprintInfo) => {
    await voiceprintDelete(workspaceRoot, matterId, vp.id);
    void audit.logDurable('voiceprint_deleted', `Voice profile deleted for ${vp.name}`, {
      metadata: { matterId }, outputs: { voiceprintId: vp.id },
    });
    setItems((prev) => prev.filter((p) => p.id !== vp.id));
    setConfirming(null);
  };

  if (items.length === 0) return null; // no empty-state noise on the client page

  return (
    <Card data-testid="voiceprints-card">
      <span className="kp-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Fingerprint size={13} aria-hidden /> {t('matter.voiceprints.title')}
      </span>
      <p style={{ fontSize: 12, color: 'var(--kp-text-muted, #6b7280)', margin: '4px 0 8px' }}>{t('matter.voiceprints.subtitle')}</p>
      {items.map((vp) => (
        <div key={vp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{vp.name}</span>
          <span style={{ fontSize: 11.5, color: 'var(--kp-text-muted, #6b7280)' }}>{t('matter.voiceprints.samples', { count: vp.sampleCount })}</span>
          <button type="button" data-testid={`voiceprint-delete-${vp.id}`} aria-label={t('matter.voiceprints.delete')}
            onClick={() => { setConfirming(vp); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--kp-danger, #b91c1c)' }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {confirming && (
        <div role="alertdialog" aria-label={t('matter.voiceprints.delete-title')}
          style={{ border: '1px solid var(--kp-divider-strong, #d1d5db)', borderRadius: 8, padding: 12, marginTop: 8, background: 'var(--kp-surface-2, #f8fafc)' }}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>{t('matter.voiceprints.delete-title')}</p>
          <p style={{ fontSize: 12.5, margin: '6px 0 10px' }}>{t('matter.voiceprints.delete-body', { name: confirming.name })}</p>
          <Button data-testid="voiceprint-delete-confirm" onClick={() => { void remove(confirming); }}>
            {t('matter.voiceprints.delete-confirm')}
          </Button>
        </div>
      )}
    </Card>
  );
}
