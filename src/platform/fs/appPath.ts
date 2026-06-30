/**
 * appPath — the SINGLE source of truth for cross-platform path comparison.
 *
 * Advisor Prep Hero's confidentiality promise (one top-level folder = one client,
 * matter-scoped retrieval, scope guards) depends on deciding correctly whether
 * one path is the same as, or lives inside, another. On POSIX that is a simple
 * case-sensitive `startsWith`; on Windows it is NOT:
 *
 *   - separators are `\` (e.g. `C:\WS\ClientA\doc.docx`), not `/`
 *   - the filesystem is case-INSENSITIVE (`C:\WS\Acme` === `c:\ws\acme`)
 *   - paths can carry a drive letter (`C:`) or be UNC (`\\server\share\…`)
 *   - trailing separators vary (`C:\WS` vs `C:\WS\`)
 *
 * Naive POSIX assumptions in scope checks therefore let a file be put in — or
 * kept out of — the WRONG client's scope on Windows. These helpers collapse all
 * of those shapes so the comparison is correct on every platform.
 *
 * Display vs comparison: the helpers compare on a folded/normalised form but,
 * where they return a slice of the input (the relative path, the folder name),
 * they return it with the ORIGINAL case preserved so the UI shows the real name.
 *
 * Pure string functions — no fs, no React, no Zustand — so they unit-test
 * without any environment. Absolute-path detection is shared with
 * `pathResolve.isAbsolutePath` (the one place that already handles UNC).
 */

import { isAbsolutePath } from './pathResolve';

/** Convert every backslash to a forward slash (lossless for comparison). */
function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Collapse runs of `/` to a single `/`, but preserve a leading `//` so a UNC
 * root (`\\server\share` → `//server/share`) keeps its double-slash marker.
 */
function collapseSlashes(s: string): string {
  const isUnc = s.startsWith('//');
  let r = s.replace(/\/{2,}/g, '/');
  if (isUnc) r = `/${r}`;
  return r;
}

/**
 * True when `p` looks like a Windows path — a drive-letter path (`C:/…`,
 * `C:\…`) or a UNC path (`\\…` / `//…`). Used to decide case-insensitivity:
 * on POSIX you never see either shape.
 */
export function isWindowsStylePath(p: string): boolean {
  if (!p) return false;
  if (/^[A-Za-z]:[\\/]/.test(p)) return true; // drive letter
  if (/^[\\/]{2}/.test(p)) return true; // UNC
  return false;
}

/**
 * Normalise a path for comparison: forward slashes, collapsed separators, and
 * no trailing separator (except a bare POSIX root `/` or a drive root `C:/`).
 * Case is NOT touched here — `fold()` applies that based on platform.
 */
function normalizeForComparison(p: string): string {
  let s = collapseSlashes(toForwardSlashes(p));
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) {
    s = s.replace(/\/+$/, '');
  }
  return s;
}

/** Lower-case only when comparing as Windows paths (case-insensitive FS). */
function fold(s: string, caseInsensitive: boolean): string {
  return caseInsensitive ? s.toLowerCase() : s;
}

/**
 * Whether the comparison of `a` and `b` should be case-insensitive. We treat it
 * as Windows (case-insensitive) when EITHER side looks like a Windows path, so a
 * stored root and an incoming file path that disagree on shape still compare
 * correctly.
 */
function comparesCaseInsensitively(a: string, b: string): boolean {
  return isWindowsStylePath(a) || isWindowsStylePath(b);
}

/**
 * True when `a` and `b` denote the same path, ignoring separator style, trailing
 * separators, and (on Windows) case.
 */
export function pathsEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ci = comparesCaseInsensitively(a, b);
  return fold(normalizeForComparison(a), ci) === fold(normalizeForComparison(b), ci);
}

/**
 * True when `path` IS `root` or lives inside it, respecting path-segment
 * boundaries (so `/ws/Acme` never matches `/ws/Acme Corp`), separator style, and
 * (on Windows) case. This is the predicate every scope/boundary check should use
 * instead of a raw `startsWith`.
 */
export function sameOrInside(root: string, path: string): boolean {
  if (!root || !path) return false;
  const ci = comparesCaseInsensitively(root, path);
  const r = fold(normalizeForComparison(root), ci);
  const f = fold(normalizeForComparison(path), ci);
  if (!r) return false;
  if (f === r) return true;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return f.startsWith(prefix);
}

/**
 * If `path` is `root` or inside it, return the relative path from `root` to
 * `path` (forward slashes, ORIGINAL case). Returns `''` when `path` IS the root,
 * or `null` when `path` is outside `root`.
 */
export function relativeInside(root: string, path: string): string | null {
  if (!root || !path) return null;
  const ci = comparesCaseInsensitively(root, path);
  const rRaw = normalizeForComparison(root);
  const fRaw = normalizeForComparison(path);
  const r = fold(rRaw, ci);
  const f = fold(fRaw, ci);
  if (!r) return null;
  if (f === r) return '';
  const prefixLen = (rRaw.endsWith('/') ? rRaw : `${rRaw}/`).length;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  if (!f.startsWith(prefix)) return null;
  return fRaw.slice(prefixLen);
}

/**
 * The first path segment of `path` BELOW `root` (the "top-level folder").
 *
 *   - `null`  — `path` is outside `root`.
 *   - `''`    — `path` IS the root, or a file/folder sitting directly in the
 *               root (no intervening folder). Callers map this to their own
 *               root-level sentinel.
 *   - else    — the immediate child-folder name (original case).
 */
export function topLevelSegment(root: string, path: string): string | null {
  const rel = relativeInside(root, path);
  if (rel === null) return null;
  if (rel === '') return '';
  const slash = rel.indexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
}

/**
 * Join a top-level segment (or relative path) onto a workspace root, returning a
 * forward-slash path suitable for the comparison helpers above. Trailing
 * separators on the root are dropped first to avoid `root//seg`.
 */
export function joinWorkspacePath(root: string, segment: string): string {
  const r = normalizeForComparison(root);
  const seg = toForwardSlashes(segment).replace(/^\/+/, '');
  return r.endsWith('/') ? `${r}${seg}` : `${r}/${seg}`;
}

export { isAbsolutePath };
