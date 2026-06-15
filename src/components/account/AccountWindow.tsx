/* eslint-disable keepance-i18n/no-hardcoded-string */
import { useRef, useState } from 'react';
import { Upload, User, Building2, X, ChevronDown } from 'lucide-react';
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

/**
 * A collapsible account section. The window holds a lot (license, firm, usage,
 * every connection), so sections collapse to one-open-at-a-time and the body
 * is hidden (not unmounted) so each section keeps its state while closed.
 */
function CollapsibleSection({
  id,
  label,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={`account-section-${id}`}
      style={{ borderBottom: '1px solid var(--color-border)' }}
    >
      <button
        type="button"
        onClick={() => { onToggle(id); }}
        aria-expanded={open}
        aria-controls={`account-section-body-${id}`}
        data-testid={`account-section-toggle-${id}`}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--kp-space-sm)',
          padding: 'var(--kp-space-md) 0',
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <Eyebrow>{label}</Eyebrow>
        <ChevronDown
          size={16}
          strokeWidth={2}
          style={{
            flex: 'none',
            color: 'var(--color-muted-foreground)',
            transition: 'transform var(--kp-duration-fast) var(--kp-ease-standard)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        />
      </button>
      <div
        id={`account-section-body-${id}`}
        hidden={!open}
        style={{
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 'var(--kp-space-md)',
          paddingBottom: 'var(--kp-space-lg)',
        }}
      >
        {children}
      </div>
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
  const { isSignedIn, org } = useFirm();
  const isFirm = isSignedIn;
  const profile = useProfileStore();
  const fileRef = useRef<HTMLInputElement>(null);
  // One section open at a time; License is the most useful, so open it first.
  const [openId, setOpenId] = useState<string>('account');
  const toggle = (id: string) => { setOpenId((prev) => (prev === id ? '' : id)); };

  const name = isFirm ? profile.firmName : profile.soloName;
  const image = isFirm ? profile.firmLogo : profile.soloAvatar;
  const setName = isFirm ? profile.setFirmName : profile.setSoloName;
  const setImage = isFirm ? profile.setFirmLogo : profile.setSoloAvatar;
  // A firm's name flows from its subscription (org.name); the typed value is an
  // optional display override. Solo users just type their name.
  const namePlaceholder = isFirm ? (org?.name || 'Firm name') : 'Your name';

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
              placeholder={namePlaceholder}
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

        {/* Account content (moved out of Settings). Collapsible, one open at a
            time, so the window opens compact instead of one long scroll. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '0 var(--kp-gutter)',
          }}
        >
          <CollapsibleSection id="account" label="Account" open={openId === 'account'} onToggle={toggle}>
            <LicenseSettings />
          </CollapsibleSection>
          <CollapsibleSection id="firm" label="Firm" open={openId === 'firm'} onToggle={toggle}>
            <FirmSignIn />
            <FirmAdminConsole />
          </CollapsibleSection>
          <CollapsibleSection id="usage" label="Usage" open={openId === 'usage'} onToggle={toggle}>
            <CostMetrics entries={auditEntries ?? []} />
          </CollapsibleSection>
          <CollapsibleSection id="connections" label="Connections" open={openId === 'connections'} onToggle={toggle}>
            <MailConnect />
            <MailImapConnect />
            <MailGmailConnect />
            <McpSettingsSection />
            <OllamaSettingsSection />
          </CollapsibleSection>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AccountWindow;
