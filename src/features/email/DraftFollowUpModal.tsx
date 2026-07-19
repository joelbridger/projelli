import { useEffect, useRef, useState } from 'react';
import { X, Loader2, Send, Save, Sparkles } from 'lucide-react';
import {
  mailConnectedAccounts,
  mailListMessagesByMatter,
  mailSaveDraft,
  mailSend,
  composeMailAccountId,
  type ConnectedAccount,
} from '@/platform/utils/mail-commands';
import {
  resolveEmailProvider,
  assertLocalOnlyAllowsSend,
  type ResolvedEmailProvider,
} from '@/features/email/resolveEmailProvider';
import {
  buildFollowUpPrompt,
  applyDraftResponse,
  suggestClientEmail,
  draftBodyToHtml,
  splitBodyWithCitations,
  appendCitationFootnotes,
  draftStructuredOutputOptions,
  type DraftCitation,
  type RawDraftResponse,
} from '@/features/email/followUpDraft';
import { CiteChip } from '@/ui/kp/CiteChip';
import { FileText } from 'lucide-react';
import { parseRecipients } from '@/features/email/emailWorkspaceHelpers';
import {
  emailMatterScope,
  effectiveModeForDestination,
  logEmailAuditEntry,
} from '@/features/email/emailAuditLog';
import { providerDisplayName } from '@/platform/privacy/egress';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useMatters } from '@/platform/matter/matterStore';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';
import { sendPreparedStructuredWithEgressAudit } from '@/platform/privacy/promptPreparation';

interface DraftFollowUpModalBaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  matterId: string;
}

export interface StandardDraftFollowUpModalProps extends DraftFollowUpModalBaseProps {
  mode?: 'standard';
  noteName: string;
  noteContent: string;
}

export interface OutlookDraftsOnlySavedResult {
  readonly draftId: string;
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly draft: {
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  };
}

export interface OutlookDraftsOnlyFollowUpModalProps extends DraftFollowUpModalBaseProps {
  readonly mode: 'outlook-drafts-only';
  readonly meetingId: string;
  readonly householdRef: string;
  readonly draft: {
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  };
  readonly savedToDrafts?: boolean;
  readonly inline?: boolean;
  readonly onDraftChange?: (draft: {
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  }) => void;
  readonly onDraftSaved?: (
    result: OutlookDraftsOnlySavedResult
  ) => void | Promise<void>;
}

export type DraftFollowUpModalProps =
  | StandardDraftFollowUpModalProps
  | OutlookDraftsOnlyFollowUpModalProps;

type Status =
  | 'loading'
  | 'ready'
  | 'generating'
  | 'idle'
  | 'saving'
  | 'sending'
  | 'saved'
  | 'sent'
  | 'error';

/**
 * Wave 0 "Draft follow-up": AI proposes a follow-up email from the open
 * note/document; the advisor reviews and either saves it into their REAL
 * mailbox Drafts folder (default) or sends it. Recipients come ONLY from the
 * user-controlled To field — never from the note or the AI output.
 *
 * R4a (Tier B trust guard): opening the modal must NOT send the note content
 * to the AI provider. Opening only loads the mailbox accounts, suggests a
 * recipient from local mail, and names the destination — then the modal shows
 * a preview of WHAT will be sent (which note, which client) and WHERE (the
 * provider). The confidential content leaves — and the egress is logged —
 * only when the advisor presses "Generate".
 *
 * R4b: the citations shown in the modal travel with the saved/sent draft as
 * source-named footnotes, so the recipient and the advisor's own record keep
 * the sourcing.
 */
