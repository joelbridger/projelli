// Split Pane Component
// Allows viewing multiple editors side-by-side with resizable dividers

import { useCallback, useRef, useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { X, Columns, Rows } from 'lucide-react';

export type SplitDirection = 'horizontal' | 'vertical';

interface SplitPaneProps {
  direction?: SplitDirection;
  initialSizes?: [number, number]; // percentages
  minSize?: number; // minimum percentage
  children: [React.ReactNode, React.ReactNode];
  className?: string;
  onClose?: (paneIndex: 0 | 1) => void;
}

export function SplitPane({
  direction = 'horizontal',
  initialSizes = [50, 50],
  minSize = 20,
  children,
  className,
  onClose,
}: SplitPaneProps) {
  const [sizes, setSizes] = useState(initialSizes);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const startPos = useRef(0);
  const startSizes = useRef(initialSizes);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      startPos.current = direction === 'horizontal' ? e.clientX : e.clientY;
      startSizes.current = [...sizes] as [number, number];
      document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction, sizes]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const container = containerRef.current;
      const containerRect = container.getBoundingClientRect();
      const containerSize =
        direction === 'horizontal' ? containerRect.width : containerRect.height;
      const currentPos = direction === 'horizontal' ? e.clientX : e.clientY;

      const deltaPercent = ((currentPos - startPos.current) / containerSize) * 100;
      let newFirstSize = startSizes.current[0] + deltaPercent;

      // Clamp to minSize
      newFirstSize = Math.max(minSize, Math.min(100 - minSize, newFirstSize));

      setSizes([newFirstSize, 100 - newFirstSize]);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [direction, minSize]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full w-full',
        isHorizontal ? 'flex-row' : 'flex-col',
        className
      )}
    >
      {/* First pane */}
      <div
        className="relative overflow-hidden"
        style={{
          [isHorizontal ? 'width' : 'height']: `${sizes[0]}%`,
        }}
      >
        {onClose && (
          <div className="absolute top-1 right-1 z-10">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 hover:opacity-100 transition-opacity"
              onClick={() => onClose(0)}
              title="Close pane"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {children[0]}
      </div>

      {/* Resizer */}
      <div
        className={cn(
          'flex-shrink-0 bg-border hover:bg-primary/50 transition-colors',
          isHorizontal
            ? 'w-1 cursor-col-resize hover:w-1.5'
            : 'h-1 cursor-row-resize hover:h-1.5',
          isDragging.current && 'bg-primary'
        )}
        onMouseDown={handleMouseDown}
      />

      {/* Second pane */}
      <div
        className="relative overflow-hidden"
        style={{
          [isHorizontal ? 'width' : 'height']: `${sizes[1]}%`,
        }}
      >
        {onClose && (
          <div className="absolute top-1 right-1 z-10">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 hover:opacity-100 transition-opacity"
              onClick={() => onClose(1)}
              title="Close pane"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
        {children[1]}
      </div>
    </div>
  );
}

interface SplitPaneControlsProps {
  onSplitHorizontal?: (() => void) | undefined;
  onSplitVertical?: (() => void) | undefined;
  canSplit?: boolean | undefined;
}

export function SplitPaneControls({
  onSplitHorizontal,
  onSplitVertical,
  canSplit = true,
}: SplitPaneControlsProps) {
  if (!canSplit) return null;

  return (
    <div className="flex items-center gap-1">
      {onSplitHorizontal && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onSplitHorizontal}
          title="Split horizontally (Ctrl+\\)"
        >
          <Columns className="h-4 w-4" />
        </Button>
      )}
      {onSplitVertical && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onSplitVertical}
          title="Split vertically"
        >
          <Rows className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default SplitPane;
