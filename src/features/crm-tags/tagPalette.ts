import palette from './tagPalette.json';
import type { FirmTagColor } from './contract';

const PAINT = {
  blue: 'var(--kp-tag-blue)',
  green: 'var(--kp-tag-green)',
  amber: 'var(--kp-tag-amber)',
  red: 'var(--kp-tag-red)',
  purple: 'var(--kp-tag-purple)',
  slate: 'var(--kp-tag-slate)',
} as const;

export const FIRM_TAG_COLORS = [
  { value: palette.blue as FirmTagColor, label: 'blue', paint: PAINT.blue },
  { value: palette.green as FirmTagColor, label: 'green', paint: PAINT.green },
  { value: palette.amber as FirmTagColor, label: 'amber', paint: PAINT.amber },
  { value: palette.red as FirmTagColor, label: 'red', paint: PAINT.red },
  { value: palette.purple as FirmTagColor, label: 'purple', paint: PAINT.purple },
  { value: palette.slate as FirmTagColor, label: 'slate', paint: PAINT.slate },
] as const;

export const INITIAL_FIRM_TAG_COLOR = palette.blue as FirmTagColor;
export const DEFAULT_FIRM_TAG_COLOR = palette.slate as FirmTagColor;

/** Resolve saved data to paint without putting a record value directly in CSS. */
export function firmTagPaint(color: FirmTagColor): string {
  return FIRM_TAG_COLORS.find((candidate) => candidate.value === color)?.paint
    ?? PAINT.slate;
}
