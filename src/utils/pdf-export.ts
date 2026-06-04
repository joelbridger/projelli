// PDF Export Utility
//
// Produces a PDF from a markdown string by:
//   1. Converting markdown to HTML with the existing renderMarkdownToHtml
//      pipeline (same renderer as the in-app preview, so what you see is
//      what you print).
//   2. Opening a blank popup window and building the print document entirely
//      via safe DOM construction (createElement / textContent / stylesheet).
//      No document.write() is used. The rendered HTML from step 1 is injected
//      via innerHTML on a single container div — the same trust boundary as
//      dangerouslySetInnerHTML in MarkdownPreview.tsx. The markdown→HTML
//      pipeline already escapes raw < and & from the source before any inline
//      formatting is applied, so the HTML string is safe to insert this way.
//   3. Calling window.print() on the popup, which surfaces the OS
//      print-to-PDF dialog.
//
// Why print-to-PDF instead of a PDF library?
//   - No new dependencies: pdfjs-dist (the only PDF lib in package.json) is a
//     reader, not a writer. jsPDF / html2canvas are not installed.
//   - Quality: the system renderer handles fonts, KaTeX, Mermaid SVG, and
//     complex layout far better than any JavaScript serializer would.
//   - Local-first: no server round-trip. Works identically in the browser
//     build and in Tauri (Tauri's WebView honours window.open + print).
//
// Limitations:
//   - The dialog is the OS print dialog. The user must choose "Save as PDF"
//     themselves (on Windows "Microsoft Print to PDF", on macOS the PDF
//     dropdown). This is intentional: it keeps the user in control and avoids
//     binary-writing permissions we would otherwise need in Tauri.
//   - Mermaid diagrams: because mermaid.render() runs in the originating
//     window's context and the print window gets a fresh document, mermaid
//     code blocks will appear as literal fenced text in the PDF. This is an
//     accepted limitation; the text content is still present.

import { renderMarkdownToHtml } from '@/components/editor/MarkdownPreview';

