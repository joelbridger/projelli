/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useRef } from 'react';
import { Upload, User, Building2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button, IconButton, Eyebrow } from '@/components/ui/kp';
import { useProfileStore } from '@/stores/profileStore';
import { useFirm } from '@/hooks/useFirm';
import { readImageAsDataUrl } from '@/utils/imageUpload';
import type { AuditEntry } from '@/types/audit';
import { LicenseSettings } from '@/components/settings/LicenseSettings';
import { FirmSignIn } from '@/components/firm/FirmSignIn';
import { FirmAdminConsole } from '@/components/firm/FirmAdminConsole';
import { CostMetrics } from '@/components/analysis/CostMetrics';
import { MailConnect } from '@/components/settings/MailConnect';
import { MailImapConnect } from '@/components/settings/MailImapConnect';
import { MailGmailConnect } from '@/components/settings/MailGmailConnect';
import { McpSettingsSection } from '@/components/settings/McpSettingsSection';
import { OllamaSettingsSection } from '@/components/settings/OllamaSettingsSection';

interface AccountWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auditEntries?: AuditEntry[];
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
    </section>
  );
}

/**
 * AccountWindow — opened from the rail's account identity. Holds the profile /
 * firm editor (name + uploadable photo or logo) and the account content that
 * used to live in the Settings "Account" tab (License, Firm, Usage,
 * Connections). The Account tab was removed from Settings in favor of this.
 */
export function AccountWindow({ open, onOpenChange, auditEntries }: AccountWindowProps) {
  const { isSignedIn } = useFirm();
  const isFirm = isSignedIn;
  const profile = useProfileStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const name = isFirm ? profile.firmName : profile.soloName;
  const image = isFirm ? profile.firmLogo : profile.soloAvatar;
  const setName = isFirm ? profile.setFirmName : profile.setSoloName;
  const setImage = isFirm ? profile.setFirmLogo : profile.setSoloAvatar;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setImage(await readImageAsDataUrl(file));
    } catch {
      // ignore unreadable images
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="account-window"
        className="max-w-3xl w-[90vw] h-[80vh] max-h-[700px] p-0 flex flex-col overflow-hidden [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Account</DialogTitle>
        <DialogDescription className="sr-only">Your account, firm, usage, and connections.</DialogDescription>

        {/* Profile / firm editor */}
        <div
          style={{
            padding: 'var(--kp-surface-header-pad)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--kp-space-md)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              overflow: 'hidden',
              flex: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--color-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            {image ? (
              <img src={image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : isFirm ? (
              <Building2 size={26} strokeWidth={1.75} style={{ color: 'var(--color-muted-foreground)' }} />
            ) : (
              <User size={26} strokeWidth={1.75} style={{ color: 'var(--color-muted-foreground)' }} />
            )}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); }}
              placeholder={isFirm ? 'Firm name' : 'Your name'}
              aria-label={isFirm ? 'Firm name' : 'Your name'}
              data-testid="account-name-input"
              style={{
                width: '100%',
                maxWidth: 320,
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '6px 10px',
                fontSize: 'var(--kp-font-md)',
                fontWeight: 'var(--kp-weight-semibold)',
                fontFamily: 'var(--font-sans)',
                color: 'var(--kp-navy)',
                outline: 'none',
              }}
            />
            <div style={{ marginTop: 8, display: 'flex', gap: 'var(--kp-space-xs)', alignItems: 'center' }}>
              <Button variant="secondary" size="sm" iconLeft={Upload} onClick={() => fileRef.current?.click()}>
                {isFirm ? 'Upload logo' : 'Upload photo'}
              </Button>
              {image ? (
                <Button variant="ghost" size="sm" onClick={() => { setImage(null); }}>
                  Remove
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => { void handleFile(e); }}
                style={{ display: 'none' }}
                data-testid="account-image-input"
              />
            </div>
          </div>
          <IconButton icon={X} label="Close" variant="ghost" size="sm" onClick={() => { onOpenChange(false); }} />
        </div>

        {/* Account content (moved out of Settings) */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 'var(--kp-surface-gap) var(--kp-gutter)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--kp-section-gap)',
          }}
        >
          <Section label="Account">
            <LicenseSettings />
          </Section>
          <Section label="Firm">
            <FirmSignIn />
            <FirmAdminConsole />
          </Section>
          <Section label="Usage">
            <CostMetrics entries={auditEntries ?? []} />
          </Section>
          <Section label="Connections">
            <MailConnect />
            <MailImapConnect />
            <MailGmailConnect />
            <McpSettingsSection />
            <OllamaSettingsSection />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AccountWindow;
