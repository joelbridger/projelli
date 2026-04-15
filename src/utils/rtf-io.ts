// RTF IO Utilities
//
// Parse and serialize `.rtf` (Rich Text Format) files for `RtfEditor`.
//
// Projelli previously routed `.rtf` to the internal `.rt` handler, which
// expected Projelli's native HTML-serialized rich text and showed users the
// raw `{\rtf1\ansi...}` markup instead of a rendered document. This module
// implements a minimal but faithful round-trip:
//
//   RTF bytes  ->  HTML  ->  TipTap edits  ->  HTML  ->  RTF bytes
//
// Why a custom parser instead of an off-the-shelf library? The popular RTF
// libraries on npm pull in heavy Node streams or cheerio / juice (tens of MB
// of transitive deps). Projelli ships as a desktop app, so bundle size
// matters. The subset of RTF users realistically produce in Word /
// TextEdit / Pages is small -- control words for paragraphs, bold, italic,
// underline, strikethrough, font/char escapes, and bullet lists cover 95% of
// content. We roll that here in a couple hundred lines and keep `.rtf` as a
// first-class format without dragging in an outsized transitive dependency
// tree.
//
// Coverage (preserved on round-trip):
//   - Paragraphs (\par)
//   - Bold (\b ... \b0)
//   - Italic (\i ... \i0)
//   - Underline (\ul ... \ulnone, \ul0)
//   - Strikethrough (\strike, \strike0)
//   - Line breaks (\line)
//   - Unicode escapes (\'xx hex, \uNNNN ?)
//   - Control symbols ({, }, \, ~, non-breaking hyphen -)
//   - Bulleted lists (output by Word as `\pntext\f... \bullet`-prefixed paras)
//
// NOT preserved (documented via the editor banner):
//   - Tables
//   - Inline images
//   - Specific fonts / font sizes / colors
//   - Page numbers / headers / footers
//   - Comments, footnotes, track changes
//
// Tables / images become plain text; headings (we emit `\fsXX` sizes) are
// preserved visually but degraded to regular paragraphs on re-parse.

import { dataUrlToArrayBuffer } from './spreadsheet-io';

type RtfSource = string | ArrayBuffer;

// ---------------------------------------------------------------------------
// Parse: RTF -> HTML
// ---------------------------------------------------------------------------

interface RtfInlineState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

interface ParserState extends RtfInlineState {
  /** Destinations we ignore entirely (e.g. font/color/info tables). */
  suppressText: boolean;
  /** Nesting depth of `{ ... }` groups. Used to restore state at matching `}`. */
  depth: number;
  /** Current paragraph's inline HTML (no wrapping `<p>`). */
  paragraphHtml: string;
  /** True once the paragraph has started with a \pntext bullet marker. */
  bulletParagraph: boolean;
  /** All completed block HTML, in order. */
  blocks: string[];
}

/** A lightweight stack-frame for `{ ... }` groups so formatting is scoped. */
interface Frame {
  state: RtfInlineState;
  suppressText: boolean;
}

/**
 * Convert `.rtf` source (as bytes or data URL) into semantic HTML we can feed
 * to TipTap.
 */
export async function parseRtf(src: RtfSource): Promise<string> {
  const buffer =
    typeof src === 'string' ? dataUrlToArrayBuffer(src) : src;
  const bytes = new Uint8Array(buffer);
  const text = decodeBytesToAscii(bytes);
  return rtfToHtml(text);
}

/**
 * Decode RTF bytes as Latin-1 (`windows-1252` is effectively a superset for
 * the 7-bit range RTF uses). RTF's own `\'xx` escapes carry non-ASCII chars
 * explicitly, and `\uNNNN` carries Unicode code points, so the 1:1 byte ->
 * char decode here just preserves the bytes unchanged for the tokenizer
 * loop to interpret.
 */
function decodeBytesToAscii(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i]!);
  }
  return out;
}

