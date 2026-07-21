// Pure rendering + formatting helpers extracted from AIChatViewer.
// These are plain functions (no React hooks); several return JSX. Moved here
// verbatim during the AIChatViewer split so the component file stays focused.

import { Sparkles, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';
import { escapeHtmlText } from '@/platform/render/htmlSanitize';
import { OCR_LOW_CONFIDENCE } from '@/platform/utils/tauri-commands';
import { parseCitations, resolveCitationPath, resolveCitationTarget } from '@/platform/rag/workspaceCommand';
import type { AIChatFile, ChatMessage, PersistedCitation, WorkspaceSource } from '@/platform/types/ai';

/**
 * Render markdown-like formatting for messages
 */
export function renderMessage(content: string): string {
  // R-14 — this was one of four hand-rolled markdown→HTML escapes, each with a
  // different subset of the rules. This one emits no `<a>`/`<img>` at all, so
  // it never had the attribute hole MarkdownPreview did; it routes through the
  // shared escape anyway, because "this renderer happens not to build an
  // attribute today" is the assumption that produced the other three.
  let html = escapeHtmlText(content);

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="my-2 p-3 rounded bg-muted overflow-x-auto max-w-full"><code class="font-mono text-sm whitespace-pre-wrap break-all">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded bg-muted font-mono text-sm">$1</code>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
}

/**
 * M2 — Render the user's `@workspace` command as a visible chip. The
 * chip is non-interactive; it exists purely so the user can see that
 * retrieval fired. We render it as a React fragment (not an HTML string
 * dangerously-set into a div) so the markup stays accessible.
 */
export function renderMessageWithWorkspaceChip(content: string): React.ReactNode {
  // Reuse the parser to locate every occurrence of the tag, then split
  // around them so we can replace with a styled span while keeping the
  // surrounding markdown rendered via `renderMessage`.
  const tagRe = /(^|[\s])@workspace(?=$|[\s\p{P}])/gu;
  const parts: Array<{ type: 'text' | 'chip'; content: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(content)) !== null) {
    const tagStart = m.index + (m[1]?.length ?? 0);
    const tagEnd = tagStart + '@workspace'.length;
    if (tagStart > last) {
      parts.push({ type: 'text', content: content.slice(last, tagStart) });
    }
    parts.push({ type: 'chip', content: '@workspace' });
    last = tagEnd;
  }
  if (last < content.length) {
    parts.push({ type: 'text', content: content.slice(last) });
  }
  if (parts.length === 0) {
    return (
      <span
        // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
        dangerouslySetInnerHTML={{ __html: renderMessage(content) }}
      />
    );
  }
  return (
    <span>
      {parts.map((p, idx) =>
        p.type === 'chip' ? (
          <span
            key={`chip-${idx}`}
            data-testid="workspace-command-chip"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium text-xs mx-0.5 align-baseline"
            title="Workspace retrieval will run for this message"
          >
            <Sparkles className="h-3 w-3" />
            @workspace
          </span>
        ) : (
          <span
            key={`text-${idx}`}
            // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
            dangerouslySetInnerHTML={{ __html: renderMessage(p.content) }}
          />
        ),
      )}
    </span>
  );
}

/**
 * VG-2 — is this source a low-confidence OCR read? True only for an
 * OCR-extracted chunk whose page confidence sits below the shared
 * `OCR_LOW_CONFIDENCE` threshold (a missing confidence is not "low" — the
 * two values are always written together).
 */
export function isLowConfidenceScan(extraction?: string, extractionConfidence?: number): boolean {
  return (
    extraction === 'ocr' &&
    extractionConfidence !== undefined &&
    extractionConfidence < OCR_LOW_CONFIDENCE
  );
}

/**
 * VG-2 — the honest OCR disclosure appended to a citation label:
 * " (scanned)" for an OCR-read source, " (low-confidence scan)" below the
 * threshold, "" for native text. Module-level (no hook context), so it reads
 * the global i18n instance like other non-component label code.
 */
