/**
 * MeetingSendPanel — the ONE merged send surface (meetings audit items 1-4, 11,
 * 12). Opened from the meeting header's `Send` action in a right drawer, it
 * folds the old two boxes (recipient planning + send review) into a single
 * unboxed flow with one primary action: `Review send`.
 *
 * - Recipients use one person-first matrix for BOTH the calendar and manual
 *   paths (item 3). A brand-new manual person defaults to every item on.
 * - Recipient edits AUTO-SAVE to meeting.json (item 2); there is no separate
 *   `Save plan` primary button. A quiet saved/saving status shows instead.
 * - Saved groups fold behind a disclosure (item 4).
 * - The default view shows only a ready count; the full To / Subject / Body /
 *   Attachment detail appears ONLY in the review dialog (item 11).
 * - The privacy trust note stays visible at the action point (item 12).
 *
 * The send gating (`canReview`) is preserved verbatim in behavior from the old
 * MeetingArtifactSendPanel: no send without a connected email account, selected
 * items, a reviewed meeting, and Local-only mode off. The review dialog stays
 * the only path that actually sends.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Loader2, Plus, Send, Users, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { Matter } from '@/platform/types/matter';
import { mailConnectedAccounts, type ConnectedAccount } from '@/platform/utils/mail-commands';
import { isPersistedLocalOnly } from '@/platform/privacy/localOnlyGuard';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';
import { Button as DialogButton } from '@/ui/button';
import { AuditService } from '@/platform/audit/AuditService';
import type { MeetingMeta } from './meetingStore';
import type { TranscriptFile } from '@/platform/types/meeting';
import { mmss } from './meetingSources';
import {
  MEETING_ARTIFACTS,
  addGroupToMeetingDeliveryPlan,
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
import {
  buildMeetingArtifactAvailability,
  buildMeetingSendPreview,
  artifactLabelFor,
  meetingSendLogSummary,
  meetingSendTitle,
  sendMeetingArtifacts,
  type MeetingSendLogEntry,
} from './meetingArtifactDelivery';

export interface MeetingSendPanelProps {
  matterId: string;
  meetingDir: string;
  workspaceRoot: string;
  workspaceGeneration: number;
  meta: MeetingMeta;
  matter: Matter | null;
  clientName: string;
  workspaceService: WorkspaceService | null;
  hasAudio: boolean;
  hasTranscript: boolean;
  hasNotes: boolean;
  summaryReady: boolean;
  transcript: TranscriptFile | null;
  buildSummaryDocxBytes: () => Promise<Uint8Array>;
  /** Called after any change that updated meeting.json (recipient auto-save or
   *  a completed send), with the fresh meta so the parent can re-render. */
  onChanged: (meta: MeetingMeta) => void;
}

const audit = new AuditService('meetings');
const AUTOSAVE_DELAY_MS = 600;

function artifactLabel(artifact: MeetingArtifact, t: TFunction): string {
  switch (artifact) {
    case 'notes':
      return t('meetings.entry.recipients.artifacts.notes.label');
    case 'transcript':
      return t('meetings.entry.recipients.artifacts.transcript.label');
    case 'summary':
      return t('meetings.entry.recipients.artifacts.summary.label');
    case 'audio':
      return t('meetings.entry.recipients.artifacts.audio.label');
  }
}

function artifactHelp(artifact: MeetingArtifact, t: TFunction): string {
  switch (artifact) {
    case 'notes':
      return t('meetings.entry.recipients.artifacts.notes.help');
    case 'transcript':
      return t('meetings.entry.recipients.artifacts.transcript.help');
    case 'summary':
      return t('meetings.entry.recipients.artifacts.summary.help');
    case 'audio':
      return t('meetings.entry.recipients.artifacts.audio.help');
  }
}

