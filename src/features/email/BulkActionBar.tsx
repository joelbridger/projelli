import { FolderInput, ChevronDown, X } from 'lucide-react';
import { Button } from '@/ui/kp';
import { BulkMatterPicker } from './BulkMatterPicker';

// ── Props ──────────────────────────────────────────────────────────────────

interface BulkActionBarProps {
  selectedCount: number;
  selectedIds: Set<string>;
  onClearSelection: () => void;
  bulkMatterOpen: boolean;
  onBulkMatterOpenChange: (open: boolean) => void;
}

// ── Component ──────────────────────────────────────────────────────────────

export function BulkActionBar({
  selectedCount,
  selectedIds,
  onClearSelection,
  bulkMatterOpen,
  onBulkMatterOpenChange,
}: BulkActionBarProps) {
  return (
    <div
      data-testid="bulk-action-bar"
      style={{
        margin: `var(--kp-space-md) var(--kp-gutter) var(--kp-space-xs)`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 'var(--kp-space-xs) var(--kp-space-sm)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid rgba(10,37,64,0.18)',
        background: 'rgba(10,37,64,0.04)',
        fontSize: 'var(--kp-font-xs)',
        color: 'var(--kp-navy)',
        fontWeight: 'var(--kp-weight-medium)',
      }}
    >
      {/* eslint-disable lantern-i18n/no-hardcoded-string */}
      <span style={{ flex: 1 }}>
        {selectedCount} selected
      </span>
      <div style={{ position: 'relative' }}>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={FolderInput}
          iconRight={ChevronDown}
          data-testid="bulk-file-to-matter"
          onClick={() => { onBulkMatterOpenChange(!bulkMatterOpen); }}
        >
          File to matter
        </Button>
        <BulkMatterPicker
          selectedIds={selectedIds}
          open={bulkMatterOpen}
          onOpenChange={onBulkMatterOpenChange}
          onDone={onClearSelection}
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        iconLeft={X}
        onClick={onClearSelection}
      >
        Clear selection
      </Button>
      {/* eslint-enable lantern-i18n/no-hardcoded-string */}
    </div>
  );
}