export function ocrLabelSuffix(extraction?: string, extractionConfidence?: number): string {
  if (extraction !== 'ocr') return '';
  return isLowConfidenceScan(extraction, extractionConfidence)
    ? ` (${i18n.t('citation.scanned-low')})`
    : ` (${i18n.t('citation.scanned')})`;
}

/**
 * VG-2b (+ the Wave-1 follow-up (f) nit) — display label for a citation chip
 * or sources-accordion row. Page-keyed sources say their honest locator:
 * "p. N" for PDF pages, "sheet N" / "slide N" for office sections (the REAL
 * 1-based number carried in pageNumber). VG-3c: certified transcript chunks
 * say the lawyer's cite — "Tr. 45:12-46:3" from the page:line locator (the
 * basename stays in the chip/row title attr). Everything else keeps the
 * paragraph anchor (§N). VG-2: OCR-read sources append the
 * scanned/low-confidence disclosure. LABELS ONLY: the chip's resolution key
 * and testid grammar (basename + paragraphIndex) are deliberately untouched.
 */
export function citationDisplayLabel(
  basename: string,
  paragraphIndex: number,
  sourceType?: string,
  pageNumber?: number,
  extraction?: string,
  extractionConfidence?: number,
  locator?: string,
  path?: string,
): string {
  const suffix = ocrLabelSuffix(extraction, extractionConfidence);
  if (sourceType === 'transcript' && locator) {
    return `Tr. ${locator}`;
  }
  if (pageNumber != null) {
    if (sourceType === 'pdf') return `${basename} p. ${String(pageNumber)}${suffix}`;
    if (sourceType === 'xlsx') return `${basename} sheet ${String(pageNumber)}${suffix}`;
    if (sourceType === 'pptx') return `${basename} slide ${String(pageNumber)}${suffix}`;
  }
  if (sourceType === 'onedrive') return `OneDrive - ${basename}${suffix}`;
  if (sourceType === 'esign') return `DocuSign - ${basename}${suffix}`;
  if (sourceType === 'meeting') {
    const label = path?.startsWith('calendar:') ? 'Calendar' : 'Calendly';
    return `${label} - ${basename}${suffix}`;
  }
  if (sourceType === 'box') return `Box - ${basename}${suffix}`;
  if (sourceType === 'jotform') return `Jotform - ${basename}${suffix}`;
  if (sourceType === 'sharefile') return `ShareFile - ${basename}${suffix}`;
  if (sourceType === 'zocks') return `Zocks - ${basename}${suffix}`;
  if (sourceType === 'addepar') return `Addepar - ${basename}${suffix}`;
  return `${basename} §${String(paragraphIndex)}${suffix}`;
}

/**
 * M2 — Render an assistant response with any `[filename paragraph N]`
 * citations turned into clickable chips that navigate to the file. The
 * surrounding text is still rendered with the same markdown helper as
 * before; only the citation substrings are replaced with React elements.
 */
