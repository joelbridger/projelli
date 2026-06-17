// Drag and Drop Hook
// Provides drag and drop functionality for file tree

import { useState, useCallback, DragEvent } from 'react';

export interface DragItem {
  id: string;
  path: string;
  type: 'file' | 'folder';
  name: string;
}

export interface DropTarget {
  id: string;
  path: string;
  type: 'folder';
}

export interface UseDragDropOptions {
  /**
   * Called when an item is dropped on a valid target
   */
  onDrop: (item: DragItem, target: DropTarget) => Promise<void>;

  /**
   * Called to validate if a drop is allowed
   */
  canDrop?: (item: DragItem, target: DropTarget) => boolean;
}

export interface UseDragDropReturn {
  /**
   * Currently dragged item
   */
  draggedItem: DragItem | null;

  /**
   * Current drop target (folder being hovered)
   */
  dropTarget: DropTarget | null;

  /**
   * Whether a drop is currently valid
   */
  isValidDrop: boolean;

  /**
   * Start dragging an item
   */
  startDrag: (event: DragEvent, item: DragItem) => void;

  /**
   * End dragging
   */
  endDrag: () => void;

  /**
   * Handle drag over a potential target
   */
  handleDragOver: (event: DragEvent, target: DropTarget) => void;

  /**
   * Handle drag leaving a target
   */
  handleDragLeave: () => void;

  /**
   * Handle drop on a target
   */
  handleDrop: (event: DragEvent, target: DropTarget) => void;

  /**
   * Get drag props for a draggable item
   */
  getDragProps: (item: DragItem) => {
    draggable: true;
    onDragStart: (e: DragEvent) => void;
    onDragEnd: () => void;
  };

  /**
   * Get drop props for a droppable target
   */
  getDropProps: (target: DropTarget) => {
    onDragOver: (e: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (e: DragEvent) => void;
  };
}

/**
 * Default validator that prevents dropping into self or children
 */
function defaultCanDrop(item: DragItem, target: DropTarget): boolean {
  // Can't drop on self
  if (item.path === target.path) {
    return false;
  }

  // Can't drop folder into its own children
  if (item.type === 'folder' && target.path.startsWith(item.path + '/')) {
    return false;
  }

  // Can't drop into files (only folders)
  if (target.type !== 'folder') {
    return false;
  }

  return true;
}

/**
 * Hook for managing drag and drop operations
 */
export function useDragDrop(options: UseDragDropOptions): UseDragDropReturn {
  const { onDrop, canDrop = defaultCanDrop } = options;

  const [draggedItem, setDraggedItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [isValidDrop, setIsValidDrop] = useState(false);

  const startDrag = useCallback((event: DragEvent, item: DragItem) => {
    setDraggedItem(item);

    // Set drag data
    event.dataTransfer.setData('application/json', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';

    // Set drag image (optional - use default)
    // Could add custom drag preview here
  }, []);

  const endDrag = useCallback(() => {
    setDraggedItem(null);
    setDropTarget(null);
    setIsValidDrop(false);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent, target: DropTarget) => {
      event.preventDefault();
      event.stopPropagation();

      if (!draggedItem) return;

      const valid = canDrop(draggedItem, target);
      setDropTarget(target);
      setIsValidDrop(valid);

      event.dataTransfer.dropEffect = valid ? 'move' : 'none';
    },
    [draggedItem, canDrop]
  );

  const handleDragLeave = useCallback(() => {
    setDropTarget(null);
    setIsValidDrop(false);
  }, []);

  const handleDrop = useCallback(
    async (event: DragEvent, target: DropTarget) => {
      event.preventDefault();
      event.stopPropagation();

      if (!draggedItem) return;

      const valid = canDrop(draggedItem, target);
      if (!valid) {
        endDrag();
        return;
      }

      try {
        await onDrop(draggedItem, target);
      } finally {
        endDrag();
      }
    },
    [draggedItem, canDrop, onDrop, endDrag]
  );

  const getDragProps = useCallback(
    (item: DragItem) => ({
      draggable: true as const,
      onDragStart: (e: DragEvent) => startDrag(e, item),
      onDragEnd: endDrag,
    }),
    [startDrag, endDrag]
  );

  const getDropProps = useCallback(
    (target: DropTarget) => ({
      onDragOver: (e: DragEvent) => handleDragOver(e, target),
      onDragLeave: handleDragLeave,
      onDrop: (e: DragEvent) => handleDrop(e, target),
    }),
    [handleDragOver, handleDragLeave, handleDrop]
  );

  return {
    draggedItem,
    dropTarget,
    isValidDrop,
    startDrag,
    endDrag,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    getDragProps,
    getDropProps,
  };
}

export default useDragDrop;
