/* eslint-disable lantern-i18n/no-hardcoded-string */
import { useRef, useState } from 'react';
import { Upload, User, Building2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/ui/dialog';
import { Button, IconButton } from '@/ui/kp';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useFirm } from '@/platform/hooks/useFirm';
import { readImageAsDataUrl } from '@/platform/utils/imageUpload';
import type { AuditEntry } from '@/platform/types/audit';
import { getAccountSectionDescriptors } from './accountSectionRegistry';

interface AccountWindowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auditEntries?: AuditEntry[];
  /** Tab id to pre-select when the window opens (e.g. 'connections'). */
  initialTab?: string | undefined;
}

/**
 * AccountWindow — opened from the rail's account identity. Holds the profile /
 * firm editor (name + uploadable photo or logo) and the account content that
 * used to live in the Settings "Account" tab (License, Firm, Usage,
 * Connections). The Account tab was removed from Settings in favor of this.
 */
export function AccountWindow({
  open,
  onOpenChange,
  auditEntries,
  initialTab,
}: AccountWindowProps) {
  const { isSignedIn, org } = useFirm();
  const isFirm = isSignedIn;
  const profile = useProfileStore();
  const fileRef = useRef<HTMLInputElement>(null);
  // Horizontal tabs, collapsed by default: no tab selected on open, so the
  // window shows just the profile and the tab row. Clicking a tab opens it;
  // clicking the active tab collapses back to nothing.
  // When `initialTab` is provided (e.g. from the email connect entry points),
  // pre-select that tab on open.
  const [activeTab, setActiveTab] = useState<string>(initialTab ?? '');

  // Reset the active tab whenever the window transitions to open: if
  // `initialTab` is given, jump to it; otherwise collapse to no tab. This uses
  // React's "adjust state during render on a prop change" pattern (tracking the
  // previous `open` value) rather than a setState-in-effect, so re-opening with
  // a different target lands on the right tab without a cascading render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setActiveTab(initialTab ?? '');
  }

  const name = isFirm ? profile.firmName : profile.soloName;
  const image = isFirm ? profile.firmLogo : profile.soloAvatar;
  const setName = isFirm ? profile.setFirmName : profile.setSoloName;
  const setImage = isFirm ? profile.setFirmLogo : profile.setSoloAvatar;
  // A firm's name flows from its subscription (org.name); the typed value is an
  // optional display override. Solo users just type their name.
  const namePlaceholder = isFirm ? org?.name || 'Firm name' : 'Your name';
  const sections = getAccountSectionDescriptors();
  const activeSection = sections.find((section) => section.id === activeTab);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setImage(await readImageAsDataUrl(file));
      // eslint-disable-next-line lantern-async/no-silent-failure -- unreadable images are intentionally ignored.
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
        <DialogDescription className="sr-only">
          Your account, firm, usage, and connections.
        </DialogDescription>

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
              <img
                src={image}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : isFirm ? (
              <Building2
                size={26}
                strokeWidth={1.75}
                style={{ color: 'var(--color-muted-foreground)' }}
              />
            ) : (
              <User
                size={26}
                strokeWidth={1.75}
                style={{ color: 'var(--color-muted-foreground)' }}
              />
            )}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
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
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 'var(--kp-space-xs)',
                alignItems: 'center',
              }}
            >
              <Button
                variant="secondary"
                size="sm"
                iconLeft={Upload}
                onClick={() => fileRef.current?.click()}
              >
                {isFirm ? 'Upload logo' : 'Upload photo'}
              </Button>
              {image ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImage(null);
                  }}
                >
                  Remove
                </Button>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => {
                  // eslint-disable-next-line lantern-async/no-silent-failure -- handleFile contains the best-effort error handling for image uploads.
                  void handleFile(e);
                }}
                style={{ display: 'none' }}
                data-testid="account-image-input"
              />
            </div>
          </div>
          <IconButton
            icon={X}
            label="Close"
            variant="ghost"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          />
        </div>

        {/* Account content (moved out of Settings) as horizontal tabs, collapsed
            by default so the window opens compact. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            role="tablist"
            aria-label="Account sections"
            style={{
              display: 'flex',
              gap: 'var(--kp-space-xs)',
              padding: '0 var(--kp-gutter)',
              borderBottom: '1px solid var(--color-border)',
              flexShrink: 0,
            }}
          >
            {sections.map((section) => {
              const active = activeTab === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`account-tab-${section.id}`}
                  onClick={() => {
                    setActiveTab((prev) =>
                      prev === section.id ? '' : section.id
                    );
                  }}
                  style={{
                    appearance: 'none',
                    border: 0,
                    background: 'transparent',
                    cursor: 'pointer',
                    padding: 'var(--kp-space-sm) var(--kp-space-md)',
                    fontSize: 'var(--kp-font-sm)',
                    fontWeight: active
                      ? 'var(--kp-weight-semibold)'
                      : 'var(--kp-weight-medium)',
                    color: active
                      ? 'var(--kp-navy)'
                      : 'var(--color-muted-foreground)',
                    borderBottom: active
                      ? '2px solid var(--kp-navy)'
                      : '2px solid transparent',
                    marginBottom: -1,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  {section.legacyLabel}
                </button>
              );
            })}
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: 'var(--kp-surface-gap) var(--kp-gutter)',
            }}
          >
            {activeTab === '' && (
              <p
                data-testid="account-tab-empty"
                style={{
                  fontSize: 'var(--kp-font-sm)',
                  color: 'var(--color-muted-foreground)',
                  textAlign: 'center',
                  padding: '44px 0',
                }}
              >
                Choose a section above to manage it.
              </p>
            )}
            {activeSection?.render({ auditEntries })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default AccountWindow;
