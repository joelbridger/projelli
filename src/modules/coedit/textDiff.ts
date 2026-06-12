import * as Y from 'yjs';

/** Apply the minimal edit turning `oldText` into `newText` onto `ytext`, as
 *  one delete + one insert at the first divergence point. No-op if equal.
 *  The ops are wrapped in a single transaction so they produce one update. */
export function applyTextDiff(
  doc: Y.Doc,
  ytext: Y.Text,
  oldText: string,
  newText: string,
  origin?: unknown
): void {
  if (oldText === newText) return;

  // Find common prefix length.
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText[start] === newText[start]) start++;

  // Find common suffix length, but never overlap the prefix region.
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const deleteLen = endOld - start;
  const insertStr = newText.slice(start, endNew);

  const fn = () => {
    if (deleteLen > 0) ytext.delete(start, deleteLen);
    if (insertStr.length > 0) ytext.insert(start, insertStr);
  };

  if (origin !== undefined) {
    doc.transact(fn, origin);
  } else {
    doc.transact(fn);
  }
}
