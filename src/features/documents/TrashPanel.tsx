// Trash Panel Component
// Displays deleted files with restore and permanent delete options

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/dialog';
import {
  Trash2,
  RotateCcw,
  FileText,
  Folder,
  AlertTriangle,
  Clock,
  HardDrive,
  Settings,
} from 'lucide-react';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import { EmptyState } from '@/ui/EmptyState';

export type TrashRetentionPeriod = 'never' | 7 | 30 | 90 | 'custom';

interface TrashPanelProps {
  items: TrashedItem[];
  stats: TrashStats;
  onRestore: (id: string) => Promise<void>;
  onPermanentDelete: (id: string) => Promise<void>;
  onEmptyTrash: () => Promise<void>;
  retentionPeriod?: TrashRetentionPeriod;
  customRetentionDays?: number;
  onRetentionChange?: (period: TrashRetentionPeriod, customDays?: number) => void;
  className?: string;
}

export function TrashPanel({
  items,
  stats,
  onRestore,
  onPermanentDelete,
  onEmptyTrash,
  retentionPeriod = 'never',
  customRetentionDays = 30,
  onRetentionChange,
  className,
}: TrashPanelProps) {
  const { t } = useTranslation();
  const [selectedItem, setSelectedItem] = useState<TrashedItem | null>(null);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'empty' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [localRetention, setLocalRetention] = useState<TrashRetentionPeriod>(retentionPeriod);
  const [localCustomDays, setLocalCustomDays] = useState(customRetentionDays);

  const handleRestore = useCallback(
    async (item: TrashedItem) => {
      setIsProcessing(true);
      try {
        await onRestore(item.id);
      } finally {
        setIsProcessing(false);
      }
    },
    [onRestore]
  );

  const handlePermanentDelete = useCallback(async () => {
    if (!selectedItem) return;
    setIsProcessing(true);
    try {
      await onPermanentDelete(selectedItem.id);
      setSelectedItem(null);
      setConfirmAction(null);
    } finally {
      setIsProcessing(false);
    }
  }, [selectedItem, onPermanentDelete]);

  const handleEmptyTrash = useCallback(async () => {
    setIsProcessing(true);
    try {
      await onEmptyTrash();
      setConfirmAction(null);
    } finally {
      setIsProcessing(false);
    }
  }, [onEmptyTrash]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return 'Today';
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          <span className="font-medium">Trash</span>
          {items.length > 0 && (
            <span className="text-xs text-muted-foreground">
              ({items.length} items)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onRetentionChange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSettings(true)}
              title="Trash retention settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          )}
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction('empty')}
              className="text-destructive hover:text-destructive"
            >
              Empty Trash
            </Button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {items.length > 0 && (
        <div className="flex items-center gap-4 px-4 py-2 text-xs text-muted-foreground bg-muted/30 border-b">
          <div className="flex items-center gap-1">
            <HardDrive className="h-3 w-3" />
            <span>{formatFileSize(stats.totalSize)}</span>
          </div>
          {stats.oldestItem && (
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span>Oldest: {formatDate(stats.oldestItem)}</span>
            </div>
          )}
        </div>
      )}

      {/* Item list */}
      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <EmptyState
            panelName="trash"
            icon={Trash2}
            title="Trash is empty"
            description={
              retentionPeriod === 'never'
                ? 'Deleted files live here until you empty the trash. Restore any file from here back to its original folder.'
                : retentionPeriod === 'custom'
                  ? `Deleted files live here for ${customRetentionDays} day${customRetentionDays === 1 ? '' : 's'} before being removed permanently. Restore any file from here back to its original folder.`
                  : `Deleted files live here for ${retentionPeriod} days before being removed permanently. Restore any file from here back to its original folder.`
            }
          />
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <TrashItemRow
                key={item.id}
                item={item}
                onRestore={() => handleRestore(item)}
                onDelete={() => {
                  setSelectedItem(item);
                  setConfirmAction('delete');
                }}
                disabled={isProcessing}
                formatDate={formatDate}
                formatFileSize={formatFileSize}
              />
            ))}
          </div>
        )}
      </div>

      {/* Confirm delete dialog */}
      <Dialog
        open={confirmAction === 'delete' && selectedItem !== null}
        onOpenChange={() => {
          setConfirmAction(null);
          setSelectedItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Permanently Delete?
            </DialogTitle>
            <DialogDescription>
              {t('common.trash.delete-confirm', { name: selectedItem?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmAction(null);
                setSelectedItem(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handlePermanentDelete}
              disabled={isProcessing}
            >
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Retention settings dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.trash.retention-title')}</DialogTitle>
            <DialogDescription>
              {t('common.trash.retention-description')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('common.trash.auto-delete-label')}</label>
              <select
                value={localRetention}
                onChange={(e) => setLocalRetention(e.target.value as TrashRetentionPeriod)}
                className="w-full px-3 py-2 rounded-md border bg-background"
              >
                <option value="never">{t('common.trash.retention-never')}</option>
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="custom">Custom...</option>
              </select>
            </div>
            {localRetention === 'custom' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Custom days:</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={localCustomDays}
                  onChange={(e) => setLocalCustomDays(parseInt(e.target.value) || 30)}
                  className="w-full px-3 py-2 rounded-md border bg-background"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('common.trash.retention-help')}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettings(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onRetentionChange?.(localRetention, localRetention === 'custom' ? localCustomDays : undefined);
                setShowSettings(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm empty trash dialog */}
      <Dialog
        open={confirmAction === 'empty'}
        onOpenChange={() => setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Empty Trash?
            </DialogTitle>
            <DialogDescription>
              {t('common.trash.empty-confirm', { count: items.length })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleEmptyTrash}
              disabled={isProcessing}
            >
              Empty Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TrashItemRowProps {
  item: TrashedItem;
  onRestore: () => void;
  onDelete: () => void;
  disabled: boolean;
  formatDate: (date: Date) => string;
  formatFileSize: (bytes: number) => string;
}

function TrashItemRow({
  item,
  onRestore,
  onDelete,
  disabled,
  formatDate,
  formatFileSize,
}: TrashItemRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 hover:bg-muted/50 group">
      {/* Icon */}
      {item.type === 'folder' ? (
        <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      ) : (
        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm">{item.name}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDate(item.deletedAt)}</span>
          {item.size !== undefined && item.size > 0 && (
            <>
              <span>•</span>
              <span>{formatFileSize(item.size)}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onRestore}
          disabled={disabled}
          title="Restore"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={disabled}
          title="Delete permanently"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default TrashPanel;
