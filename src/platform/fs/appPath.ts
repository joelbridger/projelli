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
 * CASE POLICY (the confidentiality-critical part). Only the VOLUME ROOT is
 * case-insensitive on Windows — the drive letter (`C:` ≡ `c:`) and a UNC
 * host+share. DIRECTORY SEGMENTS are compared CASE-SENSITIVELY, because a path
 * segment is the client privacy boundary: on a case-SENSITIVE Windows-shaped
 * volume (NTFS per-directory case sensitivity, a WSL/network-backed share)
 * `C:\WS\Acme` and `C:\WS\acme` are TWO DIFFERENT clients, and folding them
 * would leak one client's files into the other's scope. So we FAIL CLOSED on a
 * case-only segment difference. In practice every call path derives both sides
 * from the same on-disk enumeration (the same workspace root + the same file
 * tree), so segment casing is already consistent and legitimate same-client
 * matches still succeed; the only thing that fails closed is genuine casing
 * drift, which is the safe direction for an isolation check.
 *
 * Display vs comparison: the helpers compare on a normalised form but, where
 * they return a slice of the input (the relative path, the folder name), they
 * return it with the ORIGINAL case preserved so the UI shows the real name.
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
 * Resolve `.` and `..` segments so a traversal sequence like `/ws/../Other`
 * cannot pass a later PREFIX-STRING containment check as if it were still
 * inside `/ws` — a naive `startsWith('/ws/')` is textually true for
 * `/ws/../Other` even though the path it denotes is `/Other`. Every
 * comparison helper below (`pathsEqual`, `sameOrInside`, `relativeInside`)
 * routes through `normalizeForComparison`, which calls this first, so this is
 * the one place that decides what a path with dot-segments actually means.
 *
 * A rooted path (POSIX `/…`, a drive letter, or UNC) cannot climb above its
 * own root: a leading `..` past the top is CLAMPED (dropped), matching how a
 * real filesystem treats `/..` as `/`, never treated as "goes outside" or
 * left dangling for a later string-prefix check to misread. Input must
 * already be forward-slash, collapsed-separator form (see `collapseSlashes`).
 */
function resolveDotSegments(s: string): string {
  let prefix = '';
  let rest = s;
  if (s.startsWith('//')) {
    const m = /^(\/\/[^/]+\/[^/]*)(\/.*)?$/.exec(s);
    if (m) {
      // Trailing slash matters: without it, joining the UNC prefix straight
      // onto the first resolved segment below concatenates them into one
      // word (`//srv/share` + `ws` = `//srv/sharews`) instead of a path
      // (`//srv/share/ws`). normalizeForComparison strips a bare root's
      // trailing slash afterward, so a share with no segments below it still
      // round-trips to `//srv/share` unchanged.
      prefix = `${m[1] ?? ''}/`;
      rest = m[2] ?? '';
    }
  } else if (/^[A-Za-z]:\//.test(s)) {
    prefix = s.slice(0, 3);
    rest = s.slice(3);
  } else if (s.startsWith('/')) {
    prefix = '/';
    rest = s.slice(1);
  }
  const rooted = prefix !== '';
  const stack: string[] = [];
  for (const seg of rest.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!rooted) {
        stack.push('..');
      }
      // rooted + nothing to pop: climbing above the root clamps, not escapes.
      continue;
    }
    stack.push(seg);
  }
  return prefix + stack.join('/');
}

/**
 * Resolve `.`/`..` segments the same way the comparison helpers below do,
 * exposed for callers (like `toWorkspaceRelativeFolder`) that need to fail
 * closed on a RELATIVE path's own escape attempt before it ever reaches a
 * `root`-vs-`path` comparison — e.g. a caller-supplied relative folder of
 * `../../etc` should never be handed back as "the workspace-relative path",
 * since nothing has verified what it's relative TO. A path that still starts
 * with `..` after resolution climbed past everything it was given — the
 * caller should treat that as an escape attempt.
 */
export function collapseDotSegments(p: string): string {
  return resolveDotSegments(collapseSlashes(toForwardSlashes(p)));
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
  let s = resolveDotSegments(collapseSlashes(toForwardSlashes(p)));
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) {
    s = s.replace(/\/+$/, '');
  }
  return s;
}

/**
 * Fold ONLY the case-insensitive VOLUME ROOT, leaving directory segments
 * untouched (case-sensitive). On Windows the drive letter (`C:` ≡ `c:`) and a
 * UNC host+share are case-insensitive; every directory segment below them is the
 * client boundary and must stay case-sensitive (see the CASE POLICY note at the
 * top of the file). Lowercasing the drive/host does NOT change string length, so
 * callers that slice by a prefix length (relativeInside) stay correct.
 *
 * Input is expected to be separator-normalised (forward slashes) already.
 */
