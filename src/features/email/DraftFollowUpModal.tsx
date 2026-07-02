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

  // On open: load accounts, suggest To from the client's mail, generate the draft.
  useEffect(() => {
    if (!open) return;
    setStatus('generating');
    setError(null);
    setBody('');
    void (async () => {
      try {
        const accts = await mailConnectedAccounts();
        setAccounts(accts);
        setAccountIdx(0);
        try {
          const page = await mailListMessagesByMatter(matterId, [], {
            sortBy: 'date',
            sortDesc: true,
            limit: 50,
            offset: 0,
          });
          const suggestion = suggestClientEmail(page.items);
          if (suggestion) setTo(suggestion);
        } catch {
          // No mail for this client (or browser mode) — To stays empty, user types it.
        }
        const { provider, providerId } = await resolveEmailProvider();
        assertLocalOnlyAllowsSend(providerId);
        const prompt = buildFollowUpPrompt({ noteName, noteContent });
        const response = await provider.sendMessage(prompt);
        const applied = applyDraftResponse(noteName, response.content);
        setSubject(applied.subject);
        setBody(applied.body);
        setStatus('idle');
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
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
