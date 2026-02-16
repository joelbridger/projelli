// Outline Panel Component
// Shows document headings for quick navigation

import { useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, Hash } from 'lucide-react';

export interface OutlineHeading {
  id: string;
  text: string;
  level: number; // 1-6
  lineNumber: number;
}

interface OutlinePanelProps {
  content: string;
  onHeadingClick?: (lineNumber: number) => void;
  activeLineNumber?: number;
  className?: string;
}

/**
 * Parse markdown content to extract headings
 */
export function parseHeadings(content: string): OutlineHeading[] {
  const lines = content.split('\n');
  const headings: OutlineHeading[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Match markdown headings (# through ######)
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && match[1] && match[2]) {
      const level = match[1].length;
      const text = match[2].trim();

      headings.push({
        id: `heading-${i}-${text.toLowerCase().replace(/\s+/g, '-')}`,
        text,
        level,
        lineNumber: i + 1, // 1-based line numbers
      });
    }
  }

  return headings;
}

/**
 * Build hierarchical tree from flat headings list
 */
export interface OutlineNode extends OutlineHeading {
  children: OutlineNode[];
}

function buildHeadingTree(headings: OutlineHeading[]): OutlineNode[] {
  const root: OutlineNode[] = [];
  const stack: { node: OutlineNode; level: number }[] = [];

  for (const heading of headings) {
    const node: OutlineNode = { ...heading, children: [] };

    // Pop nodes from stack that are same level or higher
    while (stack.length > 0) {
      const last = stack[stack.length - 1];
      if (last && last.level >= heading.level) {
        stack.pop();
      } else {
        break;
      }
    }

    if (stack.length === 0) {
      // Top-level heading
      root.push(node);
    } else {
      // Add as child of the last node
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.node.children.push(node);
      }
    }

    stack.push({ node, level: heading.level });
  }

  return root;
}

export function OutlinePanel({
  content,
  onHeadingClick,
  activeLineNumber,
  className,
}: OutlinePanelProps) {
  const headings = useMemo(() => parseHeadings(content), [content]);
  const tree = useMemo(() => buildHeadingTree(headings), [headings]);

  const handleClick = useCallback(
    (lineNumber: number) => {
      onHeadingClick?.(lineNumber);
    },
    [onHeadingClick]
  );

  // Find which heading is currently active (closest preceding heading to activeLineNumber)
  const activeHeadingLine = useMemo(() => {
    if (!activeLineNumber) return undefined;
    let closest: number | undefined;
    for (const h of headings) {
      if (h.lineNumber <= activeLineNumber) {
        closest = h.lineNumber;
      } else {
        break;
      }
    }
    return closest;
  }, [headings, activeLineNumber]);

  if (headings.length === 0) {
    return (
      <div className={cn('p-4 text-sm text-muted-foreground', className)}>
        No headings found
      </div>
    );
  }

  return (
    <div className={cn('overflow-auto', className)}>
      <div className="p-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 py-1 mb-1">
          Outline
        </div>
        <nav className="space-y-0.5">
          {tree.map((node) => (
            <OutlineNodeItem
              key={node.id}
              node={node}
              onHeadingClick={handleClick}
              activeLineNumber={activeHeadingLine}
            />
          ))}
        </nav>
      </div>
    </div>
  );
}

interface OutlineNodeItemProps {
  node: OutlineNode;
  onHeadingClick: (lineNumber: number) => void;
  activeLineNumber: number | undefined;
  depth?: number;
}

function OutlineNodeItem({
  node,
  onHeadingClick,
  activeLineNumber,
  depth = 0,
}: OutlineNodeItemProps) {
  const hasChildren = node.children.length > 0;
  const isActive = node.lineNumber === activeLineNumber;

  return (
    <div>
      <button
        onClick={() => onHeadingClick(node.lineNumber)}
        className={cn(
          'flex items-center gap-1.5 w-full text-left px-2 py-1 rounded-sm text-sm transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          isActive && 'bg-accent text-accent-foreground font-medium',
          !isActive && 'text-muted-foreground'
        )}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        {hasChildren ? (
          <ChevronDown className="h-3 w-3 flex-shrink-0" />
        ) : (
          <Hash className="h-3 w-3 flex-shrink-0 opacity-50" />
        )}
        <span className="truncate">{node.text}</span>
      </button>
      {hasChildren && (
        <div className="ml-0">
          {node.children.map((child) => (
            <OutlineNodeItem
              key={child.id}
              node={child}
              onHeadingClick={onHeadingClick}
              activeLineNumber={activeLineNumber}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default OutlinePanel;
