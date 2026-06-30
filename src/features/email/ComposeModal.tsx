import { useState, useEffect, useRef } from 'react';
import { X, Paperclip, Loader2, AlertTriangle } from 'lucide-react';
import {
  mailSend,
  type ConnectedAccount,
  type MailAttachmentInput,
} from '@/platform/utils/mail-commands';
import { mapMailError, parseRecipients } from './emailWorkspaceHelpers';

// ── Props ──────────────────────────────────────────────────────────────────

interface ComposeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: ConnectedAccount[];
  onOpenSettings?: (() => void) | undefined;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ComposeModal({ open, onOpenChange, accounts, onOpenSettings }: ComposeModalProps) {
  const [composeProvider, setComposeProvider] = useState('');
  const [composeAccount, setComposeAccount] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeCcBccOpen, setComposeCcBccOpen] = useState(false);
  const [composeSending, setComposeSending] = useState(false);
  const [composeSendResult, setComposeSendResult] = useState<'none' | 'success' | 'error' | 'scope_upgrade'>('none');
  const [composeSendError, setComposeSendError] = useState<string | null>(null);
  const [composeAttachments, setComposeAttachments] = useState<MailAttachmentInput[]>([]);
  const attachFileRef = useRef<HTMLInputElement>(null);

  // Reset send result, error, and attachments each time the modal opens.
  // Draft text fields (To/Cc/Bcc/Subject/Body) and the selected account are
  // intentionally preserved between opens — matching the original behavior.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setComposeSendResult('none');
      setComposeSendError(null);
      setComposeAttachments([]);
    }
    prevOpenRef.current = open;
  }, [open]);

  // Close the compose modal when Escape is pressed.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onOpenChange]);

  // Auto-select first account when compose opens and accounts are available
  useEffect(() => {
    if (open && composeProvider === '' && accounts.length > 0) {
      const first = accounts[0];
      if (first) {
        setComposeProvider(first.provider);
        setComposeAccount(first.account);
      }
    }
  }, [open, accounts, composeProvider]);

  if (!open) return null;

  return (
    <div
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
        if (e.target === e.currentTarget) {
          onOpenChange(false);
        }
      }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      <div
        style={{
          background: '#fff',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--kp-shadow-3)',
          width: 560,
          maxWidth: '95vw',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Modal header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-space-xs)`,
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <span style={{ fontSize: 'var(--kp-font-md)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', fontFamily: 'var(--font-sans)' }}>
            New email
          </span>
          <button
            type="button"
            data-testid="compose-close"
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

        {/* Modal body (scrollable) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: `var(--kp-space-sm) var(--kp-card-pad) var(--kp-card-pad)`, display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
          {/* From selector */}
          {accounts.length === 0 ? (
            <div data-testid="compose-no-accounts" style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', padding: '8px 0' }}>
              Connect an account first in Settings.
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                From
              </span>
              <select
                value={`${composeProvider}::${composeAccount}`}
                onChange={(e) => {
                  const [p = '', a = ''] = e.target.value.split('::');
                  setComposeProvider(p);
                  setComposeAccount(a);
                }}
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
              >
                {accounts.map((acc) => (
                  <option key={`${acc.provider}::${acc.account}`} value={`${acc.provider}::${acc.account}`}>
                    {acc.label} ({acc.account})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* To field */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
              To
            </span>
            <input
              type="text"
              data-testid="compose-to"
              value={composeTo}
              onChange={(e) => { setComposeTo(e.target.value); }}
              placeholder="recipient@example.com"
              style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
            />
            <button
              type="button"
              data-testid="compose-cc-bcc-toggle"
              onClick={() => { setComposeCcBccOpen((o) => !o); }}
              style={{ flexShrink: 0, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
              Cc / Bcc
            </button>
          </div>

          {/* Cc / Bcc */}
          {composeCcBccOpen && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  Cc
                </span>
                <input
                  type="text"
                  data-testid="compose-cc"
                  value={composeCc}
                  onChange={(e) => { setComposeCc(e.target.value); }}
                  placeholder="cc@example.com"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 40, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
                  Bcc
                </span>
                <input
                  type="text"
                  data-testid="compose-bcc"
                  value={composeBcc}
                  onChange={(e) => { setComposeBcc(e.target.value); }}
                  placeholder="bcc@example.com"
                  style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
                />
              </div>
            </>
          )}

          {/* Subject */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 50, flexShrink: 0, fontSize: 'var(--kp-font-2xs)', fontWeight: 'var(--kp-weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-muted-foreground)' }}>
              Subject
            </span>
            <input
              type="text"
              data-testid="compose-subject"
              value={composeSubject}
              onChange={(e) => { setComposeSubject(e.target.value); }}
              placeholder="Subject"
              style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 5, padding: '5px 8px', fontSize: 'var(--kp-font-sm)', fontFamily: 'var(--font-sans)', background: '#fff', color: 'var(--color-foreground)' }}
            />
          </div>

          {/* Body */}
          <textarea
            data-testid="compose-body"
            value={composeBody}
            onChange={(e) => { setComposeBody(e.target.value); }}
            placeholder="Write your message..."
            rows={10}
            style={{
              width: '100%',
              border: '1px solid var(--color-border)',
              borderRadius: 5,
              padding: '8px',
              fontSize: 'var(--kp-font-sm)',
              lineHeight: 'var(--kp-leading-normal)',
              fontFamily: 'var(--font-sans)',
              background: '#fff',
              color: 'var(--color-foreground)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />

          {/* Attachments */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                data-testid="compose-attach"
                onClick={() => { attachFileRef.current?.click(); }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '4px 10px',
                  borderRadius: 5,
                  fontSize: 'var(--kp-font-xs)',
                  fontWeight: 'var(--kp-weight-medium)',
                  background: 'transparent',
                  color: 'var(--color-muted-foreground)',
                  border: '1px solid var(--color-border)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
                Attach
              </button>
              <input
                ref={attachFileRef}
                type="file"
                multiple
                style={{ display: 'none' }}
                data-testid="compose-attach-input"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  files.forEach((file) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                      const dataUrl = reader.result as string;
                      // dataUrl is "data:<mime>;base64,<data>"
                      const b64 = dataUrl.split(',')[1] ?? '';
                      setComposeAttachments((prev) => [
                        ...prev,
                        { name: file.name, contentBase64: b64, contentType: file.type || 'application/octet-stream' },
                      ]);
                    };
                    reader.readAsDataURL(file);
                  });
                  // Reset so the same file can be re-added after removal
                  e.target.value = '';
                }}
              />
            </div>
            {composeAttachments.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {composeAttachments.map((att, idx) => (
                  <div
                    key={`${att.name}-${String(idx)}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      borderRadius: 4,
                      fontSize: 'var(--kp-font-2xs)',
                      background: '#f0f4ff',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-foreground)',
                      fontFamily: 'var(--font-sans)',
                    }}
                  >
                    <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, color: 'var(--color-muted-foreground)' }} />
                    <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {att.name}
                    </span>
                    <button
                      type="button"
                      data-testid={`compose-remove-attachment-${String(idx)}`}
                      onClick={() => {
                        setComposeAttachments((prev) => prev.filter((_, i) => i !== idx));
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'flex',
                        color: 'var(--color-muted-foreground)',
                      }}
                    >
                      <X style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Send result states */}
          {composeSendResult === 'success' && (
            <div data-testid="compose-success" style={{ fontSize: 'var(--kp-font-xs)', color: '#047857' }}>
              Email sent
            </div>
          )}
          {composeSendResult === 'error' && composeSendError && (
            <div data-testid="compose-error" style={{ fontSize: 'var(--kp-font-xs)', color: '#b45309', display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
              {composeSendError}
            </div>
          )}
          {composeSendResult === 'scope_upgrade' && (
            <div data-testid="compose-scope-upgrade" style={{ fontSize: 'var(--kp-font-xs)', color: '#b45309' }}>
              Sending needs a one-time reconnect for the send permission. Go to Settings to reconnect your email.
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  style={{
                    display: 'block',
                    marginTop: 6,
                    padding: '4px 10px',
                    borderRadius: 5,
                    fontSize: 'var(--kp-font-2xs)',
                    fontWeight: 'var(--kp-weight-semibold)',
                    background: 'transparent',
                    color: 'var(--kp-navy)',
                    border: '1px solid var(--color-border)',
                    cursor: 'pointer',
                  }}
                >
                  Go to Settings
                </button>
              )}
            </div>
          )}
        </div>

        {/* Modal footer */}
        <div
          style={{
            padding: `var(--kp-space-xs) var(--kp-card-pad)`,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            data-testid="compose-send"
            disabled={composeSending || accounts.length === 0}
            onClick={() => {
              const toArr = parseRecipients(composeTo);
              const ccArr = parseRecipients(composeCc);
              const bccArr = parseRecipients(composeBcc);
              setComposeSending(true);
              setComposeSendResult('none');
              setComposeSendError(null);
              void mailSend(composeProvider, composeAccount, toArr, ccArr, bccArr, composeSubject, composeBody, undefined, composeAttachments.length > 0 ? composeAttachments : undefined)
                .then(() => {
                  setComposeSending(false);
                  setComposeSendResult('success');
                  setTimeout(() => {
                    onOpenChange(false);
                    setComposeTo('');
                    setComposeCc('');
                    setComposeBcc('');
                    setComposeSubject('');
                    setComposeBody('');
                    setComposeCcBccOpen(false);
                    setComposeSendResult('none');
                    setComposeSendError(null);
                    setComposeAttachments([]);
                  }, 1500);
                })
                .catch((e: unknown) => {
                  setComposeSending(false);
                  const msg = e instanceof Error ? e.message : '';
                  if (msg.includes('scope_upgrade_required')) {
                    setComposeSendResult('scope_upgrade');
                  } else {
                    setComposeSendResult('error');
                    setComposeSendError(mapMailError(e));
                  }
                });
            }}
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
              cursor: composeSending || accounts.length === 0 ? 'default' : 'pointer',
              opacity: composeSending || accounts.length === 0 ? 0.6 : 1,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {composeSending && (
              <Loader2 style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', strokeWidth: 2, animation: 'spin 1s linear infinite' }} />
            )}
            Send
          </button>
        </div>
      </div>
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </div>
  );
}
