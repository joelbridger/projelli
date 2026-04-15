// Reusable empty-state component for sidebar panels
//
// Used across Files, Search, AI Audit, Trash, and Whiteboard panels to give
// each empty panel a consistent shape: icon, title, description, optional
// CTA, and optional keyboard-shortcut hint.
//
// The component intentionally stays visually quiet — centered muted content
// inside a flex column — so individual panels can drop it in without any
// layout wrapping and still fill their available height.
//
// Panel name goes into `data-testid="empty-state-{panelName}"` so tests can
// pin each one independently.
//
// Introduced in UX-07 (Wave 2).
//
// Props:
//   - icon: a Lucide icon component (e.g. FolderTree, Search)
//   - title: 1-line heading, shown bold
//   - description: 1-2 sentence explanation of what this panel does
//   - cta?: optional { label, onClick } — renders a primary-styled button
//   - shortcut?: optional keyboard hint shown below description (e.g. "Ctrl+N")
//   - panelName: used to build the data-testid

import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  cta?: {
    label: string;
    onClick: () => void;
  };
  shortcut?: string;
  panelName: string;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  cta,
  shortcut,
  panelName,
  className,
}: EmptyStateProps) {
  return (
    <div
      data-testid={`empty-state-${panelName}`}
      className={cn(
        'flex flex-col items-center justify-center h-full p-6 text-center text-muted-foreground',
        className
      )}
    >
      <Icon className="h-10 w-10 mb-3 opacity-30" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      <p className="text-xs max-w-[260px] leading-relaxed">{description}</p>
      {shortcut && (
        <p
          data-testid={`empty-state-${panelName}-shortcut`}
          className="text-xs mt-2 font-mono text-foreground/70"
        >
          {shortcut}
        </p>
      )}
      {cta && (
        <Button
          data-testid={`empty-state-${panelName}-cta`}
          variant="outline"
          size="sm"
          className="mt-4 h-8 text-xs"
          onClick={cta.onClick}
        >
          {cta.label}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
