import { useEffect, useState } from 'react';
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
      .then(() => setStatus('saved'))
      .catch((e) => {
        setError(scopeHint(e instanceof Error ? e.message : String(e)));
        setStatus('error');
      });
  };

  const handleSend = () => {
    if (!account) return;
    setStatus('sending');
    setError(null);
    void mailSend(account.provider, account.account, toArr, [], [], subject, body, undefined)
      .then(() => setStatus('sent'))
      .catch((e) => {
        setError(scopeHint(e instanceof Error ? e.message : String(e)));
        setStatus('error');
      });
  };

  return (
    <div
      data-testid="draft-followup-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'rgba(15, 23, 42, 0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => onOpenChange(false)}
    >
      <div
        style={{
          background: 'var(--kp-surface, #fff)',
          borderRadius: 10,
          width: 'min(640px, 92vw)',
          maxHeight: '86vh',
          overflow: 'auto',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable lantern-i18n/no-hardcoded-string */}
        <strong>Draft follow-up from &ldquo;{noteName}&rdquo;</strong>
        {accounts.length === 0 ? (
          <p>Connect an email account in Settings to draft follow-ups.</p>
        ) : (
          <>
            {accounts.length > 1 && (
              <select
                data-testid="followup-account"
                value={accountIdx}
                onChange={(e) => setAccountIdx(Number(e.target.value))}
              >
                {accounts.map((a, i) => (
                  <option key={`${a.provider}:${a.account}`} value={i}>
                    {a.label}
                  </option>
                ))}
              </select>
            )}
            <input
              data-testid="followup-to"
              placeholder="To (client's email)"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <input
              data-testid="followup-subject"
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <textarea
              data-testid="followup-body"
              rows={12}
              placeholder={status === 'generating' ? 'Drafting…' : ''}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            {error != null && <p role="alert">{error}</p>}
            {status === 'saved' && <p>Saved to your Drafts folder. Review and send from your email.</p>}
            {status === 'sent' && <p>Sent.</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => onOpenChange(false)}>
                Close
              </button>
              <button
                type="button"
                data-testid="followup-send"
                disabled={status !== 'idle' || toArr.length === 0 || body.trim() === ''}
                onClick={handleSend}
              >
                Send
              </button>
              <button
                type="button"
                data-testid="followup-save-drafts"
                disabled={
                  !canSaveDraft || status !== 'idle' || toArr.length === 0 || body.trim() === ''
                }
                onClick={handleSaveToDrafts}
              >
                Save to my Drafts
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
