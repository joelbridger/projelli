import {
  extractPdfText,
  pageNeedsOcr,
  renderPdfPageToPng,
  type PdfExtractionResult,
} from '@/lib/pdf-extract';
import {
  destroyOcrClient,
  ocrPageImage,
  type OcrPageResult,
} from '@/platform/rag/ocr/ocrEngine';
import { normalizeDeliveringFirmName } from './firmNormalization';
import { isMaskedAccountNumber } from './format';
import type {
  AcatsRegistrationType,
  AcatsStatementTextPage,
  AcatsTaxStatus,
  AcatsTransferDraft,
  ExtractedField,
} from './types';

interface LocatedLine {
  page: AcatsStatementTextPage;
  line: string;
}

interface AccountNumberCandidate {
  located: LocatedLine;
  value: string;
  normalized: string;
}

export const ACATS_MULTIPLE_ACCOUNT_NUMBERS_WARNING =
  'Multiple account numbers found on statement - confirm the correct one';

export interface AcatsStatementClassification {
  looksLikeBrokerageStatement: boolean;
  deliveringFirm?: ExtractedField<string>;
  normalizedFirmName?: string;
  statementDate?: ExtractedField<string>;
  accountType?: ExtractedField<string>;
  reasons: string[];
}

export interface ExtractAcatsFromTextOptions {
  id?: string;
  matterId: string;
  sourcePath: string;
  pages: AcatsStatementTextPage[];
  now?: Date;
}

export interface ExtractAcatsFromPdfOptions {
  id?: string;
  matterId: string;
  sourcePath: string;
  now?: Date;
  pdfTextExtractor?: (bytes: Uint8Array) => Promise<PdfExtractionResult>;
  renderPageToPng?: (bytes: Uint8Array, pageIndex: number) => Promise<Uint8Array>;
  ocrPage?: (png: Uint8Array) => Promise<OcrPageResult>;
  destroyOcr?: () => Promise<void>;
}