function rtfToHtml(rtf: string): string {
  const state: ParserState = {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    suppressText: false,
    depth: 0,
    paragraphHtml: '',
    bulletParagraph: false,
    blocks: [],
  };
  const frameStack: Frame[] = [];

  // Destinations that carry formatting instructions rather than visible
  // document text. When we see `{\destname ...}` at the start of a group,
  // suppress text until the group closes.
  const suppressedDestinations = new Set([
    'fonttbl',
    'colortbl',
    'stylesheet',
    'info',
    'author',
    'operator',
    'title',
    'subject',
    'category',
    'keywords',
    'doccomm',
    'hlinkbase',
    'generator',
    'revtbl',
    'filetbl',
    'listtable',
    'listoverridetable',
    'listtext',
    'pntext',
    'pict',
    'object',
    'objdata',
    'datastore',
    'themedata',
    'colorschememapping',
    'latentstyles',
    'datafield',
    'bkmkstart',
    'bkmkend',
    'xe',
    'fldinst',
    'fldrslt',
    'atnid',
    'atnauthor',
    'atnref',
    'atrfstart',
    'atrfend',
    'atnparent',
    'header',
    'footer',
    'headerf',
    'footerf',
    'footnote',
    'rxe',
    'tc',
    'tcn',
  ]);

  // `\pntext` paragraphs are Word's way of emitting bullet markers. We treat
  // any paragraph preceded by a `\pntext{...\bullet ...}` group as a bullet.
  // The mechanism lives per-paragraph in `state.bulletParagraph`.

  let i = 0;
  const len = rtf.length;

  while (i < len) {
    const ch = rtf[i];

    if (ch === '\\') {
      // Control word or control symbol
      const next = rtf[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (!state.suppressText) {
          pushChar(state, next);
        }
        i += 2;
        continue;
      }
      if (next === "'") {
        // Hex escape \'XX -- one byte's worth. Decode as Latin-1 code point
        // so round-trips of non-ASCII produce a reasonable character.
        const hex = rtf.substr(i + 2, 2);
        const code = Number.parseInt(hex, 16);
        if (!Number.isNaN(code) && !state.suppressText) {
          pushChar(state, String.fromCharCode(code));
        }
        i += 4;
        continue;
      }
      if (next === '*') {
        // "\*" marks an optional destination -- if the reader doesn't
        // understand the following control, it must skip the group.
        // We just step over the marker and let the next group's destination
        // check suppress its text.
        i += 2;
        continue;
      }
      if (next === '~') {
        if (!state.suppressText) pushChar(state, '\u00a0');
        i += 2;
        continue;
      }
      if (next === '-') {
        // Non-breaking hyphen -- emit plain hyphen. Good enough for HTML.
        if (!state.suppressText) pushChar(state, '-');
        i += 2;
        continue;
      }
      if (next === '_') {
        if (!state.suppressText) pushChar(state, '\u2011');
        i += 2;
        continue;
      }
      if (next === '\n' || next === '\r') {
        // Line continuation (some tools use \CR as a line break in source)
        i += 2;
        continue;
      }

      // Control word: letters + optional numeric parameter, optional trailing
      // space eaten as delimiter.
      const wordMatch = /^\\([a-zA-Z]+)(-?\d+)?(\s?)/.exec(rtf.slice(i));
      if (!wordMatch) {
        // Unknown control; skip the backslash and next char.
        i += 2;
        continue;
      }
      const word = wordMatch[1]!;
      const param = wordMatch[2] ? Number.parseInt(wordMatch[2], 10) : undefined;
      i += wordMatch[0].length;

      // \uNNNN <fallback-char> -- real Unicode character. Consume the fallback.
      if (word === 'u' && typeof param === 'number') {
        const cp = param < 0 ? 0x10000 + param : param;
        if (!state.suppressText) {
          pushChar(state, String.fromCharCode(cp));
        }
        // Skip one fallback char (ASCII substitute inserted by the writer)
        if (i < len && rtf[i] !== '\\' && rtf[i] !== '{' && rtf[i] !== '}') {
          i += 1;
        }
        continue;
      }

      handleControlWord(state, suppressedDestinations, word, param);
      continue;
    }

    if (ch === '{') {
      frameStack.push({
        state: { ...state },
        suppressText: state.suppressText,
      });
      state.depth += 1;
      i += 1;
      continue;
    }

    if (ch === '}') {
      const frame = frameStack.pop();
      if (frame) {
        state.bold = frame.state.bold;
        state.italic = frame.state.italic;
        state.underline = frame.state.underline;
        state.strike = frame.state.strike;
        state.suppressText = frame.suppressText;
      }
      state.depth = Math.max(0, state.depth - 1);
      i += 1;
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      // Raw line breaks in RTF source are NOT document line breaks -- the
      // writer usually inserts them between control word groups purely for
      // formatting. Skip.
      i += 1;
      continue;
    }

    if (!state.suppressText) {
      pushChar(state, ch!);
    }
    i += 1;
  }

  // Flush any trailing paragraph.
  if (state.paragraphHtml.length > 0) {
    state.blocks.push(renderParagraph(state.paragraphHtml, state.bulletParagraph));
  }

  // Merge consecutive `<li>` blocks inside `<ul>` wrappers.
  return wrapLists(state.blocks);
}

