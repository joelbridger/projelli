/**
 * GearMenu — the top-right gear in the newNav (3-tab IA) shell. It consolidates
 * the surfaces that left the rail: Settings, Privacy Center, Activity Log, and
 * Documents (so the Word/.docx editor + file browser stay reachable). The
 * always-on egress badge stays in the TrustBar; only the deeper detail moves
 * behind the gear.
 *
 * Stable testids are preserved so the redesign doesn't redden the test suite:
 * the trigger keeps `settings-gear`, and the relocated surfaces keep their
 * `spine-nav-{privacy,audit,files}` ids on the menu items that route to them.
 *
 * Controlled open-state + outside-click + Escape (not a portal menu) so it is
 * predictable in tests and the light theme stays consistent.
 */
import { useEffect, useRef, useState } from 'react';
import { Settings, Lock, ShieldCheck, FolderTree, type LucideIcon } from 'lucide-react';
import { Dropdown } from '@/ui/kp';

export interface GearMenuProps {
  /** Open the Settings surface/modal (Privacy + Activity detail live here too). */
  onOpenSettings: () => void;
  onOpenPrivacy: () => void;
  onOpenActivity: () => void;
  onOpenDocuments: () => void;
}

interface MenuItem {
  testid: string;
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
}

export function GearMenu({ onOpenSettings, onOpenPrivacy, onOpenActivity, onOpenDocuments }: GearMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const select = (fn: () => void) => () => { setOpen(false); fn(); };

  const items: MenuItem[] = [
    { testid: 'gear-menu-settings', label: 'Settings', Icon: Settings, onClick: onOpenSettings },
    { testid: 'spine-nav-privacy', label: 'Privacy Center', Icon: Lock, onClick: onOpenPrivacy },
    { testid: 'spine-nav-audit', label: 'Activity Log', Icon: ShieldCheck, onClick: onOpenActivity },
    { testid: 'spine-nav-files', label: 'Documents', Icon: FolderTree, onClick: onOpenDocuments },
  ];

  const menuLabel = 'Settings & more';

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="settings-gear"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`${menuLabel} (Ctrl+,)`}
        aria-label={menuLabel}
        onClick={() => { setOpen((v) => !v); }}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        style={{ border: 0, background: open ? 'var(--kp-side-active-bg)' : 'transparent', cursor: 'pointer' }}
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <Dropdown
          role="menu"
          aria-label={menuLabel}
          style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, minWidth: 208, zIndex: 60, padding: 4 }}
        >
          {items.map(({ testid, label, Icon, onClick }) => (
            <button
              key={testid}
              type="button"
              role="menuitem"
              data-testid={testid}
              onClick={select(onClick)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)', width: '100%',
                padding: 'var(--kp-space-xs) var(--kp-space-sm)', borderRadius: 'var(--radius-md)',
                border: 0, background: 'transparent', color: 'var(--kp-navy)', cursor: 'pointer',
                textAlign: 'left', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-medium)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(10,37,64,0.05)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <Icon size={16} strokeWidth={1.75} style={{ flex: 'none', opacity: 0.85 }} />
              <span>{label}</span>
            </button>
          ))}
        </Dropdown>
      )}
    </div>
  );
}
