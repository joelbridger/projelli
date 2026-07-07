import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, X } from 'lucide-react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  MEETING_ARTIFACTS,
  addRecipientToArtifact,
  buildMeetingRecipientSuggestions,
  normalizeEmailAddress,
  normalizeMeetingDeliveryPlan,
  removeRecipientFromArtifact,
  saveMeetingRecipientPlan,
  type MeetingArtifact,
  type MeetingDeliveryPlan,
  type MeetingRecipient,
} from './meetingRecipientPlan';
import type { MeetingMeta } from './meetingStore';
import type { Matter } from '@/platform/types/matter';

export interface MeetingRecipientsPanelProps {
  matterId: string;
  meetingDir: string;
  meta: MeetingMeta;
  matter: Matter | null;
  workspaceService: WorkspaceService | null;
  onSaved: (meta: MeetingMeta) => void;
}

export function MeetingRecipientsPanel({
  matterId,
  meetingDir,
  meta,
  matter,
  workspaceService,
  onSaved,
}: MeetingRecipientsPanelProps) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<MeetingDeliveryPlan>(() =>
    normalizeMeetingDeliveryPlan(meta.deliveryPlan),
  );
  const [inputs, setInputs] = useState<Record<MeetingArtifact, string>>({
    audio: '',
    transcript: '',
    summary: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPlan(normalizeMeetingDeliveryPlan(meta.deliveryPlan));
    setInputs({ audio: '', transcript: '', summary: '', notes: '' });
    setError(null);
    setSavedNotice(null);
  }, [meta.deliveryPlan, meetingDir]);

  const suggestions = useMemo(
    () => buildMeetingRecipientSuggestions(meta, matter),
    [meta, matter],
  );

  const selectedEmails = (artifact: MeetingArtifact) =>
    new Set(plan.artifacts[artifact].map((recipient) => recipient.email));

  const toggleRecipient = (artifact: MeetingArtifact, recipient: MeetingRecipient) => {
    setError(null);
    setSavedNotice(null);
    const email = normalizeEmailAddress(recipient.email);
    if (!email) return;
    setPlan((current) =>
      selectedEmails(artifact).has(email)
        ? removeRecipientFromArtifact(current, artifact, email)
        : addRecipientToArtifact(current, artifact, recipient),
    );
  };

  const addManualRecipient = (artifact: MeetingArtifact) => {
    const raw = inputs[artifact];
    const email = normalizeEmailAddress(raw);
    if (!email) {
      setError(t('meetings.entry.recipients.invalid-email'));
      return;
    }
    setPlan((current) =>
      addRecipientToArtifact(current, artifact, { email, source: 'manual' }),
    );
    setInputs((current) => ({ ...current, [artifact]: '' }));
    setError(null);
    setSavedNotice(null);
  };

  const handleSave = async () => {
    if (!workspaceService) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const saved = await saveMeetingRecipientPlan(workspaceService, meetingDir, matterId, plan);
      onSaved({ ...meta, deliveryPlan: saved });
      setPlan(saved);
      setSavedNotice(t('meetings.entry.recipients.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      data-testid="meeting-recipients-panel"
      style={{
        margin: '10px var(--kp-gutter) 0',
        border: '1px solid var(--kp-divider)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-background)',
        padding: 'var(--kp-space-md)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-md)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--kp-space-md)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)' }}>
            {t('meetings.entry.recipients.title')}
          </h3>
          <p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 1.5 }}>
            {t('meetings.entry.recipients.description')}
          </p>
        </div>
        <button
          type="button"
          data-testid="meeting-recipients-save"
          onClick={() => { void handleSave().catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); }); }}
          disabled={!workspaceService || saving}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--kp-accent)',
            color: 'var(--color-primary-foreground)',
            padding: '7px 11px',
            fontSize: 'var(--kp-font-xs)',
            fontFamily: 'inherit',
            cursor: !workspaceService || saving ? 'not-allowed' : 'pointer',
            opacity: !workspaceService || saving ? 0.6 : 1,
          }}
        >
          <Check style={{ width: 13, height: 13 }} />
          {saving ? t('meetings.entry.recipients.saving') : t('meetings.entry.recipients.save')}
        </button>
      </div>

      {MEETING_ARTIFACTS.map((artifact) => {
        const selected = selectedEmails(artifact);
        return (
          <div
            key={artifact}
            data-testid={`meeting-recipient-artifact-${artifact}`}
            style={{
              borderTop: '1px solid var(--kp-divider)',
              paddingTop: 'var(--kp-space-sm)',
              display: 'grid',
              gridTemplateColumns: 'minmax(120px, 0.7fr) minmax(220px, 1.8fr)',
              gap: 'var(--kp-space-md)',
            }}
          >
            <div>
              <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)' }}>
                {t(`meetings.entry.recipients.artifacts.${artifact}.label`)}
              </div>
              <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', marginTop: 2 }}>
                {t(`meetings.entry.recipients.artifacts.${artifact}.help`)}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)', minWidth: 0 }}>
              {suggestions.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {suggestions.map((recipient) => (
                    <label
                      key={`${artifact}-${recipient.email}`}
                      data-testid={`meeting-recipient-suggestion-${artifact}-${recipient.email}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        border: '1px solid var(--kp-divider)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 7px',
                        fontSize: 'var(--kp-font-xs)',
                        color: 'var(--kp-navy)',
                        background: selected.has(recipient.email) ? 'var(--color-muted)' : 'var(--color-background)',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(recipient.email)}
                        onChange={() => { toggleRecipient(artifact, recipient); }}
                        style={{ margin: 0 }}
                      />
                      <span>{recipient.name || recipient.email}</span>
                    </label>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
                <input
                  type="email"
                  data-testid={`meeting-recipient-input-${artifact}`}
                  value={inputs[artifact]}
                  onChange={(event) => {
                    setInputs((current) => ({ ...current, [artifact]: event.target.value }));
                    setError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addManualRecipient(artifact);
                  }}
                  placeholder={t('meetings.entry.recipients.email-placeholder')}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: '1px solid var(--kp-divider)',
                    borderRadius: 'var(--radius-md)',
                    padding: '7px 9px',
                    fontSize: 'var(--kp-font-xs)',
                    fontFamily: 'inherit',
                    color: 'var(--color-foreground)',
                    background: 'var(--color-background)',
                  }}
                />
                <button
                  type="button"
                  data-testid={`meeting-recipient-add-${artifact}`}
                  onClick={() => { addManualRecipient(artifact); }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    border: '1px solid var(--kp-divider)',
                    borderRadius: 'var(--radius-md)',
                    background: 'transparent',
                    padding: '7px 9px',
                    fontSize: 'var(--kp-font-xs)',
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    color: 'var(--kp-navy)',
                  }}
                >
                  <Plus style={{ width: 13, height: 13 }} />
                  {t('common.actions.add')}
                </button>
              </div>

              {plan.artifacts[artifact].length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {plan.artifacts[artifact].map((recipient) => (
                    <span
                      key={`${artifact}-selected-${recipient.email}`}
                      data-testid={`meeting-recipient-selected-${artifact}-${recipient.email}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--color-muted)',
                        color: 'var(--kp-navy)',
                        padding: '4px 7px',
                        fontSize: 'var(--kp-font-xs)',
                        maxWidth: '100%',
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
                      </span>
                      <button
                        type="button"
                        data-testid={`meeting-recipient-remove-${artifact}-${recipient.email}`}
                        aria-label={t('meetings.entry.recipients.remove', { email: recipient.email })}
                        onClick={() => { setPlan((current) => removeRecipientFromArtifact(current, artifact, recipient.email)); }}
                        style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'inline-flex', color: 'var(--color-muted-foreground)' }}
                      >
                        <X style={{ width: 12, height: 12 }} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {(error || savedNotice) && (
        <div
          data-testid="meeting-recipients-status"
          style={{
            fontSize: 'var(--kp-font-xs)',
            color: error ? 'var(--color-destructive)' : 'var(--color-muted-foreground)',
          }}
        >
          {error ?? savedNotice}
        </div>
      )}
    </section>
  );
}