function pushChar(state: ParserState, ch: string) {
  // Wrap in current inline marks so the HTML reflects active formatting.
  state.paragraphHtml += applyMarks(escapeHtmlChar(ch), state);
}

function applyMarks(text: string, s: RtfInlineState): string {
  let out = text;
  if (s.strike) out = `<s>${out}</s>`;
  if (s.underline) out = `<u>${out}</u>`;
  if (s.italic) out = `<em>${out}</em>`;
  if (s.bold) out = `<strong>${out}</strong>`;
  return out;
}

function escapeHtmlChar(ch: string): string {
  if (ch === '&') return '&amp;';
  if (ch === '<') return '&lt;';
  if (ch === '>') return '&gt;';
  return ch;
}

function handleControlWord(
  state: ParserState,
  suppressedDestinations: Set<string>,
  word: string,
  param: number | undefined
) {
  // Destinations that begin a suppressed region: treat as "suppress until end
  // of this group". We set `suppressText` on the current state; the matching
  // `}` restores the previous value.
  if (suppressedDestinations.has(word)) {
    state.suppressText = true;
    return;
  }

  switch (word) {
    case 'par':
      state.blocks.push(renderParagraph(state.paragraphHtml, state.bulletParagraph));
      state.paragraphHtml = '';
      state.bulletParagraph = false;
      return;
    case 'line':
      state.paragraphHtml += '<br />';
      return;
    case 'tab':
      state.paragraphHtml += '\u00a0\u00a0\u00a0\u00a0';
      return;
    case 'bullet':
      // Only meaningful inside \pntext, which we suppress. Outside of
      // that, just emit the bullet character so the text isn't lost.
      state.paragraphHtml += '\u2022 ';
      return;
    case 'b':
      state.bold = param !== 0;
      return;
    case 'i':
      state.italic = param !== 0;
      return;
    case 'ul':
      state.underline = param !== 0;
      return;
    case 'ulnone':
      state.underline = false;
      return;
    case 'strike':
      state.strike = param !== 0;
      return;
    case 'pard':
      // Reset paragraph-level formatting. We don't track alignment/indent
      // etc, so this is a no-op beyond clearing any bullet flag.
      state.bulletParagraph = false;
      return;
    case 'plain':
      // Reset character formatting to defaults.
      state.bold = false;
      state.italic = false;
      state.underline = false;
      state.strike = false;
      return;
    case 'pntext':
      // Followed immediately by a bullet marker group; mark this paragraph
      // as a list item.
      state.bulletParagraph = true;
      state.suppressText = true;
      return;
    case 'pn':
    case 'pnlvlblt':
      // `\pnlvlblt` = bulleted list paragraph numbering level. Word puts it
      // at paragraph start; mark the paragraph.
      state.bulletParagraph = true;
      return;
    default:
      // Unknown control word: ignore. If it introduces an unknown
      // destination via `\*\destname`, the caller's `*` handling steps
      // past the marker, and any visible text inside is still preserved.
      return;
  }
}

function renderParagraph(html: string, isBullet: boolean): string {
  const trimmed = html.replace(/(<br \/>)+$/, '').trim();
  if (isBullet) {
    // Stripped list content. If empty, return an empty marker that
    // `wrapLists` will later group into a `<ul>`.
    return `<li>${trimmed}</li>`;
  }
  if (trimmed.length === 0) {
    return '<p></p>';
  }
  return `<p>${trimmed}</p>`;
}

/**
 * Merge consecutive `<li>` blocks into `<ul>` wrappers. TipTap's StarterKit
 * expects lists to be explicit containers; loose `<li>` elements produce
 * fragile editor state.
 */
