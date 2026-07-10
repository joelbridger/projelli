export interface DeliveringFirmNormalizationEntry {
  canonicalKey: string;
  displayName: string;
  aliases: string[];
}

export interface NormalizedDeliveringFirm {
  canonicalKey: string;
  displayName: string;
  aliases: string[];
}

export const DELIVERING_FIRM_NORMALIZATION_TABLE: DeliveringFirmNormalizationEntry[] = [
  {
    canonicalKey: 'wells-fargo-advisors',
    displayName: 'Wells Fargo Advisors',
    aliases: [
      'wells fargo advisors',
      'wells fargo clearing services',
      'wf clearing services',
      'wells fargo brokerage',
      'first clearing',
    ],
  },
  {
    canonicalKey: 'fidelity',
    displayName: 'Fidelity',
    aliases: [
      'fidelity investments',
      'fidelity brokerage services',
      'national financial services',
      'fidelity',
    ],
  },
  {
    canonicalKey: 'vanguard',
    displayName: 'Vanguard',
    aliases: [
      'vanguard brokerage services',
      'vanguard marketing corporation',
      'the vanguard group',
      'vanguard',
    ],
  },
  {
    canonicalKey: 'morgan-stanley',
    displayName: 'Morgan Stanley',
    aliases: [
      'morgan stanley smith barney',
      'morgan stanley wealth management',
      'morgan stanley',
    ],
  },
  {
    canonicalKey: 'pershing',
    displayName: 'Pershing',
    aliases: [
      'pershing llc',
      'netxinvestor',
      'netx investor',
      'bnymellon pershing',
      'bny mellon pershing',
      'pershing',
    ],
  },
  {
    canonicalKey: 'merrill',
    displayName: 'Merrill',
    aliases: [
      'merrill lynch wealth management',
      'merrill lynch',
      'merrill',
      'bank of america merrill',
    ],
  },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeDeliveringFirmName(name: string): NormalizedDeliveringFirm {
  const cleaned = normalizeText(name);
  if (!cleaned) {
    return { canonicalKey: 'unknown', displayName: '', aliases: [] };
  }

  for (const entry of DELIVERING_FIRM_NORMALIZATION_TABLE) {
    const aliases = [entry.displayName, ...entry.aliases].map(normalizeText);
    if (aliases.some((alias) => cleaned.includes(alias) || alias.includes(cleaned))) {
      return {
        canonicalKey: entry.canonicalKey,
        displayName: entry.displayName,
        aliases: [...entry.aliases],
      };
    }
  }

  return {
    canonicalKey: 'unknown',
    displayName: name.trim(),
    aliases: [],
  };
}