function caseNormalize(s: string): string {
  // Drive-letter path: `X:/...` → lowercase just the drive letter.
  if (/^[A-Za-z]:/.test(s)) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  // UNC path: `//host/share/...` → lowercase host + share only.
  if (s.startsWith('//')) {
    const m = /^\/\/([^/]+)\/([^/]+)(.*)$/.exec(s);
    if (m) {
      const [, host = '', share = '', rest = ''] = m;
      return `//${asciiLower(host)}/${asciiLower(share)}${rest}`;
    }
    // `//host` with no share segment — fold the host.
    return asciiLower(s);
  }
  // POSIX or relative — fully case-sensitive.
  return s;
}

/**
 * Lowercase ONLY ASCII A–Z. Windows drive letters and UNC host/share names are
 * ASCII-case-insensitive; folding only ASCII keeps this provably LENGTH-
 * PRESERVING (so relativeInside's prefix-length slice stays correct) and avoids
 * locale-dependent Unicode case folding (e.g. Turkish dotted-I) that could both
 * change length and mis-compare.
 */
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The canonical comparison KEY for a path: separator-normalised, dot-segments
 * resolved, trailing separator stripped, and (on Windows) only the drive/UNC
 * volume root case-folded — directory segments preserve their case. Two paths
 * are `pathsEqual` iff their keys are string-equal. Exported so callers that
 * need a STABLE per-path identity string (e.g. the QA-93 per-workspace storage
 * scope id) derive it from the SAME policy the isolation checks use, instead of
 * a naive `toLowerCase()` that would wrongly collapse `/Practice/Acme` and
 * `/Practice/acme` into one client boundary.
 */
export function pathComparisonKey(p: string): string {
  return caseNormalize(normalizeForComparison(p));
}

/**
 * True when `a` and `b` denote the same path, ignoring separator style, trailing
 * separators, and (on Windows) the case of the drive/UNC volume root. Directory
 * segments are compared case-sensitively.
 */
export function pathsEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  return pathComparisonKey(a) === pathComparisonKey(b);
}

/**
 * True when `path` IS `root` or lives inside it, respecting path-segment
 * boundaries (so `/ws/Acme` never matches `/ws/Acme Corp`), separator style, and
 * the case-insensitive Windows volume root (drive/UNC). Directory segments are
 * compared CASE-SENSITIVELY, so a case-only client-folder difference fails
 * closed. This is the predicate every scope/boundary check should use instead of
 * a raw `startsWith`.
 */
export function sameOrInside(root: string, path: string): boolean {
  if (!root || !path) return false;
  const r = caseNormalize(normalizeForComparison(root));
  const f = caseNormalize(normalizeForComparison(path));
  if (!r) return false;
  if (f === r) return true;
  const prefix = r.endsWith('/') ? r : `${r}/`;
  return f.startsWith(prefix);
}

/**
 * If `path` is `root` or inside it, return the relative path from `root` to
 * `path` (forward slashes, ORIGINAL case). Returns `''` when `path` IS the root,
 * or `null` when `path` is outside `root`. Containment uses the same volume-root-
 * folded, segment-case-sensitive comparison as `sameOrInside`.
 */
export function relativeInside(root: string, path: string): string | null {
  if (!root || !path) return null;
  const rRaw = normalizeForComparison(root);
  const fRaw = normalizeForComparison(path);
  const r = caseNormalize(rRaw);
  const f = caseNormalize(fRaw);
  if (!r) return null;
  if (f === r) return '';
  // caseNormalize never changes length, so a prefix length from rRaw is valid.
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

/**
 * The ONE path-join helper every FS write/read site should use instead of a
 * hand-rolled `${root}/${rel}` template string. Two failure modes motivated
 * this: (1) a template join silently DOUBLES an already-absolute `rel` (e.g.
 * `p.startsWith(rootPath) ? p : \`${rootPath}/${p}\`` fails to recognize an
 * absolute path whose drive-letter case or separator style differs from
 * `rootPath`, producing a doubled/garbage path instead of the real file); (2)
 * when a non-string value leaks in from a corrupted upstream source (a
 * folder-picker object, a malformed event payload), a template string
 * silently stringifies it to the literal `"[object Object]"`, which then
 * becomes a real create target on disk. `workspacePath` closes both: it
 * throws loudly on a non-string argument instead of stringifying it, and
 * passes an already-absolute `rel` through unchanged (via the shared
 * `isAbsolutePath` check) rather than re-joining it under `root`.
 */
export function workspacePath(root: string, rel: string): string {
  if (typeof root !== 'string' || typeof rel !== 'string') {
    throw new TypeError(
      `workspacePath: expected string arguments, got root=${typeof root} rel=${typeof rel}`,
    );
  }
  if (isAbsolutePath(rel)) return normalizeForComparison(rel);
  return joinWorkspacePath(root, rel);
}

export { isAbsolutePath };
