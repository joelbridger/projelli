// scripts/bench-smoke/parse.mjs — pure parsers for scripts/desktop-drive.mjs
// stdout. Kept separate from remote.mjs (I/O) so parsing bugs are cheap to
// unit test without a bench.

/** desktop-drive.mjs `snapshot` prints a JSON array of {testid?, tag, text?}. */
export function parseSnapshot(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data)) return { ok: false, error: 'snapshot output was not a JSON array', elements: [] };
    return { ok: true, elements: data };
  } catch (err) {
    return { ok: false, error: `snapshot output was not valid JSON: ${err.message}`, elements: [] };
  }
}

/** desktop-drive.mjs `pages` prints a JSON array of {url, title}. */
export function parsePages(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (!Array.isArray(data)) return { ok: false, error: 'pages output was not a JSON array', pages: [] };
    return { ok: true, pages: data };
  } catch (err) {
    return { ok: false, error: `pages output was not valid JSON: ${err.message}`, pages: [] };
  }
}

/** desktop-drive.mjs `eval` prints either a raw string or pretty-printed JSON. */
export function parseEvalResult(stdout) {
  const trimmed = (stdout ?? '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function findByTestId(elements, testid) {
  return elements.find((e) => e.testid === testid);
}

export function findByText(elements, needle) {
  const re = needle instanceof RegExp ? needle : new RegExp(escapeRegExp(String(needle)), 'i');
  return elements.find((e) => typeof e.text === 'string' && re.test(e.text));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