export function DraftFollowUpModal(props: DraftFollowUpModalProps) {
  const { open, onOpenChange, matterId } = props;
  const draftsOnly = props.mode === 'outlook-drafts-only';
  const noteName = draftsOnly ? 'Meeting follow-up' : props.noteName;
  const noteContent = draftsOnly ? props.draft.body : props.noteContent;
  const inline = draftsOnly && props.inline === true;
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountIdx, setAccountIdx] = useState(0);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [citations, setCitations] = useState<DraftCitation[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // R4a: the destination provider name to show in the preview (null while
  // loading or when nothing resolves — e.g. no cloud key, local-only).
  const [providerName, setProviderName] = useState<string | null>(null);
  // R4a: the provider resolved on open is stored here (identity only — nothing
  // is sent) and reused by Generate, so the content still leaves only once.
  const resolvedRef = useRef<ResolvedEmailProvider | null>(null);
  // Codex review catch (P2): the To-suggestion query needs the real
  // folder→matter map, or account/folder-mapped mail (the normal case) never
  // matches and only manually-filed message overrides would be found.
  const matters = useMatters();
  // A monotonic token for the async Generate flow. Bumped whenever the modal
  // (re)opens and on each Generate, so a generate that resolves after the modal
  // was closed or reopened for a DIFFERENT note can't write the old note's
  // content/egress into the new one.
  const genTokenRef = useRef(0);
  const clientLabel = (() => {
    const m = matters.find((mm) => mm.id === matterId) as
      | { client?: string; name?: string }
      | undefined;
    return m?.client || m?.name || null;
  })();

  // On open: load accounts, suggest To from the client's mail, and resolve the
  // destination NAME for the preview. Deliberately does NOT build the prompt,
  // call the AI provider, or log egress — that all happens on Generate.
  useEffect(() => {
    if (!open) return;
    // Closing the modal (the `open` prop flips false) does not by itself stop
    // this in-flight async work, so guard every setState after an await.
    const lifecycle = { cancelled: false };
    const isCancelled = () => lifecycle.cancelled;
    // Supersede any Generate still in flight from a prior open of this modal.
    genTokenRef.current += 1;
    setStatus('loading');
    setError(null);
    setLoadFailed(false);
    setBody('');
    setSubject('');
    setCitations([]);
    setProviderName(null);
    resolvedRef.current = null;
    // Codex review catch (P2): reset every prior client's guess before the new
    // client's lookup runs, so a stale To can't survive into the new draft.
    setTo('');
    // Keep the Outlook-only capability on its own narrow path. It does not
    // resolve an AI provider, inspect client mail, or construct a Send action.
    if (draftsOnly) {
      void mailConnectedAccounts()
        .then((connected) => {
          if (isCancelled()) return;
          const accts = connected.filter(
            (account) => account.provider === 'm365'
          );
          setAccounts(accts);
          setAccountIdx(0);
          setTo(props.draft.to);
          setSubject(props.draft.subject);
          setBody(props.draft.body);
          setStatus(props.savedToDrafts ? 'saved' : 'idle');
        })
        .catch(() => {
          if (isCancelled()) return;
          setError('Outlook could not be checked. Try again.');
          setLoadFailed(true);
          setStatus('error');
        });
      return () => {
        lifecycle.cancelled = true;
      };
    }

    void (async () => {
      const connected = await mailConnectedAccounts();
      if (isCancelled()) return;
      const accts = connected;
      setAccounts(accts);
      // codex-review (smoke P0 #1): default to the first DRAFT-CAPABLE account.
      const draftCapableIdx = accts.findIndex((a) => a.provider !== 'imap');
      setAccountIdx(draftCapableIdx === -1 ? 0 : draftCapableIdx);
      // With no connected mailbox this feature is unusable (nowhere to
      // save/send), so stop here — the UI shows "connect an account".
      if (accts.length === 0) {
        setStatus('idle');
        return;
      }
      try {
        // An unassigned note's query would hit the SHARED unassigned-mail
        // bucket, so any suggestion could belong to an unrelated client —
        // skip the lookup and leave To empty rather than risk it.
        if (matterId !== UNASSIGNED_MATTER_ID) {
          const page = await mailListMessagesByMatter(
            matterId,
            buildMailMatterMap(matters),
            {
              sortBy: 'date',
              sortDesc: true,
              limit: 50,
              offset: 0,
            }
          );
          if (isCancelled()) return;
          const suggestion = suggestClientEmail(page.items);
          if (suggestion) setTo(suggestion);
        }
      } catch {
        // No mail for this client (or browser mode) — To stays empty.
        if (!isCancelled()) setTo('');
      }
      if (isCancelled()) return;
      // Resolve the provider IDENTITY only, to name the destination in the
      // preview and to reuse on Generate. This reads no content and sends
      // nothing to the provider; the note only leaves on the Generate click.
      try {
        const resolved = await resolveEmailProvider();
        if (isCancelled()) return;
        resolvedRef.current = resolved;
        setProviderName(providerDisplayName(resolved.providerId));
      } catch (e) {
        if (isCancelled()) return;
        // A personal install with no confidentiality choice yet, etc. Surface
        // it, but keep the modal open so the advisor can act.
        setError(e instanceof Error ? e.message : String(e));
      }
      if (isCancelled()) return;
      setStatus('ready');
    })().catch((e: unknown) => {
      if (isCancelled()) return;
      setError(e instanceof Error ? e.message : String(e));
      setLoadFailed(true);
      setStatus('error');
    });
    return () => {
      lifecycle.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadAttempt]);

  // R4a: the only path that sends the note content to the AI provider. Egress
  // is logged HERE (moved off open), immediately before the send.
  const handleGenerate = () => {
    if (draftsOnly) return;
    if (status === 'generating') return;
    setStatus('generating');
    setError(null);
    const token = ++genTokenRef.current;
    const superseded = () => genTokenRef.current !== token;
    void (async () => {
      try {
        const resolved = resolvedRef.current ?? (await resolveEmailProvider());
        if (superseded()) return;
        resolvedRef.current = resolved;
        const { provider, providerId, assuredAvailable } = resolved;
        assertLocalOnlyAllowsSend(providerId);
        const scope = emailMatterScope(matterId, undefined);
        const prompt = buildFollowUpPrompt({ noteName, noteContent });
        if (superseded()) return;
        const response =
          await sendPreparedStructuredWithEgressAudit<RawDraftResponse>({
            provider,
            providerId,
            model: provider.getMetadata().model,
            surface: 'follow_up_email_draft',
            prompt,
            parts: [
              {
                id: 'prompt',
                origin: 'open_file',
                label: 'Follow-up note',
                text: prompt,
              },
            ],
            options: draftStructuredOutputOptions,
            mode: assuredAvailable ? 'assured' : getConfidentialityMode(),
            auditMode: (egress) =>
              effectiveModeForDestination(egress.destination),
            assuredAvailable,
            ...(scope ? { scope } : {}),
            onAuditLog: (entry) => {
              logEmailAuditEntry({
                ...entry,
                metadata: { ...entry.metadata, noteName },
              });
            },
          });
        if (superseded()) return;
        const applied = applyDraftResponse(noteName, response, noteContent);
        setSubject(applied.subject);
        setBody(applied.body);
        setCitations(applied.citations);
        setStatus('idle');
      } catch (e) {
        if (superseded()) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })().catch((e: unknown) => {
      if (superseded()) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus('error');
    });
  };

  if (!open) return null;
  const account = accounts[accountIdx];
  const completeDraftsOnlyIdentity =
    !draftsOnly ||
    Boolean(
      props.meetingId.trim() &&
      props.householdRef.trim() &&
      props.matterId.trim()
    );
  const canSaveDraft =
    account != null &&
    (draftsOnly ? account.provider === 'm365' : account.provider !== 'imap') &&
    completeDraftsOnlyIdentity;
  const toArr = parseRecipients(to);
  const generated =
    body.trim() !== '' ||
    status === 'idle' ||
    status === 'saved' ||
    status === 'sent';
  // Save/Send are actionable only in an editable state (idle, or after a
  // recoverable error) with a recipient + body — NEVER while in flight
  // ('saving'/'sending') and NEVER after a terminal action ('sent'/'saved'),
  // so a second click can't fire a DUPLICATE real email or draft (coordinator
  // review — this restores the terminal-state guard the original `!== 'idle'`
  // check provided before the R4a rewrite).
  const canAct =
    (status === 'idle' || status === 'error') &&
    toArr.length > 0 &&
    body.trim() !== '';
  // Generate is available once the destination is resolved ('ready') AND again
  // after a recoverable failure ('error') — otherwise a transient Generate
  // failure would leave the advisor stuck until they close and reopen the modal
  // (coordinator review). It's blocked only while loading or generating.
  const canGenerate = status === 'ready' || status === 'error';
  // Recomputed from the CURRENT body on every render, not stored — an edit
  // that removes a cited phrase drops its chip automatically.
  const citationSegments = splitBodyWithCitations(body, citations);
  const activeCitationCount = citationSegments.filter(
    (s) => s.type === 'citation'
  ).length;
  // R4b: exactly the citations still present in the (possibly edited) body —
  // the same set the advisor sees as chips — become the saved/sent footnotes.
  const activeCitations = citationSegments
    .filter(
      (s): s is { type: 'citation'; citation: DraftCitation } =>
        s.type === 'citation'
    )
    .map((s) => s.citation);
  const scopeHint = (msg: string) =>
    msg === 'scope_upgrade_required'
      ? 'Your email connection needs one more permission to save drafts. Open Settings and reconnect the account.'
      : msg;

  const handleSaveToDrafts = () => {
    // Keep the capability fail-closed even if a future caller invokes this
    // handler without going through the disabled-button guard.
    if (!account || !canSaveDraft || !canAct) return;
    setStatus('saving');
    setError(null);
    // R4b: the citation footnotes travel into the real mailbox draft.
    const bodyWithSources = appendCitationFootnotes(
      body,
      activeCitations,
      noteName
    );
    void mailSaveDraft(
      composeMailAccountId(account.provider, account.account),
      toArr,
      subject,
      draftBodyToHtml(bodyWithSources)
    )
      .then(async (draftId) => {
        const saveScope = emailMatterScope(matterId, undefined);
        logEmailAuditEntry({
          action: 'email.draft_saved',
          description: `Saved a follow-up draft to your ${account.provider === 'gmail' ? 'Gmail' : 'Outlook'} Drafts (${String(toArr.length)} recipient(s))`,
          model: undefined,
          inputs: {},
          outputs: { recipientCount: toArr.length },
          userDecision: 'approved',
          metadata: {
            account: account.account,
            mailProvider: account.provider,
            ...(saveScope ? { scope: saveScope } : {}),
          },
        });
        setStatus('saved');
        if (draftsOnly) {
          try {
            await props.onDraftSaved?.({
              draftId,
              meetingId: props.meetingId,
              householdRef: props.householdRef,
              matterId: props.matterId,
              draft: { to, subject, body },
            });
          } catch {
            // Outlook already accepted the draft. Never turn this into a
            // retryable Outlook failure that could create a duplicate draft.
            setError(
              'Saved to Outlook Drafts, but the local meeting status could not be updated.'
            );
          }
        }
      })
      .catch((e: unknown) => {
        setError(
          draftsOnly
            ? 'The draft was not saved to Outlook. Check the connection and try again.'
            : scopeHint(e instanceof Error ? e.message : String(e))
        );
        setStatus('error');
      });
  };

  const handleSend = () => {
    // Defense in depth: even a future accidental event binding cannot turn the
    // Outlook-Drafts-only capability into a send capability.
    if (draftsOnly) return;
    if (!account) return;
    setStatus('sending');
    setError(null);
    // R4b: the citation footnotes travel into the sent email too.
    const bodyWithSources = appendCitationFootnotes(
      body,
      activeCitations,
      noteName
    );
    void mailSend(
      account.provider,
      account.account,
      toArr,
      [],
      [],
      subject,
      bodyWithSources,
      undefined
    )
      .then(() => {
        const sendScope = emailMatterScope(matterId, undefined);
        logEmailAuditEntry({
          action: 'email.send',
          description: `Sent a follow-up email (${String(toArr.length)} recipient(s))`,
          model: undefined,
          inputs: {},
          outputs: { recipientCount: toArr.length },
          userDecision: 'approved',
          metadata: {
            account: account.account,
            mailProvider: account.provider,
            ...(sendScope ? { scope: sendScope } : {}),
          },
        });
        setStatus('sent');
      })
      .catch((e: unknown) => {
        setError(scopeHint(e instanceof Error ? e.message : String(e)));
        setStatus('error');
      });
  };

  const labelStyle: React.CSSProperties = {
    width: 60,
    flexShrink: 0,
    fontSize: 'var(--kp-font-2xs)',
    fontWeight: 'var(--kp-weight-semibold)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-muted-foreground)',
  };
  const inputStyle: React.CSSProperties = {
    flex: 1,
    border: '1px solid var(--color-border)',
    borderRadius: 5,
    padding: '5px 8px',
    fontSize: 'var(--kp-font-sm)',
    fontFamily: 'var(--font-sans)',
    background: '#fff',
    color: 'var(--color-foreground)',
  };

  const updateDraft = (
    next: Partial<{
      readonly to: string;
      readonly subject: string;
      readonly body: string;
    }>
  ) => {
    if (!draftsOnly) return;
    setStatus('idle');
    setError(null);
    props.onDraftChange?.({
      to: next.to ?? to,
      subject: next.subject ?? subject,
      body: next.body ?? body,
    });
  };

  return (
    <div
      data-testid="draft-followup-modal"
      data-capability-mode={draftsOnly ? 'outlook-drafts-only' : 'standard'}
      style={
        inline
          ? { width: '100%' }
          : {
              position: 'fixed',
              inset: 0,
              zIndex: 100,
              background: 'rgba(0,0,0,0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }
      }
      onClick={(e) => {
        if (!inline && e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: inline ? 'none' : 'var(--kp-shadow-3)',
          width: inline ? '100%' : 600,
          maxWidth: '95vw',
          maxHeight: inline ? 'none' : '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: inline ? '1px solid var(--color-border)' : undefined,
        }}
      >
        {/* Modal header */}
        {!inline && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-space-xs)`,
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontSize: 'var(--kp-font-md)',
                  fontWeight: 'var(--kp-weight-bold)',
                  color: 'var(--kp-navy)',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {draftsOnly
                  ? 'Save follow-up to Outlook Drafts'
                  : 'Draft follow-up'}
              </span>
              <button
                type="button"
                data-testid="followup-close"
                onClick={() => {
                  onOpenChange(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: 4,
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--color-muted-foreground)',
                  borderRadius: 4,
                }}
              >
                <X
                  style={{
                    width: 'var(--kp-icon-md)',
                    height: 'var(--kp-icon-md)',
                    strokeWidth: 2,
                  }}
                />
              </button>
            </div>
            <span
              style={{
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
                lineHeight: 1.5,
              }}
            >
              {draftsOnly ? (
                'Review this meeting recap, then save it to Outlook Drafts. This action never sends email.'
              ) : (
                <>
                  A follow-up email drafted from &ldquo;{noteName}&rdquo;.
                  Review it, then save it to your own Drafts. Nothing sends
                  until you send it yourself.
                </>
              )}
            </span>
          </div>
        )}

        {/* Modal body (scrollable) */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-card-pad)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--kp-space-xs)',
          }}
        >
          {status === 'loading' ? (
            <div
              data-testid={
                draftsOnly ? 'meeting-follow-up-loading' : 'followup-loading'
              }
              aria-live="polite"
              style={{
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
                padding: '8px 0',
              }}
            >
              {draftsOnly ? 'Checking Outlook.' : 'Loading email accounts.'}
            </div>
          ) : accounts.length === 0 ? (
            draftsOnly && loadFailed ? (
              <div
                data-testid="meeting-follow-up-local-error"
                role="alert"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: 8,
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--kp-danger)',
                  padding: '8px 0',
                }}
              >
                <span>
                  {error ?? 'Outlook could not be checked. Try again.'}
                </span>
                <button
                  type="button"
                  data-testid="meeting-follow-up-retry"
                  onClick={() => {
                    setLoadAttempt((value) => value + 1);
                  }}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 5,
                    background: 'var(--color-background)',
                    padding: '6px 10px',
                    cursor: 'pointer',
                  }}
                >
                  Try again
                </button>
              </div>
            ) : (
              <div
                data-testid="followup-no-accounts"
                style={{
                  fontSize: 'var(--kp-font-xs)',
                  color: 'var(--color-muted-foreground)',
                  padding: '8px 0',
                }}
              >
                {draftsOnly
                  ? 'Connect Outlook in Settings before saving this follow-up to Drafts.'
                  : 'Connect an email account in Settings to draft follow-ups.'}
              </div>
            )
          ) : (
            <>
              {accounts.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={labelStyle}>Account</span>
                  <select
                    data-testid="followup-account"
                    value={accountIdx}
                    onChange={(e) => {
                      setAccountIdx(Number(e.target.value));
                    }}
                    style={inputStyle}
                  >
                    {accounts.map((a, i) => (
                      <option key={`${a.provider}:${a.account}`} value={i}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* R4a: the pre-generate preview — what WILL be sent and where.
                  Shown until the advisor presses Generate. */}
              {!generated && (
                <div
                  data-testid="followup-generate-preview"
                  style={{
                    border: '1px solid var(--color-input)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--kp-bg-soft, #f8f9fb)',
                    padding: '11px 13px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--kp-navy)',
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ fontWeight: 'var(--kp-weight-semibold)' }}>
                    Nothing has been sent yet.
                  </span>
                  <span>
                    Press Generate to send this note
                    {clientLabel ? (
                      <>
                        {' '}
                        for <strong>{clientLabel}</strong>
                      </>
                    ) : null}{' '}
                    to{' '}
                    <strong data-testid="followup-destination">
                      {providerName ?? 'your AI provider'}
                    </strong>{' '}
                    and draft a follow-up. Its content leaves your machine only
                    when you press Generate.
                  </span>
                </div>
              )}

              {/* To */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={labelStyle}>To</span>
                  <input
                    type="text"
                    data-testid="followup-to"
                    placeholder="client@example.com"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      updateDraft({ to: e.target.value });
                    }}
                    style={inputStyle}
                  />
                </div>
                <div
                  style={{
                    marginLeft: 68,
                    marginTop: 5,
                    fontSize: 'var(--kp-font-2xs)',
                    color: 'var(--color-muted-foreground)',
                  }}
                >
                  {draftsOnly
                    ? 'Review the recipients before saving. Outlook will not send this draft.'
                    : 'Filled in from your email history with this client. You can change it.'}
                </div>
              </div>

              {/* Subject — only once generated */}
              {generated && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={labelStyle}>Subject</span>
                  <input
                    type="text"
                    data-testid="followup-subject"
                    value={subject}
                    onChange={(e) => {
                      setSubject(e.target.value);
                      updateDraft({ subject: e.target.value });
                    }}
                    style={inputStyle}
                  />
                </div>
              )}

              {/* Citation preview — derived from the current body text. */}
              {generated &&
                citationSegments.some((seg) => seg.type === 'citation') && (
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
                  >
                    <span style={labelStyle}>Cited</span>
                    <div
                      data-testid="followup-citation-preview"
                      style={{
                        border: '1px solid var(--color-input)',
                        borderRadius: 'var(--radius-md)',
                        background: '#fff',
                        padding: '10px 12px',
                        fontSize: 'var(--kp-font-sm)',
                        lineHeight: 1.65,
                        color: 'var(--color-foreground)',
                      }}
                    >
                      {citationSegments.map((seg, i) =>
                        seg.type === 'text' ? (
                          <span key={i}>{seg.value}</span>
                        ) : (
                          <CiteChip
                            key={seg.citation.id}
                            docLabel={noteName}
                            quote={seg.citation.quote}
                            sourceLabel={seg.citation.label}
                            icon={<FileText size={11} strokeWidth={1.75} />}
                          >
                            {seg.citation.matchText}
                          </CiteChip>
                        )
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: 'var(--kp-font-2xs)',
                        color:
                          'var(--kp-text-faint, var(--color-muted-foreground))',
                      }}
                    >
                      {activeCitationCount === 1
                        ? 'One detail is cited from your notes. It travels with the saved draft.'
                        : `${String(activeCitationCount)} details are cited from your notes. They travel with the saved draft.`}
                    </span>
                  </div>
                )}

              {/* Message — only once generated */}
              {generated && (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
                >
                  <span style={labelStyle}>Message</span>
                  <textarea
                    data-testid="followup-body"
                    rows={12}
                    placeholder={status === 'generating' ? 'Drafting…' : ''}
                    value={body}
                    onChange={(e) => {
                      setBody(e.target.value);
                      updateDraft({ body: e.target.value });
                    }}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      fontSize: 'var(--kp-font-sm)',
                      fontFamily: 'var(--font-sans)',
                      lineHeight: 1.6,
                      background: '#fff',
                      color: 'var(--color-foreground)',
                      resize: 'vertical',
                    }}
                  />
                </div>
              )}

              {error != null && (
                <p
                  role="alert"
                  style={{
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--kp-danger)',
                  }}
                >
                  {error}
                </p>
              )}
              {draftsOnly && status === 'idle' && (
                <p
                  data-testid="meeting-follow-up-edited"
                  aria-live="polite"
                  style={{
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--color-muted-foreground)',
                  }}
                >
                  Edited locally. Nothing has been saved to Outlook yet.
                </p>
              )}
              {status === 'saved' && (
                <p
                  data-testid={
                    draftsOnly ? 'meeting-follow-up-saved' : undefined
                  }
                  style={{
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--kp-success, #0a4d38)',
                  }}
                >
                  {draftsOnly
                    ? 'Saved to Outlook Drafts. Nothing was sent.'
                    : 'Saved to your Drafts folder. Review and send from your email.'}
                </p>
              )}
              {status === 'sent' && (
                <p
                  style={{
                    fontSize: 'var(--kp-font-xs)',
                    color: 'var(--kp-success, #0a4d38)',
                  }}
                >
                  Sent.
                </p>
              )}
            </>
          )}
        </div>

        {/* Modal footer */}
        {accounts.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: `var(--kp-space-xs) var(--kp-card-pad)`,
              borderTop: '1px solid var(--color-border)',
            }}
          >
            {!generated ? (
              <>
                <span
                  style={{
                    flex: 1,
                    fontSize: 'var(--kp-font-2xs)',
                    color: 'var(--color-muted-foreground)',
                    lineHeight: 1.4,
                  }}
                >
                  The note leaves your machine only when you press Generate.
                </span>
                {!draftsOnly && (
                  <button
                    type="button"
                    data-testid="followup-generate"
                    disabled={!canGenerate}
                    onClick={handleGenerate}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 18px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--kp-font-sm)',
                      fontWeight: 'var(--kp-weight-semibold)',
                      background: 'var(--kp-action-bg)',
                      color: 'var(--kp-action-fg)',
                      border: 'none',
                      cursor: !canGenerate ? 'default' : 'pointer',
                      opacity: !canGenerate ? 0.6 : 1,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {status === 'generating' ? (
                      <Loader2
                        style={{
                          width: 'var(--kp-icon-sm)',
                          height: 'var(--kp-icon-sm)',
                          strokeWidth: 2,
                          animation: 'spin 1s linear infinite',
                        }}
                      />
                    ) : (
                      <Sparkles
                        style={{
                          width: 'var(--kp-icon-sm)',
                          height: 'var(--kp-icon-sm)',
                          strokeWidth: 1.75,
                        }}
                      />
                    )}
                    Generate
                  </button>
                )}
              </>
            ) : (
              <>
                {canSaveDraft ? (
                  <span
                    style={{
                      flex: 1,
                      fontSize: 'var(--kp-font-2xs)',
                      color: 'var(--color-muted-foreground)',
                      lineHeight: 1.4,
                    }}
                  >
                    Saves as a draft in your mailbox. You send it from your own
                    inbox.
                  </span>
                ) : (
                  <span
                    data-testid="followup-save-drafts-explanation"
                    style={{
                      flex: 1,
                      fontSize: 'var(--kp-font-2xs)',
                      color: 'var(--color-muted-foreground)',
                      lineHeight: 1.4,
                    }}
                  >
                    {accounts.some((a) => a.provider !== 'imap')
                      ? 'This account can’t save drafts. Pick your Outlook or Gmail account above to save one.'
                      : 'This account can’t save drafts. Connect an Outlook or Gmail account in Settings to save one.'}
                  </span>
                )}
                {!draftsOnly && (
                  <button
                    type="button"
                    data-testid="followup-send"
                    disabled={!canAct}
                    onClick={handleSend}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 14px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--kp-font-sm)',
                      fontWeight: 'var(--kp-weight-semibold)',
                      background: '#fff',
                      color: 'var(--kp-navy)',
                      border: '1px solid var(--color-border)',
                      cursor: !canAct ? 'default' : 'pointer',
                      opacity: !canAct ? 0.6 : 1,
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    {status === 'sending' ? (
                      <Loader2
                        style={{
                          width: 'var(--kp-icon-sm)',
                          height: 'var(--kp-icon-sm)',
                          strokeWidth: 2,
                          animation: 'spin 1s linear infinite',
                        }}
                      />
                    ) : (
                      <Send
                        style={{
                          width: 'var(--kp-icon-sm)',
                          height: 'var(--kp-icon-sm)',
                          strokeWidth: 1.75,
                        }}
                      />
                    )}
                    Send
                  </button>
                )}
                <button
                  type="button"
                  data-testid="followup-save-drafts"
                  disabled={!canSaveDraft || !canAct}
                  onClick={handleSaveToDrafts}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 18px',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--kp-font-sm)',
                    fontWeight: 'var(--kp-weight-semibold)',
                    background: 'var(--kp-action-bg)',
                    color: 'var(--kp-action-fg)',
                    border: 'none',
                    cursor: !canSaveDraft || !canAct ? 'default' : 'pointer',
                    opacity: !canSaveDraft || !canAct ? 0.6 : 1,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {status === 'saving' ? (
                    <Loader2
                      style={{
                        width: 'var(--kp-icon-sm)',
                        height: 'var(--kp-icon-sm)',
                        strokeWidth: 2,
                        animation: 'spin 1s linear infinite',
                      }}
                    />
                  ) : (
                    <Save
                      style={{
                        width: 'var(--kp-icon-sm)',
                        height: 'var(--kp-icon-sm)',
                        strokeWidth: 1.75,
                      }}
                    />
                  )}
                  {draftsOnly ? 'Save to Outlook Drafts' : 'Save to my Drafts'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </div>
  );
}
