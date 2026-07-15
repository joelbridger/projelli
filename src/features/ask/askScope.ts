import {
  type ConsentScope,
} from '@/platform/ai/fileAccessConsent';
import type { RagHit } from '@/platform/utils/tauri-commands';

/** The stable scope vocabulary exposed to Ask extensions. */
export type AskScope =
  | 'this-matter'
  | 'all-matters'
  | 'email'
  | 'documents'
  | 'whole-practice';

export function defaultAskScope(hasMatter: boolean): AskScope {
  return hasMatter ? 'this-matter' : 'all-matters';
}

export function normalizeVisibleAskScope(
  scope: AskScope,
  hasMatter: boolean,
): AskScope {
  return scope === 'this-matter' && !hasMatter ? 'all-matters' : scope;
}

/** Keep file-access consent on the same confidentiality boundary as retrieval. */
export function askConsentScope(
  activeMatterId: string | null | undefined,
  askScope: AskScope,
): ConsentScope {
  return activeMatterId && askScope !== 'all-matters' && askScope !== 'whole-practice'
    ? { kind: 'matter', matterId: activeMatterId }
    : { kind: 'allMatters' };
}

export function composerIsBusy(
  isBusy: boolean,
  bookLoading: boolean,
  askScope: AskScope,
): boolean {
  return isBusy || (askScope === 'whole-practice' && bookLoading);
}

/** Returns true for a hit that came from imported email. */
export function isMailHit(hit: RagHit): boolean {
  return (
    hit.sourceType === 'mail' ||
    hit.path.startsWith('mail:') ||
    (hit.sourceId?.startsWith('mail:') ?? false)
  );
}

/** Apply only source-kind filtering; the backend already owns client scope. */
export function filterHitsByScope(hits: RagHit[], scope: AskScope): RagHit[] {
  if (scope === 'email') return hits.filter(isMailHit);
  if (scope === 'documents') return hits.filter((hit) => !isMailHit(hit));
  return hits;
}
