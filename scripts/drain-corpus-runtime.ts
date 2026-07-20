/**
 * Runs every corpus shape twice and prints JSON:
 *   `envelope` — against the value a handler receives on THIS branch;
 *   `raw`      — against a real `Request`, which is what handlers received at
 *                the merge base, so the "drains at baseline" column is measured
 *                rather than asserted.
 *
 * Same `source` strings the checker self-test scans. Run:
 *   bun scripts/drain-corpus-runtime.ts
 */
import { readFileSync } from "node:fs";

import { prepareHttpRequest } from "../backend/src/lib/requestBody.ts";

interface Shape { id: string; group: string; mode: string; source: string; expectRules: string[] }

const corpus: Shape[] = JSON.parse(
  readFileSync(new URL("./drain-shape-corpus.json", import.meta.url), "utf8"),
).shapes;

const BODY = "L".repeat(4096);
const raw = () => new Request("http://probe.invalid/x", { method: "POST", body: BODY });

function recovered(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") return new TextEncoder().encode(value).byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof Blob) return value.size;
  if (value instanceof FormData) return [...value.keys()].length;
  if (Array.isArray(value)) return value.reduce<number>((n, item) => n + recovered(item), 0);
  if (typeof value === "object") return new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength;
  return 0;
}

async function run(source: string, subject: unknown): Promise<{ bytes: number; threw: string | null }> {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  const probe = new Function(`${js}\nreturn probe;`)() as (req: unknown) => Promise<unknown>;
  try {
    return { bytes: recovered(await probe(subject)), threw: null };
  } catch (error) {
    return { bytes: 0, threw: error instanceof Error ? error.message : String(error) };
  }
}

const out: Record<string, unknown> = {};
for (const shape of corpus) {
  if (shape.mode !== "handler") { out[shape.id] = { skipped: "type-only" }; continue; }
  out[shape.id] = {
    envelope: await run(shape.source, prepareHttpRequest(raw(), 1024 * 1024)),
    raw: await run(shape.source, raw()),
  };
}
console.log(JSON.stringify(out, null, 2));
