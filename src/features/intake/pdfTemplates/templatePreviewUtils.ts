import type {
  PdfFieldMapEntry,
  PdfTemplateDescriptor,
} from '@/platform/intake/pdfTemplates/templateContract';

export const OVERLAY_FONTS = ['Helvetica', 'Times-Roman', 'Courier'] as const;

/** New overlay fields start in a visible, distinct grid position. */
export function overlayField(index: number): PdfFieldMapEntry {
  const zeroBased = Math.max(0, index - 1);
  const column = Math.floor(zeroBased / 8) % 2;
  const row = zeroBased % 8;
  return {
    kind: 'overlay',
    field_id: `field_${String(index)}`,
    pdf_field_type: 'text',
    page: 1,
    rect: {
      x: column === 0 ? 0.08 : 0.55,
      y: 0.08 + row * 0.11,
      width: 0.37,
      height: 0.07,
    },
    font: { family: 'Helvetica', size: 10 },
    alignment: 'left',
    overflow: 'wrap',
  };
}

export function dryFillText(entry: PdfFieldMapEntry): string {
  if (entry.pdf_field_type === 'checkbox') return '✓';
  if (entry.pdf_field_type === 'money') return '$12,500.00';
  if (entry.pdf_field_type === 'date') return '01/15/2026';
  if (entry.pdf_field_type === 'radio' || entry.pdf_field_type === 'select')
    return entry.options[0]?.label ?? 'Choice';
  return entry.kind === 'overlay' && entry.overflow === 'stop'
    ? 'A fitting answer'
    : 'A sample answer that wraps inside the reviewed field.';
}

/** A local visual map check. It catches omitted fields and invalid overlay placement before approval. */
export function assertDryFillPreview(descriptor: PdfTemplateDescriptor): void {
  const entries = Object.values(descriptor.fields);
  if (entries.length === 0)
    throw new Error('Add at least one reviewed field before approval.');
  for (const entry of entries) {
    if (!dryFillText(entry))
      throw new Error(`Dry fill failed for ${entry.field_id}.`);
    if (
      entry.kind === 'overlay' &&
      (entry.rect.x + entry.rect.width > 1 ||
        entry.rect.y + entry.rect.height > 1)
    ) {
      throw new Error(`Dry fill is outside the page for ${entry.field_id}.`);
    }
  }
}

/** Deterministic normal-zoom review record used by the synthetic golden tests. */
export function buildDryFillPreviewSnapshot(
  descriptor: PdfTemplateDescriptor
): string {
  return Object.values(descriptor.fields)
    .map((entry) =>
      JSON.stringify({
        field: entry.field_id,
        value: dryFillText(entry),
        ...(entry.kind === 'overlay'
          ? { page: entry.page, rect: entry.rect, overflow: entry.overflow }
          : { acroform: entry.acroform_field }),
      })
    )
    .join('\n');
}

function canvasFontFamily(family: (typeof OVERLAY_FONTS)[number]): string {
  if (family === 'Times-Roman') return 'Times New Roman';
  return family;
}

/** Draw the same reviewed normalized placement the PDF overlay writer uses. */
export function drawOverlayDryFill(
  context: CanvasRenderingContext2D,
  entry: Extract<PdfFieldMapEntry, { kind: 'overlay' }>,
  canvasWidth: number,
  canvasHeight: number,
  value = dryFillText(entry)
): void {
  const x = entry.rect.x * canvasWidth;
  const y = entry.rect.y * canvasHeight;
  const width = entry.rect.width * canvasWidth;
  const height = entry.rect.height * canvasHeight;
  const scale = canvasHeight / 792;
  const lineHeight = Math.max(1, entry.font.size * scale * 1.2);
  const startX =
    entry.alignment === 'left'
      ? x
      : entry.alignment === 'center'
        ? x + width / 2
        : x + width;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = entry.font.color ?? '#111827';
  context.font = `${String(entry.font.size * scale)}px ${canvasFontFamily(entry.font.family)}`;
  context.textAlign = entry.alignment;
  context.textBaseline = 'top';
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const visibleLines = entry.overflow === 'stop' ? lines.slice(0, 1) : lines;
  visibleLines.forEach((lineText, index) => {
    if (index * lineHeight + lineHeight <= height)
      context.fillText(lineText, startX, y + index * lineHeight, width);
  });
  context.restore();
}
