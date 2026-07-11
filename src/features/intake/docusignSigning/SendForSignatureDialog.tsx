import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import type { SignatureStatus } from '@/platform/intake/docusignSignature/signatureRecord';
import { signatureStatusLabel } from './signatureStatusLabel';

export interface SendForSignatureDialogProps {
  open: boolean;
  signerName: string;
  signerEmail: string;
  status?: SignatureStatus;
  canSend: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (signer: { name: string; email: string }) => Promise<void> | void;
}

/** The surrounding request screen supplies the actual local-only checked send action. */
export function SendForSignatureDialog({ open, signerName, signerEmail, status, canSend, onOpenChange, onConfirm }: SendForSignatureDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(signerName);
  const [email, setEmail] = useState(signerEmail);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const send = async () => {
    setSending(true); setError(null);
    try { await onConfirm({ name, email }); onOpenChange(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start signing.'); }
    finally { setSending(false); }
  };
  return <div role="dialog" aria-modal="true" aria-label={t('intake.signature.send-for-signature')} style={{ border: '1px solid var(--kp-divider)', borderRadius: 10, background: 'var(--kp-surface-card)', padding: 18, marginTop: 12 }}>
    <h3 style={{ margin: 0, color: 'var(--kp-navy)' }}>{t('intake.signature.send-for-signature')}</h3>
    <p style={{ color: 'var(--color-muted-foreground)', fontSize: 13 }}>{t('intake.signature.send-description')}</p>
    {status ? <p data-testid="signature-live-status" style={{ fontSize: 13 }}>Status: {signatureStatusLabel(status)}</p> : null}
    <label style={{ display: 'grid', gap: 4, marginTop: 10 }}>Signer name<input value={name} onChange={(event) => { setName(event.target.value); }} /></label>
    <label style={{ display: 'grid', gap: 4, marginTop: 10 }}>Signer email<input type="email" value={email} onChange={(event) => { setEmail(event.target.value); }} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}><Button type="button" variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button><Button type="button" disabled={!canSend || sending || !name.trim() || !email.trim()} onClick={() => {
      // eslint-disable-next-line lantern-async/no-silent-failure -- send() already catches and surfaces its own error via local state
      void send();
    }}>{sending ? 'Sending…' : 'Confirm and send'}</Button></div>
  </div>;
}
