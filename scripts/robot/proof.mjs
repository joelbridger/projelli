// scripts/robot/proof.mjs
export async function runVerb(name, fn) {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const data = await fn();
    const ok = !(data && typeof data === 'object' && data.ok === false);
    return { verb: name, ok, data, error: null, startedAt, durationMs: Date.now() - t0, artifacts: (data && data.artifacts) || [] };
  } catch (e) {
    return { verb: name, ok: false, data: null, error: String((e && e.message) || e), startedAt, durationMs: Date.now() - t0, artifacts: [] };
  }
}
