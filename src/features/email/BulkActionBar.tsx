import { FolderInput, ChevronDown, X } from 'lucide-react';
import { Button, IconButton } from '@/ui/kp';
import { BulkMatterPicker } from './BulkMatterPicker';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  return (
    <div
      data-testid="bulk-action-bar"
      className="mx-6 mt-3 flex shrink-0 items-center gap-2 border-y border-[var(--kp-divider)] bg-white py-2 text-xs font-medium text-[var(--kp-navy)]"
    >
      <span className="flex-1">
        {t('mail.bulk.selected', { count: selectedCount })}
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
          {t('mail.bulk.file')}
        </Button>
        <BulkMatterPicker
          selectedIds={selectedIds}
          open={bulkMatterOpen}
          onOpenChange={onBulkMatterOpenChange}
          onDone={onClearSelection}
        />
      </div>
      <IconButton
        variant="ghost"
        size="sm"
        icon={X}
        label={t('mail.bulk.clear-selection')}
        onClick={onClearSelection}
      />
    </div>
  );
}
