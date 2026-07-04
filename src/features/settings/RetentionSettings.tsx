import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import { Button } from '@/ui/kp';
import {
  useRetentionPolicyStore, sanitizePolicy, type RetentionMode,
} from '@/platform/privacy/retentionPolicyStore';

const MODES: RetentionMode[] = ['keep-everything', 'delete-audio-after-days', 'summary-only'];

/** Label for a retention mode (literal keys per branch — the i18n extractor
 *  can't trace a key stored in a config-array variable). */
function modeLabel(mode: RetentionMode, count: number, t: TFunction): string {
  switch (mode) {
    case 'keep-everything':
      return t('privacy.retention.mode-keep', { count });
    case 'delete-audio-after-days':
      return t('privacy.retention.mode-days', { count });
    case 'summary-only':
      return t('privacy.retention.mode-summary', { count });
  }
}

function modeHint(mode: RetentionMode, t: (k: string) => string): string {
  switch (mode) {
    case 'keep-everything':
      return t('privacy.retention.mode-keep-hint');
    case 'delete-audio-after-days':
      return t('privacy.retention.mode-days-hint');
    case 'summary-only':
      return t('privacy.retention.mode-summary-hint');
  }
}

export function RetentionSettings({ workspaceRoot }: { workspaceRoot: string }) {
  const { t } = useTranslation();
  // Select the raw stored record (referentially stable across renders when
  // unchanged) and sanitize at render time — `getPolicy()` allocates a fresh
  // object every call, which breaks Zustand's selector equality check and
  // causes an infinite re-render loop if selected directly through a hook.
  const rawPolicy = useRetentionPolicyStore((s) => s.policies[workspaceRoot]);
  const policy = sanitizePolicy(rawPolicy);
  const setPolicy = useRetentionPolicyStore((s) => s.setPolicy);
  const lastSweep = useRetentionPolicyStore((s) => s.lastSweep[workspaceRoot]);
  const [running, setRunning] = useState(false);

  return (
    <section data-testid="retention-settings">
      <h3 className="text-base font-semibold">{t('privacy.retention.title')}</h3>
      <p style={{ fontSize: 12.5, color: 'var(--kp-text-muted, #6b7280)', margin: '4px 0 10px' }}>{t('privacy.retention.subtitle')}</p>
      {MODES.map((mode) => (
        <label key={mode} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', cursor: 'pointer' }}>
          <input type="radio" name="retention-mode" data-testid={`retention-mode-${mode}`}
            checked={policy.mode === mode}
            onChange={() => { setPolicy(workspaceRoot, { ...policy, mode }); }} />
          <span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{modeLabel(mode, policy.audioRetentionDays, t)}</span>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--kp-text-muted, #6b7280)' }}>{modeHint(mode, t)}</span>
          </span>
        </label>
      ))}
      {policy.mode === 'delete-audio-after-days' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 0 24px', fontSize: 13 }}>
          {t('privacy.retention.days-label')}
          <input type="number" min={1} max={3650} data-testid="retention-days" value={policy.audioRetentionDays}
            onChange={(e) => { setPolicy(workspaceRoot, { ...policy, audioRetentionDays: Number(e.target.value) }); }}
            style={{ width: 84, padding: '4px 8px', border: '1px solid var(--kp-divider-strong, #d1d5db)', borderRadius: 6 }} />
        </label>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
        <Button size="sm" disabled={running} data-testid="retention-run-now"
          onClick={() => {
            setRunning(true);
            void import('@/platform/privacy/retentionRunner')
              .then(({ runRetentionSweep }) => runRetentionSweep(workspaceRoot, { force: true }))
              .finally(() => { setRunning(false); });
          }}>
          {t('privacy.retention.run-now')}
        </Button>
        <span style={{ fontSize: 12, color: 'var(--kp-text-muted, #6b7280)' }}>
          {lastSweep
            ? t('privacy.retention.last-sweep', { when: new Date(lastSweep.sweptAt).toLocaleString(), count: lastSweep.deletedCount })
            : t('privacy.retention.never-swept')}
        </span>
      </div>
    </section>
  );
}
