import { useEffect, useState } from 'react';
import { X, Loader2, Send, Save } from 'lucide-react';
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
} from '@/features/email/resolveEmailProvider';
import {
  buildFollowUpPrompt,
  applyDraftResponse,
  suggestClientEmail,
  draftBodyToHtml,
} from '@/features/email/followUpDraft';
import { parseRecipients } from '@/features/email/emailWorkspaceHelpers';
import {
  emailMatterScope,
  effectiveModeForDestination,
  logEmailAuditEntry,
} from '@/features/email/emailAuditLog';
import { auditEventToEntry } from '@/platform/audit/AuditService';
import { resolveEgress } from '@/platform/privacy/egress';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { useMatters } from '@/platform/matter/matterStore';
import { UNASSIGNED_MATTER_ID } from '@/platform/types/matter';
import { buildMailMatterMap } from '@/platform/rag/matterResolver';

export interface DraftFollowUpModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  noteName: string;
  noteContent: string;
  matterId: string;
}

type Status = 'idle' | 'generating' | 'saving' | 'sending' | 'saved' | 'sent' | 'error';

/**
 * Wave 0 "Draft follow-up": AI proposes a follow-up email from the open
 * note/document; the advisor reviews and either saves it into their REAL
 * mailbox Drafts folder (default) or sends it. Recipients come ONLY from the
 * user-controlled To field — never from the note or the AI output.
 */
