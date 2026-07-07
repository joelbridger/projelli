import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Users, X } from 'lucide-react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { Matter } from '@/platform/types/matter';
import {
  MEETING_ARTIFACTS,
  addGroupToMeetingDeliveryPlan,
  addRecipientToArtifact,
  buildMeetingRecipientSuggestions,
  calendarAttendeesToRecipients,
  loadMeetingRecipientGroups,
  normalizeEmailAddress,
  normalizeMeetingDeliveryPlan,
  recipientsInDeliveryPlan,
  removeRecipientFromArtifact,
  resolveMeetingDeliveryPlan,
  saveMeetingRecipientGroup,
  saveMeetingRecipientPlan,
  setRecipientForArtifact,
  setRecipientForEveryArtifact,
  type MeetingArtifact,
  type MeetingDeliveryPlan,
  type MeetingRecipient,
  type MeetingRecipientGroup,
} from './meetingRecipientPlan';
import type { MeetingMeta } from './meetingStore';

export interface MeetingRecipientsPanelProps {
  matterId: string;
  meetingDir: string;
  meta: MeetingMeta;
  matter: Matter | null;
  workspaceService: WorkspaceService | null;
  onSaved: (meta: MeetingMeta) => void;
}

function emptyInputs(): Record<MeetingArtifact, string> {
  return {
    notes: '',
    transcript: '',
    summary: '',
    audio: '',
  };
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
    resolveMeetingDeliveryPlan(meta),
  );
  const [inputs, setInputs] = useState<Record<MeetingArtifact, string>>(() => emptyInputs());
  const [personInput, setPersonInput] = useState('');
  const [groups, setGroups] = useState<MeetingRecipientGroup[]>([]);
  const [groupName, setGroupName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);

  useEffect(() => {
    setPlan(resolveMeetingDeliveryPlan(meta));
    setInputs(emptyInputs());
    setPersonInput('');
    setError(null);
    setSavedNotice(null);
  }, [meta, meetingDir]);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceService || !matter) {
      setGroups([]);
      return () => { cancelled = true; };
    }
    void loadMeetingRecipientGroups(workspaceService, matter)
      .then((file) => {
        if (!cancelled) setGroups(file.groups);
      })
      .catch(() => {
        if (!cancelled) setGroups([]);
      });
    return () => { cancelled = true; };
  }, [workspaceService, matter]);

  const calendarRecipients = useMemo(
    () => calendarAttendeesToRecipients(meta.calendarEvent),
    [meta.calendarEvent],
  );
  const hasCalendarRecipients = calendarRecipients.length > 0;
  const suggestions = useMemo(
    () => buildMeetingRecipientSuggestions(meta, matter),
    [meta, matter],
  );
  const autoRows = useMemo(
    () => mergeRecipients([...calendarRecipients, ...recipientsInDeliveryPlan(plan)]),
    [calendarRecipients, plan],
  );

  const selectedEmails = (artifact: MeetingArtifact) =>
    new Set(plan.artifacts[artifact].map((recipient) => recipient.email));

  const toggleRecipient = (artifact: MeetingArtifact, recipient: MeetingRecipient) => {
    setError(null);
    setSavedNotice(null);
    const email = normalizeEmailAddress(recipient.email);
    if (!email) return;
    setPlan((current) =>
      current.artifacts[artifact].some((candidate) => candidate.email === email)
        ? removeRecipientFromArtifact(current, artifact, email)
        : addRecipientToArtifact(current, artifact, recipient),
    );
  };

  const togglePerson = (recipient: MeetingRecipient) => {
    setError(null);
    setSavedNotice(null);
    setPlan((current) => {
      const selectedCount = MEETING_ARTIFACTS.filter((artifact) =>
        current.artifacts[artifact].some((candidate) => candidate.email === recipient.email),
      ).length;
      return setRecipientForEveryArtifact(current, recipient, selectedCount === 0);
    });
  };

  const togglePersonArtifact = (recipient: MeetingRecipient, artifact: MeetingArtifact) => {
    setError(null);
    setSavedNotice(null);
    setPlan((current) => setRecipientForArtifact(
      current,
      artifact,
      recipient,
      !current.artifacts[artifact].some((candidate) => candidate.email === recipient.email),
    ));
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

  const addManualPersonToAllArtifacts = () => {
    const email = normalizeEmailAddress(personInput);
    if (!email) {
      setError(t('meetings.entry.recipients.invalid-email'));
      return;
    }
    setPlan((current) => setRecipientForEveryArtifact(current, { email, source: 'manual' }, true));
    setPersonInput('');
    setError(null);
    setSavedNotice(null);
  };

  const handleSave = async () => {
    if (!workspaceService) return;
    setSaving(true);
    setError(null);
    setSavedNotice(null);
    try {
      const savedMeta = await saveMeetingRecipientPlan(workspaceService, meetingDir, matterId, plan);
      onSaved(savedMeta);
      setPlan(normalizeMeetingDeliveryPlan(savedMeta.deliveryPlan));
      setSavedNotice(t('meetings.entry.recipients.saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGroup = async () => {
    if (!workspaceService) return;
    setSavingGroup(true);
    setError(null);
    setSavedNotice(null);
    try {
      const file = await saveMeetingRecipientGroup(
        workspaceService,
        matter,
        groupName,
        recipientsInDeliveryPlan(plan),
      );
      setGroups(file.groups);
      setGroupName('');
      setSavedNotice(t('meetings.entry.recipients.group-saved'));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGroup(false);
    }
  };

  const handleAddGroup = (group: MeetingRecipientGroup) => {
    setPlan((current) => addGroupToMeetingDeliveryPlan(current, group));
    setError(null);
    setSavedNotice(null);
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
            {hasCalendarRecipients
              ? t('meetings.entry.recipients.auto-description')
              : t('meetings.entry.recipients.description')}
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

      {hasCalendarRecipients ? (
        <div data-testid="meeting-recipient-auto-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)' }}>
            {t('meetings.entry.recipients.auto-title')}
          </div>
          {autoRows.map((recipient) => {
            const selectedCount = MEETING_ARTIFACTS.filter((artifact) =>
              plan.artifacts[artifact].some((candidate) => candidate.email === recipient.email),
            ).length;
            return (
              <div
                key={recipient.email}
                data-testid={`meeting-recipient-person-row-${recipient.email}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 1fr) minmax(240px, 1.4fr)',
                  gap: 'var(--kp-space-md)',
                  alignItems: 'center',
                  borderTop: '1px solid var(--kp-divider)',
                  paddingTop: 8,
                }}
              >
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0, color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)' }}>
                  <input
                    type="checkbox"
                    data-testid={`meeting-recipient-person-${recipient.email}`}
                    checked={selectedCount > 0}
                    onChange={() => { togglePerson(recipient); }}
                    style={{ margin: 0 }}
                  />
                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email}
                  </span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {MEETING_ARTIFACTS.map((artifact) => {
                    const checked = plan.artifacts[artifact].some((candidate) => candidate.email === recipient.email);
                    return (
                      <label
                        key={`${recipient.email}-${artifact}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          border: '1px solid var(--kp-divider)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '4px 7px',
                          fontSize: 'var(--kp-font-xs)',
                          color: 'var(--kp-navy)',
                          background: checked ? 'var(--color-muted)' : 'var(--color-background)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          data-testid={`meeting-recipient-person-artifact-${artifact}-${recipient.email}`}
                          checked={checked}
                          onChange={() => { togglePersonArtifact(recipient, artifact); }}
                          style={{ margin: 0 }}
                        />
                        <span>{t(`meetings.entry.recipients.artifacts.${artifact}.label`)}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 6, minWidth: 0, paddingTop: 4 }}>
            <input
              type="email"
              data-testid="meeting-recipient-input-person"
              value={personInput}
              onChange={(event) => {
                setPersonInput(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addManualPersonToAllArtifacts();
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
              data-testid="meeting-recipient-add-person"
              onClick={addManualPersonToAllArtifacts}
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
              {t('meetings.entry.recipients.add-person')}
            </button>
          </div>
        </div>
      ) : (
        <div data-testid="meeting-recipient-manual-picker" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
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
        </div>
      )}

      <div
        data-testid="meeting-recipient-groups"
        style={{
          borderTop: '1px solid var(--kp-divider)',
          paddingTop: 'var(--kp-space-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)' }}>
          <Users style={{ width: 13, height: 13 }} />
          {t('meetings.entry.recipients.groups-title')}
        </div>
        <div style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 1.5 }}>
          {t('meetings.entry.recipients.groups-description')}
        </div>
        {groups.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {groups.map((group) => (
              <button
                key={group.id}
                type="button"
                data-testid={`meeting-recipient-group-add-${group.id}`}
                onClick={() => { handleAddGroup(group); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  border: '1px solid var(--kp-divider)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-background)',
                  color: 'var(--kp-navy)',
                  padding: '4px 7px',
                  fontSize: 'var(--kp-font-xs)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <Plus style={{ width: 12, height: 12 }} />
                {t('meetings.entry.recipients.use-group', { name: group.name, count: group.recipients.length })}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, minWidth: 0 }}>
          <input
            type="text"
            data-testid="meeting-recipient-group-name"
            value={groupName}
            onChange={(event) => {
              setGroupName(event.target.value);
              setError(null);
            }}
            placeholder={t('meetings.entry.recipients.group-name-placeholder')}
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
            data-testid="meeting-recipient-group-save"
            onClick={() => { void handleSaveGroup().catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); }); }}
            disabled={!workspaceService || savingGroup || recipientsInDeliveryPlan(plan).length === 0}
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
              cursor: !workspaceService || savingGroup ? 'not-allowed' : 'pointer',
              opacity: !workspaceService || savingGroup || recipientsInDeliveryPlan(plan).length === 0 ? 0.6 : 1,
              color: 'var(--kp-navy)',
            }}
          >
            <Check style={{ width: 13, height: 13 }} />
            {savingGroup ? t('meetings.entry.recipients.saving') : t('meetings.entry.recipients.save-group')}
          </button>
        </div>
      </div>

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

function mergeRecipients(recipients: MeetingRecipient[]): MeetingRecipient[] {
  const byEmail = new Map<string, MeetingRecipient>();
  for (const recipient of recipients) {
    const email = normalizeEmailAddress(recipient.email);
    if (!email || byEmail.has(email)) continue;
    byEmail.set(email, { ...recipient, email });
  }
  return [...byEmail.values()].sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}