export function MeetingSendPanel({
  matterId,
  meetingDir,
  workspaceRoot,
  workspaceGeneration,
  meta,
  matter,
  clientName,
  workspaceService,
  hasAudio,
  hasTranscript,
  hasNotes,
  summaryReady,
  transcript,
  buildSummaryDocxBytes,
  onChanged,
}: MeetingSendPanelProps) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<MeetingDeliveryPlan>(() => resolveMeetingDeliveryPlan(meta));
  const [personInput, setPersonInput] = useState('');
  const [groups, setGroups] = useState<MeetingRecipientGroup[]>([]);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [selectedAccountKey, setSelectedAccountKey] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  // The plan JSON last persisted to disk; guards the autosave effect from
  // re-firing when nothing changed. Seeded from the opened meta.
  const lastSavedJson = useRef(JSON.stringify(resolveMeetingDeliveryPlan(meta)));
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Finding 1 — saves are SERIALIZED through a single draining loop so a
  // debounced save already in flight can never overwrite a newer plan or fire
  // onChanged with a stale one. `pendingPlanRef` always holds the latest plan
  // to persist; the loop drains it, so the write order is monotonic and the
  // disk always converges to the newest edit.
  const pendingPlanRef = useRef<MeetingDeliveryPlan | null>(null);
  const saverRef = useRef<Promise<void> | null>(null);
  // Guards local state updates from a save that finishes after this panel has
  // unmounted (the send drawer closing mid-debounce). onChanged still fires so
  // the parent, which outlives the drawer, gets the saved meta.
  const mountedRef = useRef(true);
  // Latest meta, read by the meeting-switch reset without making that reset
  // depend on every meta change (which would clobber in-flight local edits when
  // our own save fires onChanged -> setMeta).
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const drainSaves = useCallback((): Promise<void> => {
    if (saverRef.current) return saverRef.current;
    const ws = workspaceService;
    if (!ws) return Promise.resolve();
    const loop = (async () => {
      try {
        while (pendingPlanRef.current) {
          const toSave = pendingPlanRef.current;
          pendingPlanRef.current = null;
          const savedMeta = await saveMeetingRecipientPlan(ws, meetingDir, matterId, toSave);
          lastSavedJson.current = JSON.stringify(normalizeMeetingDeliveryPlan(savedMeta.deliveryPlan));
          onChanged(savedMeta);
        }
        if (mountedRef.current) setSaveState('saved');
      } finally {
        saverRef.current = null;
        // A plan queued during the exit window still gets drained.
        if (pendingPlanRef.current) {
          void drainSaves().catch((err: unknown) => {
            setRecipientError(err instanceof Error ? err.message : String(err));
            setSaveState('idle');
          });
        }
      }
    })();
    saverRef.current = loop;
    return loop;
  }, [workspaceService, meetingDir, matterId, onChanged]);

  // Always-latest drainSaves, so the unmount cleanup (which registers once with
  // [] deps) drains through the current workspace/meeting, not a stale capture.
  const drainSavesRef = useRef(drainSaves);
  drainSavesRef.current = drainSaves;

  // Finding 1 (unmount edge): the SlidePanel unmounts this panel the instant the
  // send drawer closes. If that happens inside the 600ms autosave debounce, the
  // pending recipient edit would be dropped (the debounce timer is cleared and
  // never fires). On unmount, flush any pending save fire-and-forget so the edit
  // still lands on disk. Guarded to no-op when nothing is pending, which is the
  // case during React strict-mode's mount/cleanup/remount double-invoke (plan
  // equals lastSaved at first mount, so pendingPlanRef is null).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
      if (pendingPlanRef.current) {
        // eslint-disable-next-line lantern-async/no-silent-failure -- component is unmounting on drawer close; there is no UI left to surface a save error, and the parent still holds the last onChanged state
        void drainSavesRef.current().catch(() => undefined);
      }
    };
  }, []);

  // Reset local plan state only when the MEETING changes, never on every meta
  // update — otherwise an onChanged from our own save (or an unrelated meta
  // change like Mark reviewed) would overwrite a plan the advisor is editing.
  useEffect(() => {
    const resolved = resolveMeetingDeliveryPlan(metaRef.current);
    lastSavedJson.current = JSON.stringify(resolved);
    pendingPlanRef.current = null;
    setPlan(resolved);
    setPersonInput('');
    setRecipientError(null);
    setSaveState('idle');
    // meta is intentionally read via metaRef (not a dep) so a same-meeting meta
    // change never resets a plan the advisor is editing; only meetingDir resets.
  }, [meetingDir]);

  useEffect(() => {
    const request = { cancelled: false };
    void (async () => {
      const next = await mailConnectedAccounts();
      if (request.cancelled) return;
      setAccounts(next);
      setSelectedAccountKey((current) => current || accountKey(next[0]));
    })().catch(() => {
      if (!request.cancelled) setAccounts([]);
    });
    return () => { request.cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!workspaceService || !matter) {
      setGroups([]);
      return () => { cancelled = true; };
    }
    void loadMeetingRecipientGroups(workspaceService, matter)
      .then((file) => { if (!cancelled) setGroups(file.groups); })
      .catch(() => { if (!cancelled) setGroups([]); });
    return () => { cancelled = true; };
  }, [workspaceService, matter]);

  // Auto-save (item 2): debounce plan changes to disk. No separate Save button.
  // The change goes to `pendingPlanRef` immediately (so a flush can pick up the
  // very latest edit) but the drain is debounced.
  useEffect(() => {
    if (!workspaceService) return;
    if (JSON.stringify(plan) === lastSavedJson.current) return;
    setSaveState('saving');
    pendingPlanRef.current = plan;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void drainSaves().catch((err: unknown) => {
        setRecipientError(err instanceof Error ? err.message : String(err));
        setSaveState('idle');
      });
    }, AUTOSAVE_DELAY_MS);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [plan, workspaceService, drainSaves]);

  // Flush any pending debounce and guarantee disk == current plan before a
  // review/send, so meetingArtifactDelivery's opened-vs-disk plan guard never
  // false-triggers "review again". Drains serially until nothing is pending.
  const flushSave = useCallback(async () => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    if (!workspaceService) return;
    if (JSON.stringify(plan) !== lastSavedJson.current) {
      pendingPlanRef.current = plan;
      setSaveState('saving');
    }
    await drainSaves();
    while (pendingPlanRef.current) await drainSaves();
  }, [plan, workspaceService, drainSaves]);

  const calendarRecipients = useMemo(
    () => calendarAttendeesToRecipients(meta.calendarEvent),
    [meta.calendarEvent],
  );
  const personRows = useMemo(
    () => mergeRecipients([...calendarRecipients, ...recipientsInDeliveryPlan(plan)]),
    [calendarRecipients, plan],
  );
  // Finding 3 — restore the suggestion source (client emails from
  // matter.meetingKeys, calendar attendees, and people from the saved plan) so
  // the advisor can one-click a known recipient instead of only calendar +
  // already-added people. Suggestions already in the matrix are dropped.
  const suggestionPeople = useMemo(() => {
    const present = new Set(personRows.map((row) => row.email));
    return buildMeetingRecipientSuggestions(meta, matter).filter((person) => !present.has(person.email));
  }, [meta, matter, personRows]);

  const togglePerson = (recipient: MeetingRecipient) => {
    setRecipientError(null);
    setPlan((current) => {
      const selectedCount = MEETING_ARTIFACTS.filter((artifact) =>
        current.artifacts[artifact].some((candidate) => candidate.email === recipient.email),
      ).length;
      return setRecipientForEveryArtifact(current, recipient, selectedCount === 0);
    });
  };

  const togglePersonArtifact = (recipient: MeetingRecipient, artifact: MeetingArtifact) => {
    setRecipientError(null);
    setPlan((current) => setRecipientForArtifact(
      current,
      artifact,
      recipient,
      !current.artifacts[artifact].some((candidate) => candidate.email === recipient.email),
    ));
  };

  const addManualPerson = () => {
    const email = normalizeEmailAddress(personInput);
    if (!email) {
      setRecipientError(t('meetings.entry.recipients.invalid-email'));
      return;
    }
    // Default a brand-new manual recipient to every item on (item 3).
    setPlan((current) => setRecipientForEveryArtifact(current, { email, source: 'manual' }, true));
    setPersonInput('');
    setRecipientError(null);
  };

  const addSuggestion = (recipient: MeetingRecipient) => {
    setRecipientError(null);
    // Adding a known person defaults to every item on, same as typing them.
    setPlan((current) => setRecipientForEveryArtifact(current, { ...recipient, source: 'manual' }, true));
  };

  const removePerson = (recipient: MeetingRecipient) => {
    setRecipientError(null);
    setPlan((current) => {
      let next = current;
      for (const artifact of MEETING_ARTIFACTS) {
        next = removeRecipientFromArtifact(next, artifact, recipient.email);
      }
      return next;
    });
  };

  const handleAddGroup = (group: MeetingRecipientGroup) => {
    setRecipientError(null);
    setPlan((current) => addGroupToMeetingDeliveryPlan(current, group));
  };

  const handleSaveGroup = async () => {
    if (!workspaceService) return;
    setSavingGroup(true);
    setRecipientError(null);
    try {
      const file = await saveMeetingRecipientGroup(
        workspaceService,
        matter,
        groupName,
        recipientsInDeliveryPlan(plan),
      );
      setGroups(file.groups);
      setGroupName('');
    } catch (err) {
      setRecipientError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingGroup(false);
    }
  };

  const title = meetingSendTitle(meta, t);
  const availability = useMemo(
    () => buildMeetingArtifactAvailability({ hasAudio, hasTranscript, hasNotes, summaryReady }),
    [hasAudio, hasTranscript, hasNotes, summaryReady],
  );
  // Build the preview from the CURRENT (possibly not-yet-flushed) plan so the
  // ready count and Review-send enablement track edits immediately.
  const previewMeta = useMemo<MeetingMeta>(() => ({ ...meta, deliveryPlan: plan }), [meta, plan]);
  const preview = useMemo(
    () => buildMeetingSendPreview({ meta: previewMeta, availability, title, clientName, t }),
    [previewMeta, availability, title, clientName, t],
  );
  const sendLog = meetingSendLogSummary(meta);
  const sentArtifacts = useMemo(
    () => new Set(sendLog.filter((entry) => entry.status === 'sent').map((entry) => entry.artifact)),
    [sendLog],
  );
  const selectedAccount = accounts.find((account) => accountKey(account) === selectedAccountKey) ?? accounts[0] ?? null;
  const localOnly = isPersistedLocalOnly();
  const canReview = Boolean(workspaceService && selectedAccount && preview.items.length > 0 && meta.reviewedAt && !localOnly);

  const handleReview = useCallback(() => {
    void (async () => {
      setError(null);
      setStatus(null);
      try {
        await flushSave();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      setConfirmOpen(true);
    })().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });
  }, [flushSave]);

  const handleConfirmSend = async () => {
    if (!workspaceService || !selectedAccount) return;
    setSending(true);
    setError(null);
    setStatus(null);
    try {
      const entries = await sendMeetingArtifacts({
        workspaceService,
        meetingDir,
        workspaceRoot,
        workspaceGeneration,
        matterId,
        meta: previewMeta,
        account: selectedAccount,
        preview,
        availability,
        clientName,
        t,
        transcriptText: transcriptToText(transcript),
        buildSummaryDocxBytes,
        audit,
      });
      const raw = await workspaceService.readFile(`${meetingDir}/meeting.json`);
      onChanged(JSON.parse(raw) as MeetingMeta);
      setConfirmOpen(false);
      const failed = entries.filter((entry) => entry.status === 'failed').length;
      setStatus(failed > 0
        ? `${t('meetings.entry.send.sent-with-errors', { count: entries.length, failed, total: entries.length })} ${entries
          .filter((entry) => entry.status === 'failed')
          .map((entry) => `${entry.artifactLabel}: ${entry.error ?? t('meetings.entry.send.failed-without-message')}`)
          .join(' ')}`
        : t('meetings.entry.send.sent', { count: entries.length }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      data-testid="meeting-send-panel"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-lg)' }}
    >
      {/* Recipients — one person-first matrix for both calendar and manual. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
        <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)' }}>
          {t('meetings.entry.recipients.title')}
        </div>
        <p style={{ margin: 0, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 1.5 }}>
          {t('meetings.entry.recipients.description')}
        </p>

        <div data-testid="meeting-recipient-people" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {personRows.map((recipient) => {
            const selectedCount = MEETING_ARTIFACTS.filter((artifact) =>
              plan.artifacts[artifact].some((candidate) => candidate.email === recipient.email),
            ).length;
            return (
              <div
                key={recipient.email}
                data-testid={`meeting-recipient-person-row-${recipient.email}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(160px, 1fr) minmax(220px, 1.4fr) auto',
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
                        title={artifactHelp(artifact, t)}
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
                        <span>{artifactLabel(artifact, t)}</span>
                      </label>
                    );
                  })}
                </div>
                <button
                  type="button"
                  data-testid={`meeting-recipient-remove-person-${recipient.email}`}
                  aria-label={t('meetings.entry.recipients.remove', { email: recipient.email })}
                  onClick={() => { removePerson(recipient); }}
                  style={{ border: 'none', background: 'transparent', padding: 4, cursor: 'pointer', display: 'inline-flex', color: 'var(--color-muted-foreground)', justifySelf: 'end' }}
                >
                  <X style={{ width: 13, height: 13 }} />
                </button>
              </div>
            );
          })}
          {suggestionPeople.length > 0 && (
            <div data-testid="meeting-recipient-suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                {t('meetings.entry.recipients.suggestions-label')}
              </span>
              {suggestionPeople.map((person) => (
                <button
                  key={person.email}
                  type="button"
                  data-testid={`meeting-recipient-suggestion-${person.email}`}
                  onClick={() => { addSuggestion(person); }}
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
                  {person.name || person.email}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, minWidth: 0, paddingTop: 4 }}>
            <input
              type="email"
              data-testid="meeting-recipient-input-person"
              value={personInput}
              onChange={(event) => { setPersonInput(event.target.value); setRecipientError(null); }}
              onKeyDown={(event) => { if (event.key === 'Enter') addManualPerson(); }}
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
              aria-label={t('meetings.entry.recipients.add-person')}
              title={t('meetings.entry.recipients.add-person')}
              onClick={addManualPerson}
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
            </button>
          </div>
        </div>

        {/* Saved groups — folded behind a disclosure (item 4). */}
        <div data-testid="meeting-recipient-groups" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)', borderTop: '1px solid var(--kp-divider)', paddingTop: 'var(--kp-space-sm)' }}>
          <button
            type="button"
            data-testid="meeting-recipient-groups-toggle"
            aria-expanded={groupsOpen}
            onClick={() => { setGroupsOpen((open) => !open); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', fontFamily: 'inherit', alignSelf: 'flex-start' }}
          >
            {groupsOpen ? <ChevronDown style={{ width: 13, height: 13 }} /> : <ChevronRight style={{ width: 13, height: 13 }} />}
            <Users style={{ width: 13, height: 13 }} />
            {t('meetings.entry.recipients.groups-title')}
          </button>
          {groupsOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
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
                  onChange={(event) => { setGroupName(event.target.value); setRecipientError(null); }}
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
                  onClick={() => { void handleSaveGroup().catch((err: unknown) => { setRecipientError(err instanceof Error ? err.message : String(err)); }); }}
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
          )}
        </div>

        {recipientError && (
          <div data-testid="meeting-recipients-status" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-destructive)' }}>
            {recipientError}
          </div>
        )}
        {!recipientError && saveState !== 'idle' && (
          <div data-testid="meeting-recipients-status" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {saveState === 'saving'
              ? <><Loader2 className="animate-spin" style={{ width: 12, height: 12 }} />{t('meetings.entry.recipients.saving')}</>
              : <><Check style={{ width: 12, height: 12 }} />{t('meetings.entry.recipients.saved')}</>}
          </div>
        )}
      </div>

      {/* Send — account, ready count, trust note, and the single primary. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)', borderTop: '1px solid var(--kp-divider)', paddingTop: 'var(--kp-space-md)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', maxWidth: 320 }}>
          {t('meetings.entry.send.account-label')}
          <select
            data-testid="meeting-send-account"
            value={selectedAccountKey}
            onChange={(event) => { setSelectedAccountKey(event.target.value); }}
            disabled={accounts.length === 0}
            style={{
              border: '1px solid var(--kp-divider)',
              borderRadius: 'var(--radius-md)',
              padding: '7px 9px',
              color: 'var(--color-foreground)',
              background: 'var(--color-background)',
              fontSize: 'var(--kp-font-xs)',
              fontFamily: 'inherit',
            }}
          >
            {accounts.length === 0 ? (
              <option value="">{t('meetings.entry.send.no-account')}</option>
            ) : accounts.map((account) => (
              <option key={accountKey(account)} value={accountKey(account)}>{account.label}</option>
            ))}
          </select>
        </label>

        <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>
          {!meta.reviewedAt && t('meetings.entry.send.needs-review')}
          {meta.reviewedAt && preview.items.length === 0 && t('meetings.entry.send.no-items')}
          {localOnly && t('meetings.entry.send.local-only-blocked')}
          {preview.items.length > 0 && !localOnly && (
            <span data-testid="meeting-send-ready-count">{t('meetings.entry.send.ready-count', { count: preview.items.length })}</span>
          )}
        </div>

        {preview.missing.length > 0 && (
          <div data-testid="meeting-send-missing" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
            <AlertTriangle style={{ width: 13, height: 13 }} />
            {t('meetings.entry.send.missing', { artifacts: preview.missing.map((artifact) => artifactLabelFor(artifact, t)).join(', ') })}
          </div>
        )}

        {/* Trust note at the action point (item 12, protected). */}
        <p data-testid="meeting-send-trust-note" style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: 6, color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)', lineHeight: 1.5 }}>
          {t('meetings.entry.send.privacy-note')}
        </p>

        <button
          type="button"
          data-testid="meeting-send-review"
          onClick={handleReview}
          disabled={!canReview}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--kp-divider)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--kp-accent)',
            color: 'var(--color-primary-foreground)',
            padding: '8px 13px',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            fontFamily: 'inherit',
            cursor: canReview ? 'pointer' : 'not-allowed',
            opacity: canReview ? 1 : 0.6,
          }}
        >
          <Send style={{ width: 14, height: 14 }} />
          {t('meetings.entry.send.review-button')}
        </button>

        {sendLog.length > 0 && (
          <div data-testid="meeting-send-log" style={{ borderTop: '1px solid var(--kp-divider)', paddingTop: 'var(--kp-space-sm)', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <button
              type="button"
              data-testid="meeting-send-log-toggle"
              aria-expanded={logOpen}
              onClick={() => { setLogOpen((open) => !open); }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--kp-navy)', fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', fontFamily: 'inherit', alignSelf: 'flex-start' }}
            >
              {logOpen ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
              {t('meetings.entry.send.log-title')}
            </button>
            {(logOpen ? sendLog.slice(-8) : sendLog.slice(-1)).reverse().map((entry: MeetingSendLogEntry) => (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
                {entry.status === 'sent' && <Check style={{ width: 12, height: 12, color: 'var(--kp-accent)' }} />}
                {entry.status !== 'sent' && <AlertTriangle style={{ width: 12, height: 12 }} />}
                <span>{t('meetings.entry.send.log-row', {
                  status: entry.status,
                  artifact: entry.artifactLabel,
                  count: entry.recipients.length,
                  date: new Date(entry.sentAt).toLocaleString(),
                })}</span>
              </div>
            ))}
          </div>
        )}

        {(error || status) && (
          <div data-testid="meeting-send-status" style={{ fontSize: 'var(--kp-font-xs)', color: error ? 'var(--color-destructive)' : 'var(--color-muted-foreground)' }}>
            {error ?? status}
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('meetings.entry.send.confirm-title')}</DialogTitle>
          </DialogHeader>
          <div data-testid="meeting-send-confirm-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)', color: 'var(--color-foreground)', fontSize: 'var(--kp-font-sm)' }}>
            <p style={{ margin: 0, color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>
              {t('meetings.entry.send.confirm-privacy', { account: selectedAccount?.label ?? '' })}
            </p>
            {preview.items.map((item) => (
              <div key={item.artifact} data-testid={`meeting-send-confirm-${item.artifact}`} style={{ border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-md)', padding: 'var(--kp-space-sm)' }}>
                <div style={{ color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)' }}>{item.artifactLabel}</div>
                {sentArtifacts.has(item.artifact) && (
                  <div style={{ marginTop: 4, color: 'var(--color-destructive)', fontWeight: 'var(--kp-weight-semibold)' }}>
                    {t('meetings.entry.send.send-again-warning', { artifact: item.artifactLabel })}
                  </div>
                )}
                <div>{t('meetings.entry.send.to-line', { recipients: item.recipients.map(formatRecipient).join(', ') })}</div>
                <div>{t('meetings.entry.send.subject-line', { subject: item.subject })}</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{t('meetings.entry.send.body-line', { body: item.body })}</div>
                <div>{t('meetings.entry.send.attachment-line', { attachment: item.attachmentName })}</div>
              </div>
            ))}
            {error && <div style={{ color: 'var(--color-destructive)' }}>{error}</div>}
          </div>
          <DialogFooter>
            <DialogButton type="button" variant="outline" onClick={() => { setConfirmOpen(false); }} disabled={sending}>
              {t('common.actions.cancel')}
            </DialogButton>
            <DialogButton data-testid="meeting-send-confirm" type="button" onClick={() => { void handleConfirmSend().catch((err: unknown) => { setError(err instanceof Error ? err.message : String(err)); }); }} disabled={sending || !canReview}>
              {sending ? t('meetings.entry.send.sending') : t('meetings.entry.send.confirm-button')}
            </DialogButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function accountKey(account: ConnectedAccount | undefined): string {
  return account ? `${account.provider}:${account.account}` : '';
}

function formatRecipient(recipient: { email: string; name?: string }): string {
  return recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email;
}

function transcriptToText(transcript: TranscriptFile | null): string {
  if (!transcript) return '';
  return transcript.segments
    .map((seg) => `${mmss(seg.startMs)} ${seg.speaker}: ${seg.text}`)
    .join('\n');
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

export default MeetingSendPanel;
