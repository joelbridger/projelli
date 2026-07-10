import type { ExtractedField } from './types';

export function maskAccountNumber(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Missing';
  const visible = trimmed.replace(/[^A-Za-z0-9]/g, '').slice(-4);
  return visible ? `****${visible}` : '****';
}

export function isMaskedAccountNumber(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return false;
  return /[*xX]{2,}/.test(trimmed) || /ending\s+in\s+\d{4}/i.test(trimmed);
}

export function fieldValue(field: ExtractedField<unknown> | undefined): string {
  if (!field) return '';
  return String(field.value);
}

export function confidenceLabel(confidence: number): string {
  return `${String(Math.round(confidence * 100))}%`;
}

export function sanitizedFilePart(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || 'Transfer';
}
