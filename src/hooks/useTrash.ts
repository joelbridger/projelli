/**
 * Trash management hook
 * Handles trash state, metadata persistence, and auto-cleanup
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { TrashedItem, TrashStats } from '@/modules/history/TrashService';
import { useEditorStore } from '@/stores/editorStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const TRASH_METADATA_FILE = '.trash/metadata.json';

interface UseTrashOptions {
  rootPath: string | null;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
}

interface UseTrashReturn {
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  trashRetentionPeriod: 'never' | 7 | 30 | 90 | 'custom';
  trashCustomRetentionDays: number;
  saveTrashMetadata: (items: TrashedItem[]) => Promise<void>;
  loadTrashMetadata: () => Promise<TrashedItem[]>;
  handleRestoreFromTrash: (id: string) => Promise<void>;
  handlePermanentDelete: (id: string) => Promise<void>;
  handleEmptyTrash: () => Promise<void>;
  handleTrashRetentionChange: (period: 'never' | 7 | 30 | 90 | 'custom', customDays?: number) => void;
  setTrashItems: React.Dispatch<React.SetStateAction<TrashedItem[]>>;
  setTrashStats: React.Dispatch<React.SetStateAction<TrashStats>>;
}

export function useTrash({ rootPath, workspaceServiceRef }: UseTrashOptions): UseTrashReturn {
  const { closeTabsByPath } = useEditorStore();
  const { setFileTree } = useWorkspaceStore();

  // Trash state
  const [trashItems, setTrashItems] = useState<TrashedItem[]>([]);
  const [trashStats, setTrashStats] = useState<TrashStats>({
    itemCount: 0,
    totalSize: 0,
    oldestItem: undefined,
  });
  const [trashRetentionPeriod, setTrashRetentionPeriod] = useState<'never' | 7 | 30 | 90 | 'custom'>('never');
  const [trashCustomRetentionDays, setTrashCustomRetentionDays] = useState(30);

  // Use ref to avoid stale closure issues in interval
  const trashItemsRef = useRef<TrashedItem[]>(trashItems);
  const trashRetentionPeriodRef = useRef(trashRetentionPeriod);
  const trashCustomRetentionDaysRef = useRef(trashCustomRetentionDays);

  useEffect(() => {
    trashItemsRef.current = trashItems;
  }, [trashItems]);

  useEffect(() => {
    trashRetentionPeriodRef.current = trashRetentionPeriod;
  }, [trashRetentionPeriod]);

  useEffect(() => {
    trashCustomRetentionDaysRef.current = trashCustomRetentionDays;
  }, [trashCustomRetentionDays]);

  // Save trash metadata to file
  const saveTrashMetadata = useCallback(async (items: TrashedItem[]) => {
    if (!workspaceServiceRef.current || !rootPath) return;
    try {
      const metadataPath = `${rootPath}/${TRASH_METADATA_FILE}`;
      const metadata = JSON.stringify(items.map(item => ({
        ...item,
        deletedAt: item.deletedAt.toISOString(),
      })), null, 2);
      await workspaceServiceRef.current.writeFile(metadataPath, metadata);
    } catch (error) {
      console.error('Failed to save trash metadata:', error);
    }
  }, [rootPath, workspaceServiceRef]);

  // Load trash metadata from file
  const loadTrashMetadata = useCallback(async (): Promise<TrashedItem[]> => {
    if (!workspaceServiceRef.current || !rootPath) return [];
    try {
      const metadataPath = `${rootPath}/${TRASH_METADATA_FILE}`;
      const exists = await workspaceServiceRef.current.exists(metadataPath);
      if (!exists) return [];

      const content = await workspaceServiceRef.current.readFile(metadataPath);
      const items = JSON.parse(content) as Array<{
        id: string;
        originalPath: string;
        trashPath: string;
        name: string;
        type: 'file' | 'folder';
        deletedAt: string;
        size?: number;
      }>;

      // Convert date strings back to Date objects and verify files still exist
      const validItems: TrashedItem[] = [];
      for (const item of items) {
        const trashFileExists = await workspaceServiceRef.current.exists(item.trashPath);
        if (trashFileExists) {
          validItems.push({
            ...item,
            deletedAt: new Date(item.deletedAt),
          });
        }
      }
      return validItems;
    } catch (error) {
      console.error('Failed to load trash metadata:', error);
      return [];
    }
  }, [rootPath, workspaceServiceRef]);

  // Handle restore from trash
  const handleRestoreFromTrash = useCallback(
    async (id: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      const item = trashItems.find(i => i.id === id);
      if (!item) return;

      try {
        // Check if original path exists
        let targetPath = item.originalPath;
        const exists = await workspaceServiceRef.current.exists(targetPath);

        if (exists) {
          // Create a unique name
          const ext = item.name.includes('.') ? '.' + item.name.split('.').pop() : '';
          const baseName = ext ? item.name.slice(0, -(ext.length)) : item.name;
          const timestamp = Date.now();
          const parentPath = targetPath.split('/').slice(0, -1).join('/');
          targetPath = `${parentPath}/${baseName}_restored_${timestamp}${ext}`;
        }

        // Move back from trash
        await workspaceServiceRef.current.move(item.trashPath, targetPath);

        // Remove from trash state and persist
        const newItems = trashItems.filter(i => i.id !== id);
        setTrashItems(newItems);
        const totalSize = newItems.reduce((sum, i) => sum + (i.size ?? 0), 0);
        const oldestItem = newItems.length > 0
          ? newItems.reduce((oldest, i) =>
              i.deletedAt < oldest ? i.deletedAt : oldest,
              newItems[0]!.deletedAt
            )
          : undefined;
        setTrashStats({
          itemCount: newItems.length,
          totalSize,
          oldestItem,
        });

        // Persist updated metadata
        await saveTrashMetadata(newItems);

        // Refresh file tree
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);
      } catch (error) {
        console.error('Failed to restore from trash:', error);
      }
    },
    [trashItems, rootPath, workspaceServiceRef, saveTrashMetadata, setFileTree]
  );

  // Handle permanent delete from trash
  const handlePermanentDelete = useCallback(
    async (id: string) => {
      if (!workspaceServiceRef.current) return;

      const item = trashItems.find(i => i.id === id);
      if (!item) return;

      try {
        await workspaceServiceRef.current.delete(item.trashPath);

        // Close all tabs for the permanently deleted file (use originalPath, not trashPath)
        closeTabsByPath(item.originalPath);

        // Remove from trash state and persist
        const newItems = trashItems.filter(i => i.id !== id);
        setTrashItems(newItems);
        const totalSize = newItems.reduce((sum, i) => sum + (i.size ?? 0), 0);
        const oldestItem = newItems.length > 0
          ? newItems.reduce((oldest, i) =>
              i.deletedAt < oldest ? i.deletedAt : oldest,
              newItems[0]!.deletedAt
            )
          : undefined;
        setTrashStats({
          itemCount: newItems.length,
          totalSize,
          oldestItem,
        });

        // Persist updated metadata
        await saveTrashMetadata(newItems);
      } catch (error) {
        console.error('Failed to permanently delete:', error);
      }
    },
    [trashItems, workspaceServiceRef, saveTrashMetadata, closeTabsByPath]
  );

  // Handle empty trash
  const handleEmptyTrash = useCallback(
    async () => {
      if (!workspaceServiceRef.current) return;

      try {
        // Close all tabs for files being permanently deleted (before deleting files)
        for (const item of trashItems) {
          closeTabsByPath(item.originalPath);
        }

        for (const item of trashItems) {
          try {
            await workspaceServiceRef.current.delete(item.trashPath);
          } catch {
            // Ignore individual delete errors
          }
        }

        setTrashItems([]);
        setTrashStats({
          itemCount: 0,
          totalSize: 0,
          oldestItem: undefined,
        });

        // Persist empty metadata
        await saveTrashMetadata([]);
      } catch (error) {
        console.error('Failed to empty trash:', error);
      }
    },
    [trashItems, workspaceServiceRef, saveTrashMetadata, closeTabsByPath]
  );

  // Handle trash retention settings change
  const handleTrashRetentionChange = useCallback(
    (period: 'never' | 7 | 30 | 90 | 'custom', customDays?: number) => {
      setTrashRetentionPeriod(period);
      if (period === 'custom' && customDays) {
        setTrashCustomRetentionDays(customDays);
      }
      // Persist to localStorage
      localStorage.setItem('trashRetentionPeriod', period.toString());
      if (customDays) {
        localStorage.setItem('trashCustomRetentionDays', customDays.toString());
      }
    },
    []
  );

  // Auto-cleanup expired trash items based on retention period
  const autoCleanupTrash = useCallback(
    async () => {
      if (!workspaceServiceRef.current || trashRetentionPeriodRef.current === 'never') return;

      const retentionDays = trashRetentionPeriodRef.current === 'custom'
        ? trashCustomRetentionDaysRef.current
        : trashRetentionPeriodRef.current;

      const now = Date.now();
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

      // Find items older than retention period
      const itemsToDelete = trashItemsRef.current.filter(item => {
        const ageMs = now - new Date(item.deletedAt).getTime();
        return ageMs > retentionMs;
      });

      if (itemsToDelete.length === 0) return;

      try {
        // Close tabs for items being deleted
        for (const item of itemsToDelete) {
          closeTabsByPath(item.originalPath);
        }

        // Delete files
        for (const item of itemsToDelete) {
          try {
            await workspaceServiceRef.current.delete(item.trashPath);
          } catch {
            // Ignore individual delete errors
          }
        }

        // Update state
        const remainingItems = trashItemsRef.current.filter(
          item => !itemsToDelete.some(deleted => deleted.id === item.id)
        );

        setTrashItems(remainingItems);

        // Update stats
        const totalSize = remainingItems.reduce((sum, i) => sum + (i.size || 0), 0);
        const oldestItem = remainingItems.length > 0
          ? remainingItems.reduce(
              (oldest, i) =>
                i.deletedAt < oldest ? i.deletedAt : oldest,
              remainingItems[0]!.deletedAt
            )
          : undefined;

        setTrashStats({
          itemCount: remainingItems.length,
          totalSize,
          oldestItem,
        });

        // Persist
        await saveTrashMetadata(remainingItems);

        console.log(`Auto-cleanup: Deleted ${itemsToDelete.length} expired trash items`);
      } catch (error) {
        console.error('Failed to auto-cleanup trash:', error);
      }
    },
    [workspaceServiceRef, saveTrashMetadata, closeTabsByPath]
  );

  // Auto-cleanup expired trash items periodically (every hour)
  useEffect(() => {
    // Run cleanup on mount
    void autoCleanupTrash();

    // Then run every hour
    const cleanupInterval = setInterval(() => {
      void autoCleanupTrash();
    }, 60 * 60 * 1000); // 1 hour

    return () => clearInterval(cleanupInterval);
  }, [autoCleanupTrash]);

  return {
    trashItems,
    trashStats,
    trashRetentionPeriod,
    trashCustomRetentionDays,
    saveTrashMetadata,
    loadTrashMetadata,
    handleRestoreFromTrash,
    handlePermanentDelete,
    handleEmptyTrash,
    handleTrashRetentionChange,
    setTrashItems,
    setTrashStats,
  };
}
