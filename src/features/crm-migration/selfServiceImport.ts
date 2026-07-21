import Papa from 'papaparse';
import { BRAND } from '@/config/brand';
import {
  assertArchiveWithinBudget,
  assertInputBytesWithinCap,
  looksLikeZip,
} from '@/platform/archive/safeZip';

export type ImportRow = Record<string, string>;
export type ImportFormat = 'csv' | 'excel' | 'vcard' | 'outlook';
export type ContactField = 'name' | 'email' | 'phone' | 'company' | 'externalId';
export type ContactMapping = Record<ContactField, string>;

export interface ParsedContactFile {
  format: ImportFormat;
  fileName: string;
  columns: readonly string[];
  rows: readonly ImportRow[];
}

const FIELD_MATCHES: Record<ContactField, readonly string[]> = {
  name: ['full name', 'name', 'display name', 'file as', 'contact'],
  email: ['email', 'e-mail address', 'email address', 'e-mail'],
  phone: ['phone', 'business phone', 'mobile phone', 'mobile', 'telephone'],
  company: ['company', 'company name', 'organization'],
  externalId: ['external id', 'external_id', 'id', 'uid', 'contact id'],
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function rowsFromGrid(grid: readonly unknown[][]): { columns: string[]; rows: ImportRow[] } {
  const header = (grid[0] ?? []).map(clean);
  if (!header.some(Boolean)) throw new Error('This file does not have a header row to map.');
  const uniqueHeaders = header.map((label, index) => label || `Column ${index + 1}`);
  const rows = grid.slice(1).map((values) => Object.fromEntries(
    uniqueHeaders.map((column, index) => [column, clean(values[index])]),
  )).filter((row) => Object.values(row).some(Boolean));
  if (!rows.length) throw new Error('This file has no contact rows to import.');
  return { columns: uniqueHeaders, rows };
}

function unfoldVcard(value: string): string[] {
  return value.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

export function parseVcards(text: string): { columns: string[]; rows: ImportRow[] } {
  const cards = text.split(/BEGIN:VCARD/i).slice(1);
  const rows = cards.map((card, index) => {
    const result: ImportRow = {};
    for (const line of unfoldVcard(card ?? '')) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      const key = line.slice(0, separator).split(';')[0]?.toUpperCase() ?? '';
      const value = line.slice(separator + 1).replace(/\\n/g, ' ').trim();
      if (!value) continue;
      if (key === 'FN') result['Name'] = value;
      if (key === 'N' && !result['Name']) result['Name'] = value.split(';').filter(Boolean).reverse().join(' ');
      if (key === 'EMAIL' && !result['Email']) result['Email'] = value;
      if (key === 'TEL' && !result['Phone']) result['Phone'] = value;
      if (key === 'ORG' && !result['Company']) result['Company'] = value.replaceAll(';', ' ');
      if (key === 'UID') result['UID'] = value;
    }
    if (!result['Name']) result['Name'] = `Contact ${index + 1}`;
    return result;
  }).filter((row) => Object.keys(row).length > 1);
  if (!rows.length) throw new Error(`This vCard file has no contacts ${BRAND.name} can read.`);
  return { columns: ['Name', 'Email', 'Phone', 'Company', 'UID'].filter((column) => rows.some((row) => row[column])), rows };
}

export function suggestedContactMapping(columns: readonly string[]): ContactMapping {
  const findColumn = (names: readonly string[]) => columns.find((column) => names.includes(column.trim().toLowerCase())) ?? '';
  return {
    name: findColumn(FIELD_MATCHES.name),
    email: findColumn(FIELD_MATCHES.email),
    phone: findColumn(FIELD_MATCHES.phone),
    company: findColumn(FIELD_MATCHES.company),
    externalId: findColumn(FIELD_MATCHES.externalId),
  };
}

export async function parseContactImportFile(file: File): Promise<ParsedContactFile> {
  const name = file.name || 'contacts';
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'vcf' || extension === 'vcard') {
    const parsed = parseVcards(await file.text());
    return { format: 'vcard', fileName: name, ...parsed };
  }
  if (extension === 'xlsx' || extension === 'xls') {
    // Excel is a large optional reader. Load it only after an advisor chooses
    // a spreadsheet so opening the migration screen stays quick.
    const XLSX = await import('xlsx');
    const bytes = await file.arrayBuffer();
    // R-17 — an .xlsx IS a zip and SheetJS unzips it internally, so this line
    // is an archive read even though nothing here says "zip". Pre-flight the
    // bomb caps before SheetJS ever sees the bytes. Legacy .xls is not a zip,
    // so it gets the input-size cap only rather than a guard that pretends to
    // inspect a central directory it does not have.
    if (looksLikeZip(bytes)) {
      await assertArchiveWithinBudget(bytes, `contact import ${name}`);
    } else {
      assertInputBytesWithinCap(bytes, `contact import ${name}`);
    }
    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('This spreadsheet has no sheet to import.');
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error('This spreadsheet’s first sheet could not be opened.');
    const parsed = rowsFromGrid(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }));
    return { format: 'excel', fileName: name, ...parsed };
  }
  const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: true });
  if (parsed.errors.length) throw new Error(`${BRAND.name} could not read this CSV: ${parsed.errors[0]?.message ?? 'unknown problem'}`);
  const result = rowsFromGrid(parsed.data);
  const outlook = result.columns.some((column) => /e-mail address|business phone|file as/i.test(column));
  return { format: outlook ? 'outlook' : 'csv', fileName: name, ...result };
}

export function contactName(row: ImportRow, mapping: ContactMapping): string {
  return clean(row[mapping.name]) || clean(row[mapping.email]) || 'Unnamed contact';
}