function linesForPages(pages: AcatsStatementTextPage[]): LocatedLine[] {
  return pages.flatMap((page) =>
    page.text
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map((line) => ({ page, line })),
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function confidenceFor(page: AcatsStatementTextPage, base: number): number {
  if (page.extraction !== 'ocr') return clamp01(base);
  const ocrQuality = page.ocrConfidence === undefined ? 0.7 : page.ocrConfidence / 100;
  return clamp01(Math.min(base, ocrQuality));
}

function extractedField<T>(
  value: T,
  confidence: number,
  sourcePath: string,
  located: LocatedLine,
): ExtractedField<T> {
  return {
    value,
    confidence: confidenceFor(located.page, confidence),
    source: {
      path: sourcePath,
      page: located.page.pageNumber,
      textSnippet: located.line,
      extraction: located.page.extraction,
    },
  };
}

function findFirstLine(
  pages: AcatsStatementTextPage[],
  matcher: (line: string) => boolean,
): LocatedLine | undefined {
  return linesForPages(pages).find(({ line }) => matcher(line));
}

function normalizeAccountNumberCandidate(value: string): string {
  return value
    .replace(/[^A-Za-z0-9*Xx]/g, '')
    .replace(/[*Xx]/g, 'X')
    .toUpperCase();
}

function accountNumberCandidateFromLine(located: LocatedLine): AccountNumberCandidate | undefined {
  if (!/\baccount\s*(?:number|#|no\.?)/i.test(located.line) || !/\d/.test(located.line)) {
    return undefined;
  }
  // The captured value excludes spaces: PDF text is flattened, so a line like
  // "Account Number: 1234 Account Title: ..." would otherwise let the greedy
  // class swallow into the next label ("1234 Account"). Real account numbers
  // and masked placeholders never contain internal spaces, so excluding them
  // naturally stops the match at the number itself (codex-review, 2026-07-10).
  // No trailing `\b` in the account-label group: `#`/`.` are non-word
  // characters, so a boundary right after them fails on "Account #:".
  const match = located.line.match(
    /\baccount\s*(?:number|#|no\.?)\s*[:#]?\s*([A-Za-z0-9*Xx][A-Za-z0-9*Xx-]{2,19})\b/i,
  );
  const value = (match?.[1] ?? '')
    .replace(/\b(statement|type|title)\b.*$/i, '')
    .trim();
  if (!value || !/\d/.test(value)) return undefined;
  const normalized = normalizeAccountNumberCandidate(value);
  if (!normalized) return undefined;
  return { located, value, normalized };
}

function distinctAccountNumberCandidates(pages: AcatsStatementTextPage[]): AccountNumberCandidate[] {
  const seen = new Set<string>();
  const candidates: AccountNumberCandidate[] = [];
  for (const located of linesForPages(pages)) {
    const candidate = accountNumberCandidateFromLine(located);
    if (!candidate || seen.has(candidate.normalized)) continue;
    seen.add(candidate.normalized);
    candidates.push(candidate);
  }
  return candidates;
}

function allText(pages: AcatsStatementTextPage[]): string {
  return pages.map((page) => page.text).join('\n');
}

function parseDateToIso(raw: string): string | null {
  const monthDate = raw.match(
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},\s+\d{4}\b/gi,
  );
  const numericDate = raw.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g);
  const candidates = [...(monthDate ?? []), ...(numericDate ?? [])];
  const candidate = candidates[candidates.length - 1];
  if (!candidate) return null;
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}

function findStatementDate(
  pages: AcatsStatementTextPage[],
  sourcePath: string,
): ExtractedField<string> | undefined {
  const located = findFirstLine(pages, (line) =>
    /statement\s+(date|period|ending|through|as of)/i.test(line),
  );
  if (!located) return undefined;
  const value = parseDateToIso(located.line);
  if (!value) return undefined;
  return extractedField(value, 0.9, sourcePath, located);
}

function findAccountType(
  pages: AcatsStatementTextPage[],
  sourcePath: string,
): ExtractedField<string> | undefined {
  const located = findFirstLine(pages, (line) => /^account\s+type\s*[:#]/i.test(line));
  if (!located) return undefined;
  const value = located.line.replace(/^account\s+type\s*[:#]\s*/i, '').trim();
  if (!value) return undefined;
  return extractedField(value, 0.9, sourcePath, located);
}

function findDeliveringFirm(
  pages: AcatsStatementTextPage[],
  sourcePath: string,
): { field?: ExtractedField<string>; normalizedName?: string } {
  const located = findFirstLine(pages, (line) => {
    if (line.length > 100) return false;
    return normalizeDeliveringFirmName(line).canonicalKey !== 'unknown';
  });
  if (!located) return {};
  const normalized = normalizeDeliveringFirmName(located.line);
  return {
    field: extractedField(located.line, 0.94, sourcePath, located),
    normalizedName: normalized.canonicalKey,
  };
}

export function classifyAcatsStatementPages({
  sourcePath,
  pages,
}: {
  sourcePath: string;
  pages: AcatsStatementTextPage[];
}): AcatsStatementClassification {
  const text = allText(pages).toLowerCase();
  const positiveTerms = [
    'brokerage',
    'client statement',
    'account statement',
    'holdings',
    'positions',
    'portfolio',
    'cusip',
    'market value',
    'symbol',
  ];
  const negativeTerms = ['checking', 'savings', 'deposit', 'withdrawal', 'fdic', 'tax form', 'form 1099'];
  const positiveCount = positiveTerms.filter((term) => text.includes(term)).length;
  const negativeCount = negativeTerms.filter((term) => text.includes(term)).length;
  const firm = findDeliveringFirm(pages, sourcePath);
  const statementDate = findStatementDate(pages, sourcePath);
  const accountType = findAccountType(pages, sourcePath);
  const reasons: string[] = [];
  if (positiveCount > 0) reasons.push(`Matched ${String(positiveCount)} brokerage statement clues`);
  if (negativeCount > 0) reasons.push(`Matched ${String(negativeCount)} non-brokerage clues`);
  if (firm.field) reasons.push(`Recognized ${firm.field.value}`);

  return {
    looksLikeBrokerageStatement: positiveCount >= 3 && negativeCount < 3,
    ...(firm.field ? { deliveringFirm: firm.field } : {}),
    ...(firm.normalizedName ? { normalizedFirmName: firm.normalizedName } : {}),
    ...(statementDate ? { statementDate } : {}),
    ...(accountType ? { accountType } : {}),
    reasons,
  };
}

function findAccountNumber(
  pages: AcatsStatementTextPage[],
  sourcePath: string,
): ExtractedField<string> | undefined {
  const candidates = distinctAccountNumberCandidates(pages);
  const first = candidates[0];
  if (!first) return undefined;
  const confidence = candidates.length > 1 || isMaskedAccountNumber(first.value) ? 0.45 : 0.93;
  return extractedField(first.value, confidence, sourcePath, first.located);
}

function findAccountTitle(
  pages: AcatsStatementTextPage[],
  sourcePath: string,
): ExtractedField<string> | undefined {
  const located = findFirstLine(pages, (line) =>
    /^(account\s+title|account\s+name|registered\s+owners?|registration)\s*[:#]/i.test(line),
  );
  if (!located) return undefined;
  const value = located.line
    .replace(/^(account\s+title|account\s+name|registered\s+owners?|registration)\s*[:#]\s*/i, '')
    .trim();
  if (!value) return undefined;
  return extractedField(value, 0.9, sourcePath, located);
}

function detectRegistrationType(
  pages: AcatsStatementTextPage[],
  accountTitle: ExtractedField<string> | undefined,
  sourcePath: string,
): ExtractedField<AcatsRegistrationType> | undefined {
  const typeLine = findFirstLine(pages, (line) =>
    /^(account\s+type|registration\s+type|registration)\s*[:#]/i.test(line),
  );
  const lineText = typeLine?.line ?? accountTitle?.source.textSnippet ?? '';
  const text = `${lineText}\n${accountTitle?.value ?? ''}`.toLowerCase();
  let value: AcatsRegistrationType = 'unknown';
  let confidence = 0.2;

  if (/inherited\s+ira/.test(text)) {
    value = 'inherited_ira';
    confidence = 0.94;
  } else if (/rollover\s+ira/.test(text)) {
    value = 'rollover_ira';
    confidence = 0.94;
  } else if (/roth\s+ira/.test(text)) {
    value = 'roth_ira';
    confidence = 0.94;
  } else if (/(traditional|sep|simple)\s+ira|\bira\b/.test(text)) {
    value = 'traditional_ira';
    confidence = 0.88;
  } else if (/custodial|utma|ugma/.test(text)) {
    value = 'custodial';
    confidence = 0.9;
  } else if (/transfer\s+on\s+death|\btod\b/.test(text)) {
    value = 'tod';
    confidence = 0.88;
  } else if (/trust|revocable/.test(text)) {
    value = 'trust';
    confidence = 0.88;
  } else if (/joint|jtwros|tenants/.test(text)) {
    value = 'joint';
    confidence = 0.9;
  } else if (/individual|single/.test(text)) {
    value = 'individual';
    confidence = 0.86;
  }

  const located = typeLine ?? (accountTitle ? { page: {
    pageNumber: accountTitle.source.page ?? 1,
    text: accountTitle.source.textSnippet ?? accountTitle.value,
    extraction: accountTitle.source.extraction === 'advisor-edited' || accountTitle.source.extraction === 'manual'
      ? 'native-pdf'
      : accountTitle.source.extraction,
  }, line: accountTitle.source.textSnippet ?? accountTitle.value } satisfies LocatedLine : undefined);
  if (!located) return undefined;
  return extractedField(value, confidence, sourcePath, located);
}

function taxStatusFor(registrationType: AcatsRegistrationType): AcatsTaxStatus {
  switch (registrationType) {
    case 'roth_ira':
      return 'tax_free';
    case 'traditional_ira':
    case 'rollover_ira':
    case 'inherited_ira':
      return 'tax_deferred';
    case 'individual':
    case 'joint':
    case 'trust':
    case 'custodial':
    case 'tod':
      return 'taxable';
    case 'unknown':
      return 'unknown';
  }
}

function ownersFromTitle(accountTitle: ExtractedField<string> | undefined): ExtractedField<string>[] {
  if (!accountTitle) return [];
  const cleaned = accountTitle.value
    .replace(/\b(JTWROS|TOD|UTMA|UGMA|TRUST|REVOCABLE|ROTH IRA|IRA)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  return cleaned
    .split(/\s+(?:and|&)\s+|,\s*/)
    .map((owner) => owner.trim())
    .filter(Boolean)
    .map((owner) => ({
      value: owner,
      confidence: Math.min(accountTitle.confidence, 0.86),
      source: accountTitle.source,
    }));
}

function assetWarnings(description: string, symbol?: string, cusip?: string, assetType?: string): string[] {
  const warnings: string[] = [];
  if (!symbol && !cusip) warnings.push('Holding has no symbol/CUSIP');
  const text = `${description} ${assetType ?? ''}`.toLowerCase();
  if (
    /proprietary|annuity|alternative|private fund|limited partnership|lp\b|non[- ]?acats|wells fargo proprietary/.test(text)
  ) {
    warnings.push('Likely proprietary fund or non-ACATS asset');
  }
  return warnings;
}

function fieldFromCell(
  value: string,
  confidence: number,
  sourcePath: string,
  located: LocatedLine,
): ExtractedField<string> | undefined {
  const cleaned = value.trim();
  if (!cleaned || cleaned === '-' || cleaned === '--') return undefined;
  return extractedField(cleaned, confidence, sourcePath, located);
}

function parsePipeHolding(
  line: string,
  header: string[],
  sourcePath: string,
  located: LocatedLine,
): AcatsTransferDraft['assets'][number] | null {
  const cells = line.split('|').map((cell) => cell.trim());
  if (cells.length < 2) return null;
  const indexFor = (name: string): number =>
    header.findIndex((heading) => heading.toLowerCase().includes(name));
  const symbol = fieldFromCell(cells[indexFor('symbol')] ?? '', 0.92, sourcePath, located);
  const cusip = fieldFromCell(cells[indexFor('cusip')] ?? '', 0.92, sourcePath, located);
  const description =
    fieldFromCell(cells[indexFor('description')] ?? '', 0.9, sourcePath, located) ??
    fieldFromCell(cells[indexFor('name')] ?? '', 0.85, sourcePath, located) ??
    fieldFromCell(symbol?.value ?? cusip?.value ?? 'Unknown holding', 0.4, sourcePath, located);
  if (!description) return null;
  const quantity = fieldFromCell(cells[indexFor('quantity')] ?? '', 0.9, sourcePath, located);
  const marketValue = fieldFromCell(cells[indexFor('market')] ?? '', 0.88, sourcePath, located);
  const assetType = fieldFromCell(cells[indexFor('asset')] ?? '', 0.82, sourcePath, located);
  return {
    description,
    ...(symbol ? { symbol } : {}),
    ...(cusip ? { cusip } : {}),
    ...(quantity ? { quantity } : {}),
    ...(marketValue ? { marketValue } : {}),
    ...(assetType ? { assetType } : {}),
    action: 'unknown',
    warnings: assetWarnings(description.value, symbol?.value, cusip?.value, assetType?.value),
  };
}

function parseWhitespaceHolding(
  line: string,
  sourcePath: string,
  located: LocatedLine,
): AcatsTransferDraft['assets'][number] | null {
  const match = line.match(
    /^([A-Z][A-Z0-9.]{0,9}|--)\s+([A-Z0-9]{9}|--)\s+(.+?)\s+([0-9][0-9,.]*)\s+\$?([0-9][0-9,.]*(?:\.\d{2})?)\s+([A-Za-z][A-Za-z /-]+)$/,
  );
  if (!match) return null;
  const [, rawSymbol, rawCusip, rawDescription, rawQuantity, rawValue, rawType] = match;
  if (!rawDescription) return null;
  const description = extractedField(rawDescription.trim(), 0.84, sourcePath, located);
  const symbol = fieldFromCell(rawSymbol ?? '', 0.86, sourcePath, located);
  const cusip = fieldFromCell(rawCusip ?? '', 0.86, sourcePath, located);
  const quantity = fieldFromCell(rawQuantity ?? '', 0.84, sourcePath, located);
  const marketValue = fieldFromCell(rawValue ? `$${rawValue}` : '', 0.84, sourcePath, located);
  const assetType = fieldFromCell(rawType ?? '', 0.75, sourcePath, located);
  return {
    description,
    ...(symbol ? { symbol } : {}),
    ...(cusip ? { cusip } : {}),
    ...(quantity ? { quantity } : {}),
    ...(marketValue ? { marketValue } : {}),
    ...(assetType ? { assetType } : {}),
    action: 'unknown',
    warnings: assetWarnings(description.value, symbol?.value, cusip?.value, assetType?.value),
  };
}

function extractHoldings(
  pages: AcatsStatementTextPage[],
  sourcePath: string,
): AcatsTransferDraft['assets'] {
  const locatedLines = linesForPages(pages);
  const assets: AcatsTransferDraft['assets'] = [];
  let inHoldings = false;
  let pipeHeader: string[] | null = null;

  for (const located of locatedLines) {
    const { line } = located;
    if (/^(holdings|positions|portfolio holdings)\b/i.test(line)) {
      inHoldings = true;
      continue;
    }
    if (!inHoldings) continue;
    if (/^(total|activity|transactions|income|cash sweep)\b/i.test(line)) break;
    if (/symbol/i.test(line) && /quantity|shares/i.test(line) && /market\s+value/i.test(line)) {
      pipeHeader = line.includes('|')
        ? line.split('|').map((heading) => heading.trim())
        : ['symbol', 'cusip', 'description', 'quantity', 'market value', 'asset type'];
      continue;
    }
    if (!pipeHeader && !/[A-Z0-9]{9}/.test(line)) continue;
    const asset = line.includes('|') && pipeHeader
      ? parsePipeHolding(line, pipeHeader, sourcePath, located)
      : parseWhitespaceHolding(line, sourcePath, located);
    if (asset) assets.push(asset);
  }

  return assets;
}

function fieldFromRegistration(
  registrationType: ExtractedField<AcatsRegistrationType> | undefined,
  sourcePath: string,
): ExtractedField<AcatsTaxStatus> | undefined {
  if (!registrationType) return undefined;
  return {
    value: taxStatusFor(registrationType.value),
    confidence: registrationType.confidence,
    source: registrationType.source.path
      ? registrationType.source
      : { path: sourcePath, extraction: 'native-pdf' },
  };
}

function buildMissingFields(draft: AcatsTransferDraft): string[] {
  const missing = new Set<string>();
  if (!draft.deliveringFirm.name) missing.add('Delivering firm');
  const accountNumber = draft.deliveringAccount.accountNumber?.value;
  if (!accountNumber) missing.add('Delivering account number');
  if (isMaskedAccountNumber(accountNumber)) missing.add('Unmasked delivering account number');
  if (!draft.deliveringAccount.accountTitle) missing.add('Account title');
  const registration = draft.deliveringAccount.registrationType;
  if (!registration || registration.value === 'unknown' || registration.confidence < 0.7) {
    missing.add('Registration type');
  }
  if (!draft.sourceStatementDate) missing.add('Statement date');
  if (draft.instruction.transferType === 'unknown') missing.add('Transfer type');
  draft.assets.forEach((asset, index) => {
    if (!asset.symbol && !asset.cusip) missing.add(`Holding ${String(index + 1)} symbol or CUSIP`);
  });
  return [...missing];
}

type RegistrationBucket =
  | 'individual'
  | 'joint'
  | 'trust'
  | 'retirement'
  | 'custodial'
  | 'tod'
  | 'unknown';

function registrationBucket(value: string | undefined): RegistrationBucket {
  const text = value?.toLowerCase() ?? '';
  if (!text) return 'unknown';
  if (/inherited|rollover|roth|traditional|sep|simple|\bira\b|401\s*\(k\)|403\s*\(b\)|457\s*\(b\)/.test(text)) {
    return 'retirement';
  }
  if (/joint|jtwros|tenants/.test(text)) return 'joint';
  if (/trust|revocable/.test(text)) return 'trust';
  if (/custodial|utma|ugma/.test(text)) return 'custodial';
  if (/transfer\s+on\s+death|\btod\b/.test(text)) return 'tod';
  if (/individual|single|brokerage/.test(text)) return 'individual';
  return 'unknown';
}

function hasReceivingRegistrationMismatch(draft: AcatsTransferDraft): boolean {
  const delivering = registrationBucket(draft.deliveringAccount.registrationType?.value);
  const receiving = registrationBucket(
    [draft.receivingSchwabAccount.registrationType, draft.receivingSchwabAccount.accountType]
      .filter(Boolean)
      .join(' '),
  );
  return delivering !== 'unknown' && receiving !== 'unknown' && delivering !== receiving;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000);
}

export function buildAcatsDraftWarnings(
  draft: AcatsTransferDraft,
  pages: AcatsStatementTextPage[],
  now: Date,
): string[] {
  const warnings = new Set<string>();
  const statementDateValue = draft.sourceStatementDate?.value;
  if (statementDateValue) {
    const statementDate = new Date(`${statementDateValue}T00:00:00Z`);
    if (!Number.isNaN(statementDate.getTime()) && daysBetween(now, statementDate) > 90) {
      warnings.add("Statement older than Schwab's requested 90-day window");
    }
  }
  if (isMaskedAccountNumber(draft.deliveringAccount.accountNumber?.value)) {
    warnings.add('Account number is masked');
  }
  if (distinctAccountNumberCandidates(pages).length > 1) {
    warnings.add(ACATS_MULTIPLE_ACCOUNT_NUMBERS_WARNING);
  }
  if (hasReceivingRegistrationMismatch(draft)) {
    warnings.add('Account title does not match the receiving Schwab account title');
  }
  const registration = draft.deliveringAccount.registrationType;
  if (!registration || registration.value === 'unknown' || registration.confidence < 0.7) {
    warnings.add('Trust/IRA/custodial type inferred with low confidence');
  }
  for (const asset of draft.assets) {
    for (const warning of asset.warnings) warnings.add(warning);
  }
  const criticalFields = [
    draft.deliveringFirm.name,
    draft.deliveringAccount.accountNumber,
    draft.deliveringAccount.accountTitle,
    draft.deliveringAccount.registrationType,
    draft.sourceStatementDate,
  ];
  if (criticalFields.some((field) => field?.source.extraction === 'ocr' && field.confidence < 0.7)) {
    warnings.add('Low OCR confidence on a critical field');
  }
  const text = allText(pages).toLowerCase();
  if (/401\s*\(k\)|403\s*\(b\)|457\s*\(b\)|qualified plan|employer plan/.test(text)) {
    warnings.add('Transfer might be a 401(k)/plan rollover');
  }
  return [...warnings];
}

export function extractAcatsDraftFromTextPages({
  id,
  matterId,
  sourcePath,
  pages,
  now = new Date(),
}: ExtractAcatsFromTextOptions): AcatsTransferDraft {
  const classification = classifyAcatsStatementPages({ sourcePath, pages });
  const accountNumber = findAccountNumber(pages, sourcePath);
  const accountTitle = findAccountTitle(pages, sourcePath);
  const registrationType = detectRegistrationType(pages, accountTitle, sourcePath);
  const taxStatus = fieldFromRegistration(registrationType, sourcePath);
  const assets = extractHoldings(pages, sourcePath);

  const draft: AcatsTransferDraft = {
    id: id ?? `acats_${Date.now().toString(36)}`,
    matterId,
    sourceStatementPath: sourcePath,
    ...(classification.statementDate ? { sourceStatementDate: classification.statementDate } : {}),
    deliveringFirm: {
      ...(classification.deliveringFirm ? { name: classification.deliveringFirm } : {}),
      ...(classification.normalizedFirmName ? { normalizedName: classification.normalizedFirmName } : {}),
    },
    deliveringAccount: {
      ...(accountNumber ? { accountNumber } : {}),
      ...(accountTitle ? { accountTitle } : {}),
      ...(registrationType ? { registrationType } : {}),
      ...(taxStatus ? { taxStatus } : {}),
      owners: ownersFromTitle(accountTitle),
    },
    receivingSchwabAccount: {},
    instruction: {
      transferType: 'unknown',
    },
    assets,
    missingFields: [],
    warnings: [],
    reviewStatus: 'needs_review',
  };
  draft.missingFields = buildMissingFields(draft);
  draft.warnings = buildAcatsDraftWarnings(draft, pages, now);
  return draft;
}

export async function extractAcatsDraftFromPdfBytes(
  bytes: Uint8Array,
  {
    id,
    matterId,
    sourcePath,
    now,
    pdfTextExtractor = extractPdfText,
    renderPageToPng = renderPdfPageToPng,
    ocrPage = ocrPageImage,
    destroyOcr = destroyOcrClient,
  }: ExtractAcatsFromPdfOptions,
): Promise<AcatsTransferDraft> {
  const result = await pdfTextExtractor(bytes);
  if (result.encrypted) {
    return {
      id: id ?? `acats_${Date.now().toString(36)}`,
      matterId,
      sourceStatementPath: sourcePath,
      deliveringFirm: {},
      deliveringAccount: { owners: [] },
      receivingSchwabAccount: {},
      instruction: { transferType: 'unknown' },
      assets: [],
      missingFields: ['Unlocked statement copy'],
      warnings: ['Statement is encrypted or unreadable'],
      reviewStatus: 'needs_review',
    };
  }

  const pages: AcatsStatementTextPage[] = [];
  let usedOcr = false;
  try {
    for (let index = 0; index < result.pageCount; index += 1) {
      const nativeText = result.pages[index] ?? '';
      if (pageNeedsOcr(nativeText)) {
        usedOcr = true;
        const png = await renderPageToPng(bytes, index);
        const ocr = await ocrPage(png);
        pages.push({
          pageNumber: index + 1,
          text: ocr.text,
          extraction: 'ocr',
          ocrConfidence: ocr.confidence,
        });
      } else {
        pages.push({
          pageNumber: index + 1,
          text: nativeText,
          extraction: 'native-pdf',
        });
      }
    }
  } finally {
    if (usedOcr) await destroyOcr();
  }

  return extractAcatsDraftFromTextPages({
    ...(id ? { id } : {}),
    matterId,
    sourcePath,
    pages,
    ...(now ? { now } : {}),
  });
}