/** CSS rules for the print document, as a single string injected via a stylesheet node. */
const PRINT_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  @page {
    size: letter;
    margin: 1in 1.1in 1in 1.1in;
  }

  html, body {
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 11pt;
    line-height: 1.6;
    color: #111;
    background: #fff;
  }

  h1 { font-size: 20pt; font-weight: bold; margin: 0 0 12pt 0; border-bottom: 1px solid #ccc; padding-bottom: 6pt; }
  h2 { font-size: 16pt; font-weight: bold; margin: 18pt 0 8pt 0; border-bottom: 1px solid #e0e0e0; padding-bottom: 4pt; }
  h3 { font-size: 13pt; font-weight: bold; margin: 14pt 0 6pt 0; }
  h4, h5, h6 { font-size: 11pt; font-weight: bold; margin: 10pt 0 4pt 0; }

  p { margin: 0 0 8pt 0; }

  ul, ol { margin: 6pt 0 8pt 1.5em; padding: 0; }
  li { margin-bottom: 3pt; }

  blockquote {
    border-left: 3px solid #aaa;
    margin: 8pt 0 8pt 1em;
    padding: 4pt 0 4pt 12pt;
    color: #444;
    font-style: italic;
  }

  code {
    font-family: 'Courier New', Courier, monospace;
    font-size: 9pt;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 2px;
    padding: 0 3pt;
  }
  pre {
    font-family: 'Courier New', Courier, monospace;
    font-size: 9pt;
    background: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
    padding: 10pt 12pt;
    margin: 8pt 0;
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre code { background: none; border: none; padding: 0; }

  a { color: #1a56db; text-decoration: underline; }

  img { max-width: 100%; height: auto; margin: 8pt 0; }

  hr { border: none; border-top: 1px solid #ccc; margin: 14pt 0; }

  table { border-collapse: collapse; width: 100%; margin: 8pt 0; }
  th, td { border: 1px solid #ccc; padding: 5pt 8pt; text-align: left; font-size: 10pt; }
  th { background: #f0f0f0; font-weight: bold; }

  input[type="checkbox"] { margin-right: 5pt; }

  strong { font-weight: bold; }
  em { font-style: italic; }
  del { text-decoration: line-through; color: #666; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    a[href]::after { content: " (" attr(href) ")"; font-size: 8pt; color: #666; }
    pre { page-break-inside: avoid; }
    h1, h2, h3 { page-break-after: avoid; }
  }
`.trim();

/**
 * Derive a page title from the file name (strip extension, de-slug).
 * Result is set via textContent so it is never treated as markup.
 */
export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

/**
 * Parse the rendered HTML string into an inert DOM tree using DOMParser, then
 * import every child node from its <body> into the target document via
 * importNode. This avoids innerHTML on the live print document entirely.
 *
 * DOMParser produces an inert document: scripts inside it are never executed,
 * and event handlers on parsed nodes are dropped when imported into a new
 * context via importNode. The rendered HTML may still contain unsafe href
 * values (e.g. javascript: links authored in the markdown), so after import we
 * strip those by walking <a> and <img> elements and removing dangerous schemes.
 */
function safeImportRenderedHtml(targetDoc: Document, renderedHtml: string): void {
  // Parse into an inert document — scripts do not run here.
  const parser = new DOMParser();
  const inert = parser.parseFromString(renderedHtml, 'text/html');

  // Strip dangerous URL schemes from href/src attributes before importing.
  const SAFE_URL_PATTERN = /^(https?|mailto|tel|#)/i;
  const DANGEROUS_ATTRS: Array<[string, string]> = [
    ['a', 'href'],
    ['img', 'src'],
    ['area', 'href'],
  ];
  for (const [tag, attr] of DANGEROUS_ATTRS) {
    for (const el of Array.from(inert.querySelectorAll(tag))) {
      const val = el.getAttribute(attr);
      if (val !== null && !SAFE_URL_PATTERN.test(val.trim())) {
        el.removeAttribute(attr);
      }
    }
  }

  // Remove any <script> and <style> elements that could have been injected
  // through markdown constructs that our pipeline does not explicitly filter.
  for (const el of Array.from(inert.querySelectorAll('script, style, iframe, object, embed'))) {
    el.remove();
  }

  // Strip inline event handlers (onclick, onerror, onload, etc.).
  const walker = inert.createTreeWalker(inert.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  while (node) {
    const el = node as Element;
    const toRemove: string[] = [];
    for (const { name } of Array.from(el.attributes ?? [])) {
      if (/^on/i.test(name)) toRemove.push(name);
    }
    for (const name of toRemove) el.removeAttribute(name);
    node = walker.nextNode();
  }

  // Import the sanitised body children into the live print document.
  for (const child of Array.from(inert.body.childNodes)) {
    targetDoc.body.appendChild(targetDoc.importNode(child, true));
  }
}

/**
 * Build the print document entirely through safe DOM construction.
 * The page title is set via textContent. Styles are a static string with no
 * user content. The rendered markdown HTML is parsed by DOMParser into an
 * inert document, sanitised, then imported via importNode — no innerHTML or
 * document.write() on the live print document.
 */
function populatePrintDocument(doc: Document, renderedHtml: string, title: string): void {
  doc.documentElement.setAttribute('lang', 'en');

  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'UTF-8');
  doc.head.appendChild(meta);

  const titleEl = doc.createElement('title');
  titleEl.textContent = title; // textContent — never interpreted as markup
  doc.head.appendChild(titleEl);

  const style = doc.createElement('style');
  style.textContent = PRINT_CSS; // static CSS — no user content
  doc.head.appendChild(style);

  safeImportRenderedHtml(doc, renderedHtml);
}

/**
 * Export a markdown string as a PDF by opening a styled print window.
 *
 * The function returns a Promise that resolves once window.print() has been
 * called. The user still needs to confirm "Save as PDF" in the OS dialog
 * (Windows: "Microsoft Print to PDF"; macOS: PDF dropdown in print dialog).
 *
 * @param markdown  Raw markdown content of the file.
 * @param fileName  Original file name, used for the page title.
 */
export async function exportMarkdownAsPdf(markdown: string, fileName: string): Promise<void> {
  const { html } = renderMarkdownToHtml(markdown);
  const title = titleFromFileName(fileName);

  // Open a blank popup. The about:blank origin is same-origin with a blank
  // opener, so we can safely access printWindow.document.
  const printWindow = window.open(
    'about:blank',
    '_blank',
    'width=800,height=600,menubar=no,toolbar=no,location=no,status=no',
  );
  if (!printWindow) {
    throw new Error(
      'Could not open a print window. Allow popups for this page and try again.',
    );
  }

  populatePrintDocument(printWindow.document, html, title);

  // Wait for the layout pass + any async work (KaTeX renders synchronously;
  // this delay is mainly a safety margin for the browser's own layout engine).
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(fallback);
      setTimeout(resolve, 120);
    };
    const fallback = setTimeout(resolve, 600);

    if (printWindow.document.readyState === 'complete') {
      done();
    } else {
      printWindow.addEventListener('load', done, { once: true });
    }
  });

  printWindow.focus();
  printWindow.print();

  // Give the print dialog time to attach before closing the window.
  // Closing too early cancels the dialog on some browsers.
  setTimeout(() => {
    try {
      printWindow.close();
    } catch {
      // Already closed or cross-origin restriction — safe to ignore.
    }
  }, 1500);
}