export function DraftFollowUpModal({
  open,
  onOpenChange,
  noteName,
  noteContent,
  matterId,
}: DraftFollowUpModalProps) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountIdx, setAccountIdx] = useState(0);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  // Codex review catch (P2): the To-suggestion query needs the real
  // folder→matter map, or account/folder-mapped mail (the normal case) never
  // matches and only manually-filed message overrides would be found.
  const matters = useMatters();

  // On open: load accounts, suggest To from the client's mail, generate the draft.
  useEffect(() => {
    if (!open) return;
    // Coordinator review catch: this is a controlled modal — closing it (the
    // `open` prop flips false) does not by itself stop this in-flight async
    // work. Without this guard, an account lookup / provider resolution that
    // was still pending when the user dismissed the modal would carry on and
    // still send the note content to the AI provider after dismissal — a
    // privacy-sensitive egress happening behind the user's back. Checked
    // after every await, and always immediately before the two things that
    // must never fire post-close: building/logging the egress audit entry
    // and calling provider.sendMessage.
    let cancelled = false;
    setStatus('generating');
    setError(null);
    setBody('');
    // Codex review catch (P2): this is a controlled modal (the `open` prop can
    // toggle without unmounting) — reset every prior client's guess before the
    // new client's lookup runs, or a stale To/Subject from the last open can
    // survive alongside the newly generated body and become a follow-up sent
    // to the wrong client.
    setTo('');
    setSubject('');
    void (async () => {
      try {
        const accts = await mailConnectedAccounts();
        if (cancelled) return;
        setAccounts(accts);
        setAccountIdx(0);
        // Codex review catch (P1): with no connected mailbox this feature is
        // unusable (there is nowhere to save/send the draft), so never send
        // confidential note content to an AI provider for nothing. The UI
        // shows the "connect an account" message for this case.
        if (accts.length === 0) {
          setStatus('idle');
          return;
        }
        try {
          // Codex review catch (P1): an unassigned note's query would hit the
          // SHARED unassigned-mail bucket (every client's unmatched mail), so
          // any suggestion could belong to a completely unrelated client —
          // skip the lookup and leave To empty rather than risk it.
          if (matterId !== UNASSIGNED_MATTER_ID) {
            const page = await mailListMessagesByMatter(matterId, buildMailMatterMap(matters), {
              sortBy: 'date',
              sortDesc: true,
              limit: 50,
              offset: 0,
            });
            if (cancelled) return;
            const suggestion = suggestClientEmail(page.items);
            if (suggestion) setTo(suggestion);
          }
        } catch {
          // No mail for this client (or browser mode) — To stays empty, user types it.
        }
        if (cancelled) return;
        const { provider, providerId, assuredAvailable } = await resolveEmailProvider();
        // Coordinator review catch: the modal may have been closed while
        // provider resolution (keychain reads, etc.) was in flight — checked
        // here, BEFORE building the egress audit entry or the prompt at all.
        if (cancelled) return;
        assertLocalOnlyAllowsSend(providerId);
        // Codex review catch (P1): every other AI surface (Ask, redline, the
        // reply-draft flow this modal is modeled on) records an egress audit
        // entry BEFORE the send, so the Activity Log / confidentiality report
        // never misses a client-data AI request. Mirrors handleDraftWithAI's
        // exact construction in EmailViewer.tsx.
        const egress = resolveEgress({
          provider: providerId,
          mode: assuredAvailable ? 'assured' : getConfidentialityMode(),
          assuredAvailable,
        });
        const scope = emailMatterScope(matterId, undefined);
        const auditEntry = auditEventToEntry({
          type: 'egress',
          timestamp: new Date().toISOString(),
          payload: {
            provider: egress.provider,
            model: provider.getMetadata().model,
            mode: effectiveModeForDestination(egress.destination),
            destination: egress.destination,
            dataLeaves: egress.dataLeaves,
            ...(scope ? { scope } : {}),
          },
        });
        logEmailAuditEntry({
          ...auditEntry,
          metadata: { ...auditEntry.metadata, noteName },
        });
        const prompt = buildFollowUpPrompt({ noteName, noteContent });
        // Coordinator review catch: re-checked immediately before the actual
        // send, the one call that must never fire after the user dismissed
        // the modal.
        if (cancelled) return;
        const response = await provider.sendMessage(prompt);
        if (cancelled) return;
        const applied = applyDraftResponse(noteName, response.content);
        setSubject(applied.subject);
        setBody(applied.body);
        setStatus('idle');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  const account = accounts[accountIdx];
  const canSaveDraft = account != null && account.provider !== 'imap';
  const toArr = parseRecipients(to);
  const scopeHint = (msg: string) =>
    msg === 'scope_upgrade_required'
      ? 'Your email connection needs one more permission to save drafts. Open Settings and reconnect the account.'
      : msg;

  const handleSaveToDrafts = () => {
    if (!account) return;
    setStatus('saving');
    setError(null);
    void mailSaveDraft(
      composeMailAccountId(account.provider, account.account),
      toArr,
      subject,
      draftBodyToHtml(body),
    )
      .then(() => {
        // Codex review catch (P2): saving a draft writes client content into a
        // REAL external mailbox (Outlook/Gmail Drafts) — a durable record is
        // needed here exactly as it is for a direct send, or this outcome
        // disappears from the Activity Log / confidentiality report.
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
      })
      .catch((e: unknown) => {
        setError(scopeHint(e instanceof Error ? e.message : String(e)));
        setStatus('error');
      });
  };

  const handleSend = () => {
    if (!account) return;
    setStatus('sending');
    setError(null);
    void mailSend(account.provider, account.account, toArr, [], [], subject, body, undefined)
      .then(() => {
        // Codex review catch (P2): a durable record of the outbound send,
        // mirroring EmailViewer's reply-send audit entry exactly (message
        // id/subject/body never logged, only counts + provenance) so this
        // feature's sends show up in the same Activity Log / confidentiality
        // report as every other outbound email.
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

  return (
    <div
      data-testid="draft-followup-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--kp-shadow-3)',
          width: 600,
          maxWidth: '95vw',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-space-xs)`,
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 'var(--kp-font-md)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)' }}>
              Draft follow-up
            </span>
            <button
              type="button"
              data-testid="followup-close"
              onClick={() => { onOpenChange(false); }}
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
              <X style={{ width: 'var(--kp-icon-md)', height: 'var(--kp-icon-md)', strokeWidth: 2 }} />
            </button>
          </div>
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', lineHeight: 1.5 }}>
            A follow-up email drafted from &ldquo;{noteName}&rdquo;. Review it, then save it to your
            own Drafts. Nothing sends until you send it yourself.
          </span>
        </div>

        {/* Modal body (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-card-pad)`, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
          {accounts.length === 0 ? (
            <div data-testid="followup-no-accounts" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
              Connect an email account in Settings to draft follow-ups.
            </div>
          ) : (
            <>
              {accounts.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={labelStyle}>Account</span>
                  <select
                    data-testid="followup-account"
                    value={accountIdx}
                    onChange={(e) => { setAccountIdx(Number(e.target.value)); }}
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

              {/* To */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={labelStyle}>To</span>
                  <input
                    type="text"
                    data-testid="followup-to"
                    placeholder="client@example.com"
                    value={to}
                    onChange={(e) => { setTo(e.target.value); }}
                    style={inputStyle}
                  />
                </div>
                <div style={{ marginLeft: 68, marginTop: 5, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                  Filled in from your email history with this client. You can change it.
                </div>
              </div>

              {/* Subject */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={labelStyle}>Subject</span>
                <input
                  type="text"
                  data-testid="followup-subject"
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); }}
                  style={inputStyle}
                />
              </div>

              {/* Message */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={labelStyle}>Message</span>
                <textarea
                  data-testid="followup-body"
                  rows={12}
                  placeholder={status === 'generating' ? 'Drafting…' : ''}
                  value={body}
                  onChange={(e) => { setBody(e.target.value); }}
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

              {error != null && (
                <p role="alert" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-danger, #b91c1c)' }}>
                  {error}
                </p>
              )}
              {status === 'saved' && (
                <p style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-success, #0a4d38)' }}>
                  Saved to your Drafts folder. Review and send from your email.
                </p>
              )}
              {status === 'sent' && (
                <p style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-success, #0a4d38)' }}>Sent.</p>
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
            <span style={{ flex: 1, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', lineHeight: 1.4 }}>
              Saves as a draft in your mailbox. You send it from your own inbox.
            </span>
            <button
              type="button"
              data-testid="followup-send"
              disabled={status !== 'idle' || toArr.length === 0 || body.trim() === ''}
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
                cursor: status !== 'idle' || toArr.length === 0 || body.trim() === '' ? 'default' : 'pointer',
                opacity: status !== 'idle' || toArr.length === 0 || body.trim() === '' ? 0.6 : 1,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {status === 'sending' ? (
                <Loader2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
              ) : (
                <Send style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 1.75 }} />
              )}
              Send
            </button>
            <button
              type="button"
              data-testid="followup-save-drafts"
              disabled={!canSaveDraft || status !== 'idle' || toArr.length === 0 || body.trim() === ''}
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
                cursor:
                  !canSaveDraft || status !== 'idle' || toArr.length === 0 || body.trim() === ''
                    ? 'default'
                    : 'pointer',
                opacity:
                  !canSaveDraft || status !== 'idle' || toArr.length === 0 || body.trim() === ''
                    ? 0.6
                    : 1,
                fontFamily: 'var(--font-sans)',
              }}
            >
              {status === 'saving' ? (
                <Loader2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
              ) : (
                <Save style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 1.75 }} />
              )}
              Save to my Drafts
            </button>
          </div>
        )}
      </div>
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </div>
  );
}
