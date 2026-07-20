/**
 * THE MERGE BOUND, AS AN EXECUTABLE TEST — plus the drain corpus as regression.
 *
 * The claim this branch merges on is NOT "these N shapes are blocked". A count
 * is a claim about the shapes someone thought of; the N+1th defeats it. The
 * claim is a REACHABILITY property:
 *
 *     From the value a handler receives, no `Request` and no `ReadableStream`
 *     is reachable — across own keys, accessors, symbols and the whole
 *     prototype chain — so there is nothing to drain, known shape or not.
 *
 * `reachability property` below asserts exactly that, by sweeping the real
 * envelope built by the real seam from a real `Request` carrying a real body.
 * The identical sweep against the raw request finds it immediately, which is
 * what makes the assertion non-vacuous.
 *
 * The 43 shapes are DEMOTED to what they actually are: a regression corpus.
 * They are read from `scripts/drain-shape-corpus.json` — the same bytes the
 * checker self-test scans and the same bytes any report table is rendered from
 * — so a table cell can never describe a different artifact than the one run.
 * 23 of them are the original review table; 20 were derived by a later reviewer
 * from a live `Request`'s 34 members and 15 of those drain at the merge base.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { prepareHttpRequest, type HttpRequest } from "../src/lib/requestBody.ts";

interface Shape {
  id: string;
  group: string;
  path: string;
  mode: "handler" | "static";
  source: string;
  expectRules: string[];
}

const corpus: Shape[] = JSON.parse(
  readFileSync(new URL("../../scripts/drain-shape-corpus.json", import.meta.url), "utf8"),
).shapes;

const BODY = "L".repeat(4096);

function envelope(): HttpRequest {
  return prepareHttpRequest(new Request("http://probe.invalid/x", { method: "POST", body: BODY }), 1024 * 1024);
}

/** Compile a corpus shape to a callable. The SAME source string the checker sees. */
function compile(source: string): (req: unknown) => Promise<unknown> {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(source);
  // eslint-disable-next-line no-new-func
  return new Function(`${js}\nreturn probe;`)() as (req: unknown) => Promise<unknown>;
}

/** How many bytes did this shape actually recover? Anything > 0 is a drain. */
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

/**
 * Breadth-first sweep for a drainable object, over own keys (including symbols),
 * accessor results, and the prototype chain. `budget` exists so an exhausted
 * sweep can never be mistaken for a clean one — the test asserts the sweep
 * finished rather than ran out.
 */
function findDrainable(root: unknown, maxDepth: number, budget: number): { hit: string | null; exhausted: boolean } {
  const seen = new Set<unknown>();
  let frontier: Array<{ value: unknown; path: string }> = [{ value: root, path: "envelope" }];
  let visited = 0;
  for (let depth = 0; depth < maxDepth; depth++) {
    const next: Array<{ value: unknown; path: string }> = [];
    for (const { value, path } of frontier) {
      if (value === null || (typeof value !== "object" && typeof value !== "function")) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      if (++visited > budget) return { hit: null, exhausted: true };
      if (value instanceof ReadableStream) return { hit: `ReadableStream@${path}`, exhausted: false };
      if (value instanceof Request) return { hit: `Request@${path}`, exhausted: false };
      for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor) continue;
        const label = `${path}.${String(key)}`;
        if ("value" in descriptor) next.push({ value: descriptor.value, path: label });
        if (descriptor.get) {
          try { next.push({ value: descriptor.get.call(value), path: label }); } catch { /* accessor refused */ }
        }
      }
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== null) next.push({ value: proto, path: `${path}.[[Proto]]` });
    }
    frontier = next;
  }
  return { hit: null, exhausted: false };
}

describe("the merge bound: reachability, not a count", () => {
  test("no Request and no ReadableStream is reachable from the handler envelope", () => {
    const swept = findDrainable(envelope(), 6, 200_000);
    expect(swept.exhausted).toBe(false);
    expect(swept.hit).toBeNull();
  });

  test("the identical sweep DOES find one on a raw Request, so the assertion is not vacuous", () => {
    const swept = findDrainable(new Request("http://probe.invalid/x", { method: "POST", body: BODY }), 6, 200_000);
    expect(swept.exhausted).toBe(false);
    expect(swept.hit).toBe("Request@envelope");
  });

  test("the envelope's whole surface is four data properties on Object.prototype", () => {
    const safe = envelope();
    expect(Object.keys(safe).sort()).toEqual(["headers", "method", "signal", "url"]);
    for (const key of Reflect.ownKeys(safe)) {
      const descriptor = Object.getOwnPropertyDescriptor(safe, key)!;
      expect(descriptor.get).toBeUndefined();
      expect(descriptor.set).toBeUndefined();
    }
    expect(Object.getPrototypeOf(safe)).toBe(Object.prototype);
    expect(Object.isFrozen(safe)).toBe(true);
    expect(safe instanceof Request).toBe(false);
    expect(Reflect.get(safe, Symbol.asyncIterator)).toBeUndefined();
  });
});

describe("regression corpus: 43 defeat shapes, run as written", () => {
  const runnable = corpus.filter((shape) => shape.mode === "handler");

  test("the corpus still holds both groups and has not silently shrunk", () => {
    expect(runnable.filter((s) => s.group === "review-23").length).toBe(22); // s22 is type-only
    expect(runnable.filter((s) => s.group === "derived-20").length).toBe(20);
  });

  for (const shape of runnable) {
    test(`${shape.id} (${shape.group}) recovers no bytes`, async () => {
      const probe = compile(shape.source);
      let result: unknown;
      try {
        result = await probe(envelope());
      } catch {
        result = undefined; // the shape threw: nothing recovered
      }
      expect(recovered(result)).toBe(0);
    });
  }
});
