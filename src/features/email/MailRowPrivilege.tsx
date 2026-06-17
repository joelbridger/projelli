import { useEffect, useRef } from 'react';
import { ChevronDown, ShieldCheck, Check } from 'lucide-react';
import { Dropdown } from '@/ui/kp';
import { usePrivilegeStore, usePrivilegeForSource } from '@/platform/firm/privilegeStore';
import { ALL_PRIVILEGE_STATUSES, isPrivileged, type Privilege } from '@/types/privilege';

export interface MailRowPrivilegeProps {
  sourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MailRowPrivilege({ sourceId, open, onOpenChange }: MailRowPrivilegeProps) {
  const mailSourceId = sourceId.startsWith('mail:') ? sourceId : `mail:${sourceId}`;
  const privilege = usePrivilegeForSource(mailSourceId);
  const setPrivilege = usePrivilegeStore((s) => s.setPrivilege);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click handler to close the dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => { document.removeEventListener('mousedown', handler); };
  }, [open, onOpenChange]);

  const privilegeLabels: Record<Privilege, string> = {
    none: 'Not privileged',
    'attorney-client': 'Attorney-Client',
    'work-product': 'Work Product',
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        title="Set privilege"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 7px',
          borderRadius: 4,
          fontSize: 'var(--kp-font-2xs)',
          fontWeight: isPrivileged(privilege) ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
          background: isPrivileged(privilege) ? 'rgba(10,37,64,0.08)' : 'transparent',
          color: isPrivileged(privilege) ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
          border: isPrivileged(privilege)
            ? '1px solid rgba(10,37,64,0.18)'
            : '1px solid var(--color-border)',
          cursor: 'pointer',
        }}
      >
        <ShieldCheck style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
        {isPrivileged(privilege) ? privilegeLabels[privilege] : 'Privilege'}
        <ChevronDown style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2 }} />
      </button>

      {open && (
        <Dropdown
          style={{
            top: 'calc(100% + 4px)',
            left: 0,
            minWidth: 170,
          }}
        >
          {ALL_PRIVILEGE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              data-testid={`privilege-option-${status}`}
              onClick={(e) => {
                e.stopPropagation();
                setPrivilege(mailSourceId, status);
                onOpenChange(false);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                padding: `var(--kp-space-xs) var(--kp-space-sm)`,
                fontSize: 'var(--kp-font-xs)',
                fontWeight: privilege === status ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
                color: 'var(--color-foreground)',
                background: privilege === status ? 'rgba(10,37,64,0.04)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {privilegeLabels[status]}
              {privilege === status && (
                <Check style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', color: 'var(--kp-navy)', strokeWidth: 2.5 }} />
              )}
            </button>
          ))}
        </Dropdown>
      )}
    </div>
  );
}
