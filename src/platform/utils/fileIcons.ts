/**
 * UX-37: Single source of truth for per-extension file icons and colors.
 *
 * Consumed by FileTree, TabBar, FileGridView, and any future surface that
 * displays a file icon. Replaces the duplicated switch statements that
 * previously lived in each component (with the duplicate `case 'webm'`
 * warning in FileTree as the most visible symptom).
 *
 * The mapping is designed to be instantly scannable: spreadsheets green,
 * word docs blue, presentations orange, media pink/purple, etc.
 */

import {
  Braces,
  File,
  FileText,
  Film,
  Image,
  Link,
  Music,
  Presentation,
  Sparkles,
  Table,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface FileIconInfo {
  /** Lucide React component for the icon. */
  Icon: LucideIcon;
  /** Tailwind text-color class. */
  color: string;
  /** Optional human-readable label (unused in rendering; for a11y / tooltips). */
  label?: string;
}

const ICON_MAP: Record<string, FileIconInfo> = {
  // Markdown / plain text
  md:       { Icon: FileText,     color: 'text-zinc-500',    label: 'Markdown' },
  markdown: { Icon: FileText,     color: 'text-zinc-500',    label: 'Markdown' },
  txt:      { Icon: FileText,     color: 'text-zinc-500',    label: 'Text' },

  // Rich text
  rt:       { Icon: Type,         color: 'text-indigo-500',  label: 'Rich Text' },
  rtf:      { Icon: Type,         color: 'text-indigo-500',  label: 'Rich Text' },

  // Word
  docx:     { Icon: FileText,     color: 'text-blue-500',    label: 'Word' },
  doc:      { Icon: FileText,     color: 'text-blue-500',    label: 'Word' },

  // Spreadsheets
  xlsx:     { Icon: Table,        color: 'text-emerald-500', label: 'Excel' },
  xls:      { Icon: Table,        color: 'text-emerald-500', label: 'Excel' },
  csv:      { Icon: Table,        color: 'text-emerald-500', label: 'CSV' },

  // Presentations
  pptx:     { Icon: Presentation, color: 'text-orange-500',  label: 'PowerPoint' },
  ppt:      { Icon: Presentation, color: 'text-orange-500',  label: 'PowerPoint' },

  // PDF
  pdf:      { Icon: FileText,     color: 'text-red-500',     label: 'PDF' },

  // Images
  png:      { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  jpg:      { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  jpeg:     { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  gif:      { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  webp:     { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  svg:      { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  bmp:      { Icon: Image,        color: 'text-purple-500',  label: 'Image' },
  ico:      { Icon: Image,        color: 'text-purple-500',  label: 'Image' },

  // Video
  mp4:      { Icon: Film,         color: 'text-pink-500',    label: 'Video' },
  webm:     { Icon: Film,         color: 'text-pink-500',    label: 'Video' },
  mov:      { Icon: Film,         color: 'text-pink-500',    label: 'Video' },
  avi:      { Icon: Film,         color: 'text-pink-500',    label: 'Video' },
  mkv:      { Icon: Film,         color: 'text-pink-500',    label: 'Video' },

  // Audio
  mp3:      { Icon: Music,        color: 'text-pink-400',    label: 'Audio' },
  wav:      { Icon: Music,        color: 'text-pink-400',    label: 'Audio' },
  m4a:      { Icon: Music,        color: 'text-pink-400',    label: 'Audio' },
  ogg:      { Icon: Music,        color: 'text-pink-400',    label: 'Audio' },

  // Data / structured
  json:     { Icon: Braces,       color: 'text-amber-500',   label: 'JSON' },

  // Keepance-specific
  source:   { Icon: Link,         color: 'text-cyan-500',    label: 'Source' },
  aichat:   { Icon: Sparkles,     color: 'text-fuchsia-500', label: 'AI Chat' },
  workflow: { Icon: Workflow,     color: 'text-amber-500',   label: 'Workflow Run' },
};

const DEFAULT_ICON: FileIconInfo = {
  Icon: File,
  color: 'text-zinc-500',
  label: 'File',
};

/**
 * Look up the icon, color, and label for a file extension.
 *
 * @param extension Lower-cased file extension without the leading dot.
 *                  Pass `undefined` for files with no extension.
 */
export function getFileIcon(extension: string | undefined): FileIconInfo {
  if (!extension) return DEFAULT_ICON;
  return ICON_MAP[extension.toLowerCase()] ?? DEFAULT_ICON;
}
