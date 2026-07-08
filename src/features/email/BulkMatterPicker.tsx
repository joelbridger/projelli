import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Loader2, FolderInput } from 'lucide-react';
import { SearchField, Dropdown } from '@/ui/kp';
import { useMatters } from '@/platform/matter/matterStore';
import { mailRetagMessageMatter } from '@/platform/utils/mail-commands';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useTranslation } from 'react-i18next';

// ── BulkMatterPicker ───────────────────────────────────────────────────────

export interface BulkMatterPickerProps {
  selectedIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

export function BulkMatterPicker({ selectedIds, open, onOpenChange, onDone }: BulkMatterPickerProps) {
  const { t } = useTranslation();
  const matters = useMatters();
  const [filing, setFiling] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [matterSearch, setMatterSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

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
        left: 0,
        minWidth: 210,
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
          placeholder={t('mail.filing.find-client')}
          aria-label={t('mail.filing.find-client')}
          data-testid="bulk-matter-picker-search"
          onClick={(e: React.MouseEvent<HTMLInputElement>) => { e.stopPropagation(); }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {fileError && (
          <div style={{ padding: `var(--kp-space-xs) var(--kp-space-sm)`, fontSize: 'var(--kp-font-2xs)', color: '#b45309', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <AlertTriangle style={{ width: 'var(--kp-icon-xs)', height: 'var(--kp-icon-xs)', strokeWidth: 2, flex: 'none' }} />
            {fileError}
          </div>
        )}
        {filteredMatters.length === 0 ? (
          <div style={{ padding: `var(--kp-space-sm) var(--kp-space-sm)`, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {matters.length === 0 ? t('mail.filing.no-clients') : t('mail.filing.no-matches')}
          </div>
        ) : (
          filteredMatters.map((m) => (
          <button
            key={m.id}
            type="button"
            data-testid={`bulk-matter-choice-${m.id}`}
            disabled={filing === m.id}
            onClick={(e) => {
              e.stopPropagation();
              const matterId = m.id;
              setFiling(matterId);
              setFileError(null);
              void (async () => {
                try {
                  await Promise.all(Array.from(selectedIds).map((id) => mailRetagMessageMatter(id, matterId)));
                  setFiling(null);
                  onOpenChange(false);
                  onDone();
                } catch (err: unknown) {
                  setFiling(null);
                  setFileError(err instanceof Error ? err.message : t('mail.filing.bulk-file-error'));
                }
              })();
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