export function renderMessageWithCitations(
  content: string,
  sources: WorkspaceSource[] | undefined,
  onCitationClick: (
    path: string,
    paragraphIndex: number,
    sourceType?: string,
    pageNumber?: number,
    snippet?: string,
  ) => void,
  onMissingCitation: (basename: string) => void,
): React.ReactNode {
  const citations = parseCitations(content);
  if (citations.length === 0) {
    return (
      <span
        // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
        dangerouslySetInnerHTML={{ __html: renderMessage(content) }}
      />
    );
  }
  const pieces: React.ReactNode[] = [];
  let last = 0;
  citations.forEach((cite, idx) => {
    if (cite.start > last) {
      const text = content.slice(last, cite.start);
      pieces.push(
        <span
          key={`c-pre-${idx}`}
          // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
          dangerouslySetInnerHTML={{ __html: renderMessage(text) }}
        />,
      );
    }
    const resolved = resolveCitationPath(cite, sources ?? []);
    const testId = `chat-citation-${cite.basename}-${cite.paragraphIndex}`;
    // WS-B/C — find the source this citation resolves to so we can reflect its
    // verification state. `verified === false` means the citation did NOT
    // verify against the local store (fabricated id / matter mismatch /
    // misquote) and must be flagged. `true` is safe to present.
    // Prefer the exact chunk (path + paragraphIndex) so the F-504 scroll
    // snippet is the cited passage, not a sibling chunk of the same file
    // (Task 5 review); fall back to path-only.
    const matchedSource =
      (sources ?? []).find(
        (s) =>
          s.path === resolved &&
          (s.paragraphIndex === cite.paragraphIndex || s.pageNumber === cite.paragraphIndex),
      ) ?? (sources ?? []).find((s) => s.path === resolved);
    // VG-2b/(f): page-keyed sources label "p. N" / "sheet N" / "slide N".
    // VG-2: OCR-read sources disclose "(scanned)" / "(low-confidence scan)".
    // VG-3c: transcript sources label the lawyer's cite "Tr. page:line".
    const label = citationDisplayLabel(
      cite.basename,
      cite.paragraphIndex,
      matchedSource?.sourceType,
      matchedSource?.pageNumber,
      matchedSource?.extraction,
      matchedSource?.extractionConfidence,
      matchedSource?.locator,
      matchedSource?.path ?? resolved ?? undefined,
    );
    // BUG-065: STRICT trust display. Green "source found" ONLY when we proved the
    // exact retrieved source (resolved) AND it verified. Anything else — an
    // unresolved locator OR a resolved-but-not-verified source — is a red
    // "Unverified" flag, never a normal-looking chip.
    const proven = resolved !== null && matchedSource?.verified === true;
    // VG-2: a low-confidence scan carries the fuller warning in the chip title.
    const lowConfidenceScan = isLowConfidenceScan(
      matchedSource?.extraction,
      matchedSource?.extractionConfidence,
    );
    pieces.push(
      <button
        key={`cite-${idx}`}
        type="button"
        data-testid={testId}
        data-verified={
          matchedSource?.verified === undefined
            ? 'unknown'
            : matchedSource.verified
              ? 'true'
              : 'false'
        }
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 rounded border text-xs font-medium align-baseline',
          proven
            ? 'border-emerald-400/60 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            : 'border-red-400/60 bg-red-50 text-red-700 hover:bg-red-100',
        )}
        onClick={() => {
          if (resolved) {
            // A3: look up sourceType + pageNumber from the matched source.
            // F-504: pass the cited chunk's text so the editor can scroll
            // to the exact passage by search.
            onCitationClick(
              resolved,
              cite.paragraphIndex,
              matchedSource?.sourceType,
              matchedSource?.pageNumber,
              matchedSource?.chunkText,
            );
          } else {
            onMissingCitation(cite.basename);
          }
        }}
        title={(() => {
          const base = proven
            ? `Source found — open ${resolved}`
            : resolved
              ? `Unverified. Could not confirm "${label}" against the source. Do not rely on this without checking.`
              : 'Unverified: the cited source could not be found in what was retrieved. Do not rely on this without checking.';
          // VG-2: the fuller low-confidence sentence rides the chip title.
          return lowConfidenceScan ? `${base}\n${i18n.t('citation.scanned-low-title')}` : base;
        })()}
      >
        {proven ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <AlertTriangle className="h-3 w-3" />
        )}
        {label}
      </button>,
    );
    last = cite.end;
  });
  if (last < content.length) {
    const tail = content.slice(last);
    pieces.push(
      <span
        key="c-tail"
        // eslint-disable-next-line react/no-danger -- markdown rendered by the pre-existing renderMessage helper
        dangerouslySetInnerHTML={{ __html: renderMessage(tail) }}
      />,
    );
  }
  return <span>{pieces}</span>;
}

/**
 * Convert chat to markdown for export
 */
