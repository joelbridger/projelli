// Whiteboard Manager Component
// Displays list of whiteboard files and allows creating new ones

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PenTool, Plus, FileText, Trash2 } from 'lucide-react';

interface WhiteboardFile {
  path: string;
  name: string;
}

interface WhiteboardManagerProps {
  whiteboards: WhiteboardFile[];
  onCreateWhiteboard: () => void;
  onOpenWhiteboard: (path: string, name: string) => void;
  onDeleteWhiteboard?: (path: string) => void;
  className?: string;
}

export function WhiteboardManager({
  whiteboards,
  onCreateWhiteboard,
  onOpenWhiteboard,
  onDeleteWhiteboard,
  className,
}: WhiteboardManagerProps) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header with create button */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <PenTool className="h-4 w-4" />
          Whiteboards
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={onCreateWhiteboard}
          title="Create new whiteboard"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* Whiteboard list */}
      <div className="flex-1 overflow-auto p-2">
        {whiteboards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <PenTool className="h-8 w-8 mb-2 opacity-30" />
            <p className="text-xs text-center">No whiteboards yet</p>
            <Button
              variant="link"
              size="sm"
              className="mt-1 text-xs h-auto p-0"
              onClick={onCreateWhiteboard}
            >
              Create your first whiteboard
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {whiteboards.map((wb) => (
              <div
                key={wb.path}
                className="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-muted cursor-pointer group"
                onMouseEnter={() => setHoveredItem(wb.path)}
                onMouseLeave={() => setHoveredItem(null)}
                onClick={() => onOpenWhiteboard(wb.path, wb.name)}
              >
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm truncate flex-1">
                  {wb.name.replace('.whiteboard', '')}
                </span>
                {hoveredItem === wb.path && onDeleteWhiteboard && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWhiteboard(wb.path);
                    }}
                    title="Delete whiteboard"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info section */}
      <div className="px-3 py-2 border-t text-xs text-muted-foreground">
        <p>Whiteboards open as full tabs in the editor.</p>
      </div>
    </div>
  );
}

export default WhiteboardManager;
