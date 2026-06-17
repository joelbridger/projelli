import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, FolderInput } from 'lucide-react';
import { SearchField, Dropdown } from '@/ui/kp';
import { useMatters } from '@/platform/matter/matterStore';
import {
  mailRetagMessageMatter,
  mailRetagFolderMatter,
  type MailListItem,
} from '@/platform/utils/mail-commands';
import { matterLabel } from '@/platform/rag/matterResolver';

// ── MatterPickerPopover ────────────────────────────────────────────────────

export interface MatterPickerProps {
  item: MailListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  /** 'message' = retag this single message; 'folder' = retag the whole folder. */
  mode?: 'message' | 'folder';
}

export function MatterPickerPopover({ item, open, onOpenChange, onDone, mode = 'message' }: MatterPickerProps) {
  const matters = useMatters();
  const [filing, setFiling] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [matterSearch, setMatterSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click handler
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

  if (!open) return null;

  const filteredMatters = matterSearch.trim()
    ? matters.filter((m) => matterLabel(m).toLowerCase().includes(matterSearch.toLowerCase()))
    : matters;

  return (
    <Dropdown
      ref={containerRef}
      style={{
        top: 'calc(100% + 4px)',
        right: 0,
        minWidth: 200,
        maxHeight: 300,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
      }}
    >
      <div style={{ padding: `var(--kp-space-2xs) var(--kp-space-xs)`, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        <SearchField
          size="sm"
          value={matterSearch}
          onChange={(v) => { setMatterSearch(v); }}
          placeholder="Search matters..."
          aria-label="Search matters"
          data-testid="matter-picker-search"
          onClick={(e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {fileError && (
          <div
            style={{
              padding: `var(--kp-space-xs) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-2xs)',
              color: '#b45309',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
            {fileError}
          </div>
        )}
        {filteredMatters.length === 0 ? (
          <div
            style={{
              padding: `var(--kp-space-sm) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
            }}
          >
            {matters.length === 0 ? 'No matters yet' : 'No matching matters'}
          </div>
        ) : (
          filteredMatters.map((m) => (
            <button
            key={m.id}
            type="button"
            disabled={filing === m.id}
            onClick={(e) => {
              e.stopPropagation();
              setFiling(m.id);
              setFileError(null);
              const promise = mode === 'message'
                ? mailRetagMessageMatter(item.id, m.id)
                : mailRetagFolderMatter(item.provider, item.account, item.folderId, m.id);
              void promise
                .then(() => {
                  setFiling(null);
                  onOpenChange(false);
                  onDone();
                })
                .catch((err: unknown) => {
                  setFiling(null);
                  setFileError(err instanceof Error ? err.message : 'Failed to file email. Please try again.');
                });
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--kp-space-xs)',
              width: '100%',
              padding: `var(--kp-space-xs) var(--kp-space-sm)`,
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-foreground)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            {filing === m.id ? (
              <Loader2 style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, animation: 'spin 1s linear infinite', flex: 'none' }} />
            ) : (
              <FolderInput style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 1.75, flex: 'none', color: 'var(--color-muted-foreground)' }} />
            )}
            {matterLabel(m)}
          </button>
          ))
        )}
      </div>
    </Dropdown>
  );
}
