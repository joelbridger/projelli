/**
 * In-app changelog for the "What's new" modal (UX-20).
 *
 * The source of truth for release notes is `CHANGELOG.md` at the repo root,
 * but that file is long and full of engineering detail that end users don't
 * care about. This list is the user-facing slice — pick one heading and a
 * few bullet points per version. Add a new entry at the TOP of the array
 * when cutting a release.
 *
 * The top entry's `version` drives the toast — if it doesn't match the
 * user's last-seen version in localStorage (and they've used the app before),
 * the toast fires once to surface this list.
 */

import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

export interface ChangelogEntry {
  /** Exact semantic version (matches package.json + the release tag). */
  version: string;
  /** Short date label for the modal header. */
  date: string;
  /** Highlights — one sentence each, written for the user. */
  highlights: string[];
}

export const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    version: '1.5.0',
    date: '2026-04-16',
    highlights: [
      brandText(`Memory: ${BRAND.name} indexes your notes and can recall the right paragraph when you ask (use @workspace in any chat)`),
      'Memory facts: a short list of user-approved truths the AI always sees, edit them under Settings → Memory',
      'MCP server: install the bundled .mcpb into Claude Desktop, Cursor, or Zed to read and search your workspace from any AI client',
      'Side-by-side AI editing: select text, ask for a revision, accept or reject each change hunk-by-hunk with version history',
      'Ollama support: run Llama, Mistral, Phi, or any local model for free and offline, no API key needed',
      'Voice input: press-to-talk dictation that transcribes on-device and inserts into any text field',
      'Run the same prompt on all 3 providers in parallel and keep the answer you like',
      'Template chaining: Competitor Analysis → Pricing Strategy, User Interviews → Customer Persona, one click',
      'Multi-interview synthesis: drop 3+ transcripts and get themes, contradictions, JTBD, and priority features',
      'Monthly cost dashboard, real-time cost chip per chat, and audit log export to CSV or JSON',
      'Mermaid and KaTeX rendering in Markdown preview, plus wiki-link autocomplete with [[',
      'Smart paste: drop a URL and get [title](url), paste an image and it auto-saves to media/',
    ],
  },
  {
    version: '1.0.8',
    date: '2026-04-16',
    highlights: [
      brandText(`Auto-updates: ${BRAND.name} now checks for new versions and installs them with one click`),
      'Document suite: open, edit, and create Excel, Word, PowerPoint, and RTF files',
      'Spreadsheets now have a live formula engine that recomputes dependent cells as you type',
      'AI sees your open files automatically, so you can ask questions about your spreadsheet or doc without pasting',
      'Workflow runs are saved as real files you can reopen, with live links to every output',
      'Find anything in your workspace with full-text content search and Ctrl+P quick-open',
      'Redesigned start screen with a fresh, branded look',
    ],
  },
  {
    version: '1.0.7',
    date: '2026-04-15',
    highlights: [
      'Drag and drop files into the window to add them to your workspace',
      'Tab close buttons hide until you hover, cleaning up visual noise',
      'Sidebar icons show tooltips with labels and shortcuts when collapsed',
      'Theme toggle now cycles System → Light → Dark and follows your OS setting',
      'Markdown and plain text editors show word counts like other editors',
      'History button is hidden on file types that do not track version history',
      'A "What\u2019s new" dialog surfaces highlights after each app update',
    ],
  },
  {
    version: '1.0.6',
    date: '2026-04-15',
    highlights: [
      'Clickable breadcrumbs in the status bar navigate up through folders',
      'Rename, delete, and bulk-delete flows confirm before destructive changes',
      'New "create file" dialog shows where the file will go and a filename preview',
      'Editor toolbar collapses into an overflow menu at narrow widths',
      'Workflow cards truncate cleanly and tooltip the full name',
      'Auto-save indicator shows real state (saving, saved, unsaved, error)',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-04-14',
    highlights: [
      'All 3 AI providers (Claude, OpenAI, Gemini) shown simultaneously in Keys tab',
      'Workflows panel now fills the sidebar with a full-view modal option',
      'Press ? anywhere to see every keyboard shortcut',
      'Sidebar tabs are now proper ARIA tablists with arrow-key navigation',
    ],
  },
];

/** Convenience: the top entry represents the "current" release. */
export function currentChangelog(): ChangelogEntry | undefined {
  return CHANGELOG_ENTRIES[0];
}
