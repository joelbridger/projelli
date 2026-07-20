// Fabricated malicious (and legitimate) .docx fixtures for the render-sink
// hardening suite. Built entirely in-memory with JSZip — NO real customer file
// is used. These craft the exact OOXML that drives docx-preview's unfiltered
// `renderHyperlink` (result.href = rel.target, verbatim) so the DocxViewer
// render path can be proven inert by construction.
//
// A Word hyperlink is a `<w:hyperlink r:id="rIdN">` in document.xml whose id
// resolves, via word/_rels/document.xml.rels, to a `<Relationship>` with
// TargetMode="External" and a Target URL. docx-preview copies that Target
// straight onto the produced `<a href>` with no scheme check — so a Target of
// `javascript:…` becomes a live app-origin javascript: link.

import JSZip from 'jszip';

/**
 * XML-escape a value for an attribute. A real Word document stores hyperlink
 * targets XML-escaped in document.xml.rels; docx-preview UN-escapes them when it
 * reads the attribute, handing the raw (dangerous) value to `result.href`. We
 * escape here so the fixture is well-formed OOXML, faithfully reproducing what a
 * malicious authoring tool would emit.
 */
function xmlEscapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const CT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Default Extension="png" ContentType="image/png"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const FIXED_DATE = new Date('2026-01-01T00:00:00Z');

/** A 1x1 transparent PNG (base64) — a legitimate embedded raster image. */
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function pngBytes(): Uint8Array {
  const bin = atob(PNG_1X1_B64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface HyperlinkSpec {
  /** relationship id, e.g. "rIdH1" */
  id: string;
  /** the External Target URL copied verbatim onto <a href> by docx-preview */
  target: string;
  /** visible link text */
  text: string;
}

/**
 * Build a `.docx` (as an ArrayBuffer) whose body contains the given external
 * hyperlinks. Each hyperlink's Target is placed verbatim into
 * word/_rels/document.xml.rels with TargetMode="External".
 */
export async function buildDocxWithHyperlinks(links: HyperlinkSpec[]): Promise<ArrayBuffer> {
  const paras = links
    .map(
      (l) =>
        `<w:p><w:hyperlink r:id="${l.id}"><w:r><w:t xml:space="preserve">${l.text}</w:t></w:r></w:hyperlink></w:p>`,
    )
    .join('');

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${paras}<w:p/></w:body></w:document>`;

  const relEntries = links
    .map(
      (l) =>
        `<Relationship Id="${l.id}" ` +
        `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ` +
        `Target="${xmlEscapeAttr(l.target)}" TargetMode="External"/>`,
    )
    .join('');

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${relEntries}</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CT, { date: FIXED_DATE });
  zip.file('_rels/.rels', ROOT_RELS, { date: FIXED_DATE });
  zip.file('word/document.xml', documentXml, { date: FIXED_DATE });
  zip.file('word/_rels/document.xml.rels', docRels, { date: FIXED_DATE });

  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * Build a `.docx` with one embedded raster image (a real drawing referencing a
 * media/image1.png part) plus a legitimate https hyperlink — the "legitimate
 * content still renders" control. docx-preview embeds the image as a
 * data:image/png URL (useBase64URL) which must survive sanitization.
 */
export async function buildDocxWithImageAndHttpsLink(): Promise<ArrayBuffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
    `xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:body>` +
    `<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>Anthropic</w:t></w:r></w:hyperlink></w:p>` +
    `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="pic"/>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="img"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>` +
    `<w:p/></w:body></w:document>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://www.anthropic.com/about" TargetMode="External"/>` +
    `<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>` +
    `</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CT, { date: FIXED_DATE });
  zip.file('_rels/.rels', ROOT_RELS, { date: FIXED_DATE });
  zip.file('word/document.xml', documentXml, { date: FIXED_DATE });
  zip.file('word/_rels/document.xml.rels', docRels, { date: FIXED_DATE });
  zip.file('word/media/image1.png', pngBytes(), { date: FIXED_DATE });

  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * Build a `.docx` whose body contains an `altChunk` referencing an embedded
 * HTML part. docx-preview renders an altChunk into an `<iframe srcdoc=…>` when
 * `renderAltChunks` is on — and 0.3.7 defaults it ON. The embedded HTML here
 * carries an auto-firing `<img onerror>` + a `<script>` so the proof can show
 * BOTH that the app pins the option off AND that the sanitizer removes the frame
 * even if it were on.
 */
export async function buildDocxWithAltChunk(embeddedHtml: string): Promise<ArrayBuffer> {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body><w:p><w:r><w:t>before</w:t></w:r></w:p>` +
    `<w:altChunk r:id="rIdAC"/>` +
    `<w:p/></w:body></w:document>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdAC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk" Target="afchunk.html"/>` +
    `</Relationships>`;

  const ctWithHtml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Default Extension="html" ContentType="text/html"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', ctWithHtml, { date: FIXED_DATE });
  zip.file('_rels/.rels', ROOT_RELS, { date: FIXED_DATE });
  zip.file('word/document.xml', documentXml, { date: FIXED_DATE });
  zip.file('word/_rels/document.xml.rels', docRels, { date: FIXED_DATE });
  zip.file('word/afchunk.html', embeddedHtml, { date: FIXED_DATE });

  const u8 = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/** The canary token a successful injection would set on window. */
export const DOCX_CANARY_KEY = '__DOCX_XSS__';

/** A battery of fabricated malicious hyperlink Targets (the docx analogue of
 *  the markdown INJECTION_PAYLOADS). Each must render inert. */
export const MALICIOUS_DOCX_TARGETS: Array<{ name: string; target: string }> = [
  { name: 'javascript: hyperlink', target: `javascript:window.${DOCX_CANARY_KEY}=1` },
  { name: 'JavaScript: uppercase scheme', target: `JavaScript:window.${DOCX_CANARY_KEY}=1` },
  { name: 'javascript: with tab-split scheme', target: `java\tscript:window.${DOCX_CANARY_KEY}=1` },
  { name: 'javascript: with leading whitespace', target: `  javascript:window.${DOCX_CANARY_KEY}=1` },
  { name: 'vbscript: hyperlink', target: `vbscript:msgbox(1)` },
  { name: 'data:text/html hyperlink', target: `data:text/html,<script>window.${DOCX_CANARY_KEY}=1</script>` },
  { name: 'data:image/svg+xml hyperlink (svg can script)', target: `data:image/svg+xml,<svg onload=1>` },
  { name: 'file: hyperlink', target: `file:///etc/passwd` },
  { name: 'blob: hyperlink (novel scheme must be refused)', target: `blob:https://evil.example/uuid` },
  { name: 'filesystem: hyperlink', target: `filesystem:https://evil.example/temporary/x` },
];
