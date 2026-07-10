import type {
  DocumentKind,
  ExpectedDocument,
  LicenseSide,
  Tier1Classification,
  Tier1ClassifyInput,
} from './documentDetectiveTypes';

const DOCUMENT_SIGNALS: Readonly<Record<Exclude<DocumentKind, 'other_financial' | 'unknown'>, readonly string[]>> = {
  drivers_license: [
    'driver license',
    "driver's license",
    'identification card',
    'license no',
    'dl no',
    'class',
    'restrictions',
    'endorsements',
    'date of birth',
    'height',
    'eyes',
  ],
  tax_return: [
    'form 1040',
    '1040-sr',
    'adjusted gross income',
    'total income',
    'wages salaries tips',
    'schedule 1',
    'taxable income',
  ],
  pay_stub: ['pay period', 'gross pay', 'net pay', 'ytd', 'earnings', 'deductions', 'employer'],
  bank_statement: ['checking account', 'savings account', 'deposits', 'withdrawals', 'ending balance', 'statement period'],
  brokerage_statement: [
    'portfolio value',
    'holdings',
    'asset allocation',
    'brokerage',
    'dividends',
    'realized gain',
    'unrealized gain',
  ],
  ira_statement: ['ira', 'traditional ira', 'roth ira', 'required minimum distribution', 'retirement account'],
  credit_card_statement: ['minimum payment', 'payment due', 'purchases', 'transactions', 'credit limit'],
};

const FRONT_SIGNALS = [
  'driver license',
  'class',
  'restrictions',
  'endorsements',
  'dob',
  'sex',
  'height',
  'eyes',
  'expiration',
  'address',
] as const;

const BACK_SIGNALS = [
  'pdf417',
  'aamva',
  'ansi',
  'daq',
  'dcs',
  'dct',
  'dag',
  'dai',
  'daj',
  'dbb',
  'dba',
  'dcg',
  'zaz',
  'barcode',
] as const;

const INFERRED_EXPECTATIONS: readonly [string, DocumentKind][] = [
  ['tax return', 'tax_return'],
  ['pay stub', 'pay_stub'],
  ['paystub', 'pay_stub'],
  ['bank statement', 'bank_statement'],
  ['brokerage statement', 'brokerage_statement'],
  ['ira statement', 'ira_statement'],
  ['credit card statement', 'credit_card_statement'],
];

function signalsIn(text: string, signals: readonly string[]): string[] {
  return signals.filter((signal) => text.includes(signal));
}

function observedKind(text: string): { kind: DocumentKind; evidence: string[] } {
  const matches = Object.entries(DOCUMENT_SIGNALS)
    .map(([kind, signals]) => ({ kind: kind as DocumentKind, evidence: signalsIn(text, signals) }))
    .filter((match) => match.evidence.length > 0);

  if (matches.length === 0) return { kind: 'unknown', evidence: [] };
  if (matches.length === 1) return matches[0] as { kind: DocumentKind; evidence: string[] };

  const kinds = new Set(matches.map((match) => match.kind));
  if (kinds.has('ira_statement') && kinds.has('brokerage_statement') && kinds.size === 2) {
    return matches.find((match) => match.kind === 'ira_statement') as { kind: DocumentKind; evidence: string[] };
  }
  if (kinds.has('tax_return') && kinds.size === 1) {
    return matches.find((match) => match.kind === 'tax_return') as { kind: DocumentKind; evidence: string[] };
  }
  return { kind: 'unknown', evidence: [] };
}

function expectedDocument(input: Tier1ClassifyInput): { expected?: ExpectedDocument; allowed: DocumentKind[] } {
  const explicit = input.item.expected_doc_types?.filter((kind) => kind !== 'unknown');
  const source = `${input.item.item_id} ${input.item.label}`.toLowerCase();
  const inferredKind = source.includes('license')
    ? 'drivers_license'
    : INFERRED_EXPECTATIONS.find(([label]) => source.includes(label))?.[1];
  const allowed = input.item.expected_doc_types !== undefined ? explicit ?? [] : inferredKind ? [inferredKind] : [];
  if (allowed.length === 0) return { allowed };

  const expected: ExpectedDocument = { kind: allowed[0] as DocumentKind };
  if (expected.kind === 'drivers_license') {
    const configuredSide = input.item.expected_license_slots?.[input.slotIndex];
    const inferredSide = input.slotRole === 'front' ? 'front' : input.slotRole === 'back' ? 'back' : undefined;
    const expectedSide = configuredSide ?? inferredSide;
    if (expectedSide !== undefined) expected.side = expectedSide;
  }
  return { expected, allowed };
}

function detectedSide(text: string): { side: LicenseSide; evidence: string[] } {
  const front = signalsIn(text, FRONT_SIGNALS);
  const back = signalsIn(text, BACK_SIGNALS);
  if (front.length > 0 && back.length === 0) return { side: 'front', evidence: front };
  if (back.length > 0 && front.length === 0) return { side: 'back', evidence: back };
  return { side: 'unknown', evidence: [...front, ...back] };
}

export function classifyTier1(input: Tier1ClassifyInput): Tier1Classification {
  const text = input.file.textSample?.toLowerCase().trim() ?? '';
  if (!text) return { verdict: 'unknown', evidence: [] };

  const observedResult = observedKind(text);
  const sideResult = detectedSide(text);
  const observed = observedResult.kind === 'unknown' && sideResult.side !== 'unknown' ? 'drivers_license' : observedResult.kind;
  const evidence = [...observedResult.evidence, ...sideResult.evidence];
  if (observed === 'unknown') return { verdict: 'unknown', evidence };

  const { expected, allowed } = expectedDocument(input);
  const side = sideResult.side === 'unknown' ? undefined : sideResult.side;

  if (expected?.kind === 'drivers_license') {
    if (observed !== 'drivers_license') {
      return { verdict: 'warn', reason: 'wrong_doc', expected, observed, evidence };
    }
    if (side && input.siblingLicenseSide === side) {
      return { verdict: 'warn', reason: 'duplicate_license_side', expected, observed, side, evidence };
    }
    if (expected.side && side && expected.side !== side) {
      return { verdict: 'warn', reason: 'wrong_side_of_license', expected, observed, side, evidence };
    }
    return { verdict: 'ok', observed, ...(side ? { side } : {}), evidence };
  }

  if (!expected) return { verdict: 'ok', observed, ...(side ? { side } : {}), evidence };
  if (allowed.includes(observed)) return { verdict: 'ok', observed, ...(side ? { side } : {}), evidence };
  return { verdict: 'warn', reason: 'wrong_doc', expected, observed, ...(side ? { side } : {}), evidence };
}