export function chatToMarkdown(chat: AIChatFile): string {
  let markdown = `# ${chat.title}\n\n`;
  markdown += `**Created:** ${new Date(chat.created).toLocaleString()}\n`;
  markdown += `**Updated:** ${new Date(chat.updated).toLocaleString()}\n\n`;
  markdown += `---\n\n`;

  for (const msg of chat.messages) {
    const timestamp = new Date(msg.timestamp).toLocaleString();
    const role = msg.role === 'user' ? 'You' : 'Assistant';
    markdown += `## ${role} (${timestamp})\n\n`;
    markdown += `${msg.content}\n\n`;
    const citationVerification = msg.role === 'assistant'
      ? formatCitationVerificationForMarkdown(msg)
      : '';
    if (citationVerification !== '') {
      markdown += citationVerification;
      markdown += '\n';
    }
    markdown += `---\n\n`;
  }

  return markdown;
}

function formatCitationVerificationForMarkdown(msg: ChatMessage): string {
  const citations =
    msg.askCitations && msg.askCitations.length > 0
      ? markdownRowsFromPersistedCitations(msg)
      : markdownRowsFromWorkspaceSources(msg);
  if (citations.length === 0) return '';

  const lines = ['### Sources and verification', ''];

  for (const citation of citations) {
    const status = citation.verified ? 'Source found' : 'UNVERIFIED';
    lines.push(`- ${String(citation.n)}. **${status}** - ${citation.label}`);
    lines.push(`  - Path: ${citation.path ?? 'Unresolved source'}`);
    if (citation.locator && citation.locator.trim() !== '') {
      lines.push(`  - Locator: ${citation.locator}`);
    }
    if (citation.excerpt.trim() !== '') {
      lines.push(`  - Excerpt: ${oneLineMarkdownValue(citation.excerpt)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

interface MarkdownCitationVerificationRow {
  n: number;
  label: string;
  path: string | null;
  locator: string | undefined;
  excerpt: string;
  verified: boolean;
}

function markdownRowsFromPersistedCitations(msg: ChatMessage): MarkdownCitationVerificationRow[] {
  return (msg.askCitations ?? []).map((citation) => ({
    n: citation.n,
    label: citation.label,
    path: citation.path,
    locator: citation.locator,
    excerpt: citation.excerpt,
    verified: isPersistedCitationVerifiedForExport(citation, msg),
  }));
}

function isPersistedCitationVerifiedForExport(citation: PersistedCitation, msg: ChatMessage): boolean {
  if (citation.path === null || !citation.verified) {
    return false;
  }

  const source = findSourceForPersistedCitation(citation, [
    ...(msg.askSources ?? []),
    ...(msg.sources ?? []),
  ]);
  if (!source) return false;
  return source.verified === undefined ? citation.verified : source.verified;
}

function findSourceForPersistedCitation(
  citation: PersistedCitation,
  sources: WorkspaceSource[],
): WorkspaceSource | undefined {
  if (citation.id) {
    const byId = sources.find((source) => source.id === citation.id);
    if (byId) return byId;
  }

  if (citation.path === null) return undefined;

  return (
    sources.find(
      (source) =>
        source.path === citation.path &&
        (citation.paragraphIndex === undefined ||
          source.paragraphIndex === citation.paragraphIndex ||
          source.pageNumber === citation.paragraphIndex),
    ) ?? sources.find((source) => source.path === citation.path)
  );
}

function markdownRowsFromWorkspaceSources(msg: ChatMessage): MarkdownCitationVerificationRow[] {
  const sources = msg.sources ?? [];
  if (sources.length === 0) return [];

  return parseCitations(msg.content).map((citation, index) => {
    const source = resolveCitationTarget(citation, sources);
    const label = source
      ? citationDisplayLabel(
          citation.basename,
          citation.paragraphIndex,
          source.sourceType,
          source.pageNumber,
          source.extraction,
          source.extractionConfidence,
          source.locator,
          source.path,
        )
      : `${citation.basename} §${String(citation.paragraphIndex)}`;
    return {
      n: index + 1,
      label,
      path: source?.path ?? null,
      locator: source?.locator,
      excerpt: source?.chunkText ?? '',
      verified: source?.verified === true,
    };
  });
}

function oneLineMarkdownValue(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
