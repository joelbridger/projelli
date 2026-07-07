const STOP_WORDS = new Set([
  'the',
  'family',
  'household',
  'office',
  'dr',
  'md',
  'mr',
  'mrs',
  'ms',
]);

function singularize(word) {
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function nameTokens(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map(singularize)
    .filter((word) => word && !STOP_WORDS.has(word));
}

export function matchMatterIdForSender(fromName, matters) {
  const senderTokens = new Set(nameTokens(fromName));
  if (senderTokens.size === 0) return null;

  let best = null;
  for (const matter of matters) {
    const matterTokens = nameTokens(`${matter.name || ''} ${matter.client || ''}`);
    const score = matterTokens.filter((word) => senderTokens.has(word)).length;
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && matterTokens.length > best.tokenCount)) {
      best = { matterId: matter.id, score, tokenCount: matterTokens.length };
    }
  }

  return best?.matterId ?? null;
}
