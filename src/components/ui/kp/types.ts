import type { LucideIcon } from 'lucide-react';

/**
 * An icon component for the library. Every icon in Keepance is a lucide-react
 * icon, so we alias lucide's own type — components take the icon *component*
 * (not a rendered element) so they can size it from the design tokens, which is
 * how icon sizing stays consistent across the app.
 */
export type IconType = LucideIcon;