function wrapLists(blocks: string[]): string {
  const out: string[] = [];
  let inList = false;
  for (const block of blocks) {
    if (block.startsWith('<li>')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(block);
    } else {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
      out.push(block);
    }
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Serialize: HTML -> RTF
// ---------------------------------------------------------------------------
//
// The writer uses a stripped-down RTF 1.x header (ANSI code page 1252,
// Arial font) and emits control words for the subset of marks TipTap
// produces. Any inline formatting we can't round-trip (custom fonts, exotic
// marks) is silently dropped -- the UI banner warns users about this.

/**
 * Serialize TipTap-produced HTML into `.rtf` bytes.
 */
export async function serializeRtf(html: string): Promise<Uint8Array> {
  const rtf = htmlToRtf(html);
  const bytes = new Uint8Array(rtf.length);
  for (let i = 0; i < rtf.length; i++) {
    bytes[i] = rtf.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function htmlToRtf(html: string): string {
  const doc = new DOMParser().parseFromString(
    `<!doctype html><html><body>${html}</body></html>`,
    'text/html'
  );

  const parts: string[] = [];
  parts.push(
    '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}}\n'
  );
  parts.push('\\viewkind4\\uc1\\pard\\f0\\fs22 ');

  renderBlocks(doc.body, parts, {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
  });

  parts.push('}');
  return parts.join('');
}

interface OutputState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

function renderBlocks(
  parent: Node,
  out: string[],
  _inherit: OutputState
) {
  const children = Array.from(parent.childNodes);
  for (let idx = 0; idx < children.length; idx++) {
    const node = children[idx]!;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.trim().length > 0) {
        out.push(escapeRtfText(text));
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'p') {
      renderInline(el, out, { bold: false, italic: false, underline: false, strike: false });
      out.push('\\par\n');
      continue;
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const size = tag === 'h1' ? 36 : tag === 'h2' ? 28 : 22;
      out.push(`\\pard\\fs${size * 2}\\b `);
      renderInline(el, out, {
        bold: true,
        italic: false,
        underline: false,
        strike: false,
      });
      out.push('\\b0\\fs22\\par\n');
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      for (const li of Array.from(el.children)) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        out.push('\\pard\\fi-360\\li720 ');
        out.push('\\bullet\\tab ');
        renderInline(li as HTMLElement, out, {
          bold: false,
          italic: false,
          underline: false,
          strike: false,
        });
        out.push('\\par\n');
      }
      // Reset paragraph properties after the list so following paragraphs
      // aren't indented.
      out.push('\\pard ');
      continue;
    }
    if (tag === 'blockquote') {
      out.push('\\pard\\li720\\i ');
      renderBlocks(el, out, {
        bold: false,
        italic: true,
        underline: false,
        strike: false,
      });
      out.push('\\i0\\li0\\par\n');
      continue;
    }
    if (tag === 'hr') {
      out.push('\\pard\\par\n');
      continue;
    }
    if (tag === 'br') {
      out.push('\\line ');
      continue;
    }
    // Unknown block: descend.
    renderBlocks(el, out, _inherit);
  }
}

function renderInline(parent: Node, out: string[], state: OutputState) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        out.push(escapeRtfText(text));
      }
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      out.push('\\line ');
      continue;
    }

    const nextState: OutputState = { ...state };
    if (tag === 'strong' || tag === 'b') nextState.bold = true;
    else if (tag === 'em' || tag === 'i') nextState.italic = true;
    else if (tag === 'u') nextState.underline = true;
    else if (tag === 's' || tag === 'strike' || tag === 'del') nextState.strike = true;

    const opened: string[] = [];
    const closed: string[] = [];
    if (nextState.bold !== state.bold) {
      opened.push('\\b ');
      closed.push('\\b0 ');
    }
    if (nextState.italic !== state.italic) {
      opened.push('\\i ');
      closed.push('\\i0 ');
    }
    if (nextState.underline !== state.underline) {
      opened.push('\\ul ');
      closed.push('\\ulnone ');
    }
    if (nextState.strike !== state.strike) {
      opened.push('\\strike ');
      closed.push('\\strike0 ');
    }
    out.push(...opened);
    renderInline(el, out, nextState);
    out.push(...closed);
  }
}

function escapeRtfText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 0x5c) {
      // backslash
      out += '\\\\';
    } else if (ch === 0x7b) {
      out += '\\{';
    } else if (ch === 0x7d) {
      out += '\\}';
    } else if (ch < 0x80) {
      out += text[i];
    } else {
      // Emit as \uNNNN with a `?` fallback for readers that don't support
      // Unicode. RTF 1.x expects signed 16-bit values for \u, so wrap
      // code points > 0x7FFF by subtracting 0x10000.
      const cp = ch > 0x7fff ? ch - 0x10000 : ch;
      out += `\\u${cp}?`;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: RTF -> plain text (for AI ambient context)
// ---------------------------------------------------------------------------

/**
 * Extract plain text from an `.rtf` source suitable for feeding into the AI
 * ambient context store. Goes through the parser so visible text is free of
 * control words but keeps paragraph breaks via `\n`.
 */
export async function extractRtfText(src: RtfSource): Promise<string> {
  const html = await parseRtf(src);
  // Strip tags and collapse whitespace. Keep `\n` at paragraph boundaries.
  const withBreaks = html
    .replace(/<\/(?:p|li|h[1-6]|div|br\s*\/?)>/g, '\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, '');
  const decoded = decodeEntities(withBreaks);
  return decoded.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Bundle RTF bytes back into a data URL for the editor tab's `content`.
 */
export function rtfBytesToDataUrl(bytes: Uint8Array): string {
  const mime = 'application/rtf';
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
