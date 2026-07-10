export interface NormalizedEmailAddress {
  original: string;
  local: string;
  domain: string;
  normalized: string;
}

function extractAddress(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const angle = trimmed.match(/<([^<>]+)>/u);
  if (angle?.[1]) return angle[1].trim();
  if (/[<>]/u.test(trimmed)) return null;
  return trimmed;
}

function normalizeDomain(domain: string): string | null {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed || /[\s/@]/u.test(trimmed)) return null;
  try {
    const url = new URL(`https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    if (
      !host ||
      host.includes('..') ||
      host.startsWith('.') ||
      host.endsWith('.')
    ) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

export function parseEmailAddress(
  raw: string | null | undefined
): NormalizedEmailAddress | null {
  if (typeof raw !== 'string') return null;
  const address = extractAddress(raw);
  if (!address) return null;
  if ((address.match(/@/gu) ?? []).length !== 1) return null;
  const [local, domain] = address.split('@');
  if (!local || !domain) return null;
  if (/[\s<>()[\],;:"]/u.test(local)) return null;
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;
  return {
    original: address,
    local,
    domain: normalizedDomain,
    normalized: `${local}@${normalizedDomain}`,
  };
}

export function emailAddressMatch(
  sender: string | null | undefined,
  savedClientEmail: string | null | undefined
): boolean {
  const parsedSender = parseEmailAddress(sender);
  const parsedSaved = parseEmailAddress(savedClientEmail);
  if (!parsedSender || !parsedSaved) return false;
  return parsedSender.normalized === parsedSaved.normalized;
}

export function isLikelyLookalikeAddress(
  sender: string | null | undefined,
  savedClientEmail: string | null | undefined
): boolean {
  const raw = typeof sender === 'string' ? sender.toLowerCase() : '';
  const parsedSender = parseEmailAddress(sender);
  const parsedSaved = parseEmailAddress(savedClientEmail);
  if (parsedSaved && raw.includes(parsedSaved.normalized.toLowerCase())) {
    return parsedSender?.normalized !== parsedSaved.normalized;
  }
  if (!parsedSender || !parsedSaved) {
    return parsedSaved
      ? raw.includes(parsedSaved.normalized.toLowerCase())
      : false;
  }
  if (parsedSender.normalized === parsedSaved.normalized) return false;
  if (parsedSender.domain !== parsedSaved.domain) return false;
  return (
    parsedSender.local.startsWith(`${parsedSaved.local}+`) ||
    parsedSender.local.replace(/[._-]/gu, '') ===
      parsedSaved.local.replace(/[._-]/gu, '') ||
    parsedSender.local.includes(parsedSaved.local) ||
    parsedSaved.local.includes(parsedSender.local)
  );
}
