import { useState, useCallback } from 'react';
import {
  Mail,
  AlertTriangle,
  Paperclip,
  ShieldCheck,
  FileDown,
  FolderInput,
  Square,
  CheckSquare,
} from 'lucide-react';
import { Button, Badge } from '@/ui/kp';
import { usePrivilegeForSource } from '@/stores/privilegeStore';
import { mailGetMessage, type MailListItem } from '@/utils/mail-commands';
import { isPrivileged } from '@/types/privilege';
import { formatRelativeDate, slugify } from './emailWorkspaceHelpers';
import { MatterPickerPopover } from './MatterPickerPopover';
import { MailRowPrivilege } from './MailRowPrivilege';

export interface MailRowProps {
  item: MailListItem;
  selected: boolean;
  anySelected: boolean;
  onToggleSelect: (id: string) => void;
  onSaveToWorkspace?: ((content: string, suggestedName: string) => Promise<void>) | undefined;
}

export function MailRow({ item, selected, anySelected, onToggleSelect, onSaveToWorkspace }: MailRowProps) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [privilegeOpen, setPrivilegeOpen] = useState(false);
  const [matterOpen, setMatterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const handleOpen = useCallback(() => {
    const sourceId = `mail:${item.id}`;
    window.dispatchEvent(
      new CustomEvent('keepance:open-email', {
        detail: { sourceId },
      }),
    );
  }, [item.id]);

  const handleExport = useCallback(async () => {
    if (!onSaveToWorkspace) return;
    setExporting(true);
    setExportFailed(false);
    try {
      const msg = await mailGetMessage(item.id);
      const to = msg.to.join(', ');
      const cc = msg.cc.length > 0 ? `\nCc: ${msg.cc.join(', ')}` : '';
      const date = msg.date ?? '';
      const content = `Subject: ${msg.subject}\nFrom: ${msg.from}\nTo: ${to}${cc}\nDate: ${date}\n\n${msg.body}`;
      const suggestedName = `${slugify(item.subject) || 'email'}.txt`;
      await onSaveToWorkspace(content, suggestedName);
    } catch {
      setExportFailed(true);
      // Auto-clear after 3 s so the button returns to normal
      setTimeout(() => { setExportFailed(false); }, 3000);
    } finally {
      setExporting(false);
    }
  }, [item.id, item.subject, onSaveToWorkspace]);

  const mailSourceId = `mail:${item.id}`;
  const privilege = usePrivilegeForSource(mailSourceId);

  const showCheckbox = hovered || anySelected || selected;

  return (
    <div
      data-testid="mail-row"
      role="button"
      tabIndex={0}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-start',
        padding: `var(--kp-space-sm) var(--kp-space-md)`,
        borderBottom: '1px solid var(--color-border)',
        background: selected
          ? 'rgba(10,37,64,0.04)'
          : hovered
          ? 'rgba(10,37,64,0.02)'
          : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.1s',
      }}
      onMouseEnter={() => { setHovered(true); }}
      onMouseLeave={() => {
        setHovered(false);
        setPrivilegeOpen(false);
        setMatterOpen(false);
      }}
      onFocus={() => { setFocusWithin(true); }}
      onBlur={(e) => {
        // Only clear when focus moves entirely outside the row
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen();
        }
      }}
    >
      {/* Checkbox column */}
      <div
        style={{
          width: showCheckbox ? 28 : 0,
          overflow: 'hidden',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          paddingTop: 2,
          transition: 'width 0.1s',
        }}
        onClick={(e) => { e.stopPropagation(); onToggleSelect(item.id); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect(item.id);
          }
        }}
        role="checkbox"
        aria-checked={selected}
        aria-label={`Select ${item.subject}`}
        tabIndex={showCheckbox ? 0 : -1}
      >
        {selected ? (
          <CheckSquare style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--kp-navy)', strokeWidth: 1.75, flex: 'none' }} />
        ) : (
          <Square style={{ width: 'var(--kp-icon-sm)', height: 'var(--kp-icon-sm)', color: 'var(--color-muted-foreground)', strokeWidth: 1.75, flex: 'none' }} />
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Row top: subject + date */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span
            style={{
              fontSize: 'var(--kp-font-sm)',
              fontWeight: 'var(--kp-weight-semibold)',
              lineHeight: 'var(--kp-leading-snug)',
              color: 'var(--kp-navy)',
              fontFamily: 'var(--font-sans)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
          >
            {item.subject || '(no subject)'}
          </span>
          <span
            style={{
              fontSize: 'var(--kp-font-2xs)',
              color: 'var(--color-muted-foreground)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              flex: 'none',
            }}
          >
            {formatRelativeDate(item.receivedDateTime)}
          </span>
        </div>

        {/* From + badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.fromName ? `${item.fromName} <${item.fromAddr}>` : item.fromAddr}
          </span>
          {item.hasAttachments && (
            <Paperclip style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', color: 'var(--color-muted-foreground)', strokeWidth: 1.75, flex: 'none' }} />
          )}
          {isPrivileged(privilege) && (
            <Badge variant="privilege" size="sm" icon={ShieldCheck}>Privileged</Badge>
          )}
        </div>

        {/* Snippet */}
        {item.snippet && (
          <span
            style={{
              fontSize: 'var(--kp-font-xs)',
              lineHeight: 'var(--kp-leading-normal)',
              color: 'var(--color-muted-foreground)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {item.snippet}
          </span>
        )}

        {/* Hover / focus-within actions */}
        {(hovered || focusWithin) && (
          <div
            style={{
              position: 'absolute',
              right: 16,
              bottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--kp-space-2xs)',
            }}
            onClick={(e) => { e.stopPropagation(); }}
          >
            {/* Open */}
            <Button
              variant="secondary"
              size="sm"
              iconLeft={Mail}
              data-testid={`open-email-${item.id}`}
              onClick={handleOpen}
              title="Open email"
            >
              Open
            </Button>

            {/* File this email to matter (per-message) */}
            <div style={{ position: 'relative' }}>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={FolderInput}
                data-testid={`file-to-matter-${item.id}`}
                onClick={() => { setMatterOpen((o) => !o); }}
                title="File this email to a matter"
              >
                File
              </Button>
              <MatterPickerPopover
                item={item}
                open={matterOpen}
                onOpenChange={setMatterOpen}
                onDone={() => { setMatterOpen(false); }}
                mode="message"
              />
            </div>

            {/* Privilege */}
            <MailRowPrivilege
              sourceId={item.id}
              open={privilegeOpen}
              onOpenChange={setPrivilegeOpen}
            />

            {/* Export */}
            {onSaveToWorkspace && (
              <Button
                variant={exportFailed ? 'danger' : 'secondary'}
                size="sm"
                iconLeft={exportFailed ? AlertTriangle : FileDown}
                loading={exporting}
                data-testid={`export-email-${item.id}`}
                onClick={() => { void handleExport(); }}
                disabled={exporting}
                title={exportFailed ? 'Export failed, try again' : 'Export to workspace'}
              >
                {exportFailed ? 'Export failed' : 'Export'}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
