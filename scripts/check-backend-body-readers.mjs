#!/usr/bin/env node
/**
 * check-backend-body-readers.mjs — the backend request-body seam is CLOSED.
 *
 * WHAT IT PROTECTS
 * ----------------
 * Bun enforces `maxRequestBodySize` only when a request declares a
 * Content-Length. A `Transfer-Encoding: chunked` request declares none, so a
 * handler that reads `await req.text()` and *then* measures the result has no
 * ceiling at all: the whole body lands in RAM first. Measured on this backend
 * before the fix, a 300 MB chunked POST to the unauthenticated
 * `/webhooks/lemonsqueezy` took RSS from 61.0 MB to a 375.6 MB peak and only
 * then answered 401.
 *
 * The fix routes every body read through `backend/src/lib/requestBody.ts`, which
 * streams and aborts at the cap. This script is what keeps it that way.
 *
 * TWO RULES, both AST-based (a comment or a string literal can neither trigger
 * nor silence them — the previous generation of "rules" in this repo were
 * comments claiming a lint rule that did not exist):
 *
 *   RULE 1 — Request confinement.
 *     The type name `Request` may not appear in a type position, and
 *     `new Request(...)` may not appear, anywhere under `backend/src` except the
 *     files in REQUEST_TYPE_ALLOWED. Every handler takes `HttpRequest`, which is
 *     `Request` minus every body-draining member, so `req.text()` in a handler
 *     is a compile error. Rule 1 closes the bypass of simply declaring the
 *     parameter as a full `Request` (or casting back to one) to get the members
 *     back.
 *
 *   RULE 2 — No raw body drain.
 *     A call to `.text()`, `.json()`, `.arrayBuffer()`, `.blob()`, `.formData()`
 *     or `.bytes()` may not appear under `backend/src` except in the files in
 *     RAW_READ_ALLOWED. Rule 2 covers the places Rule 1 cannot: `server.ts` must
 *     hold a concrete `Request` (Bun's `requestIP`/`upgrade` demand one), and
 *     this rule stops that request from ever being drained there.
 *
 * SCOPE IS UNIVERSAL MINUS A JUSTIFIED EXCLUSION LIST, not a heuristic: every
 * git-tracked `.ts` file under `backend/src` is parsed, and each exclusion below
 * carries a written reason. A fail-open scope does not merely miss a file, it
 * manufactures confidence.
 *
 * Usage:
 *   node scripts/check-backend-body-readers.mjs   # exit 0 clean, 1 on a violation
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The one module allowed to name `Request` in a type position. */
export const REQUEST_TYPE_ALLOWED = new Map([
  [
    'backend/src/lib/requestBody.ts',
    'THE seam. Defines HttpRequest = Omit<Request, ...body members> and holds the single blessed widening back to Request to reach the raw stream.',
  ],
  [
    'backend/src/server.ts',
    "Bun's own fetch handler: `srv.requestIP(req)` and `srv.upgrade(req, ...)` require the concrete Request type. RULE 2 still forbids this file from draining that body.",
  ],
]);

/** Files allowed to make a raw body-draining call, each with its reason. */
export const RAW_READ_ALLOWED = new Map([
  [
    'backend/src/lib/requestBody.ts',
    'THE seam. Every capped read is implemented here.',
  ],
  [
    'backend/src/lib/oidc.ts',
    'Reads an OUTBOUND fetch() Response from the identity provider (token + userinfo), not an inbound request body. Different direction, different trust class, size bounded by the IdP.',
  ],
  [
    'backend/src/lib/docusignSigning/jwtGrant.ts',
    'Reads an OUTBOUND fetch() Response from the DocuSign token endpoint, not an inbound request body.',
  ],
]);

const RAW_READ_METHODS = new Set(['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes']);

/**
 * Scan one TypeScript source. Exported so the checker's own test can feed it
 * hostile sources directly instead of trusting that a scan of the real tree
 * "would have" caught them.
 *
 * @param {string} relPath repo-relative path (decides which exclusions apply)
 * @param {string} sourceText
 * @returns {{rule: string, line: number, message: string}[]}
 */
export function scanSource(relPath, sourceText) {
  const sf = ts.createSourceFile(relPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const requestAllowed = REQUEST_TYPE_ALLOWED.has(relPath);
  const rawAllowed = RAW_READ_ALLOWED.has(relPath);

  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node) => {
    // RULE 1a — `Request` in a type position (parameter, return, alias, generic).
    // A cast's own type node is skipped here so `as Request` is reported once,
    // by 1b, with the message that actually explains the cast.
    const isCastTarget =
      node.parent &&
      (ts.isAsExpression(node.parent) || ts.isTypeAssertionExpression(node.parent)) &&
      node.parent.type === node;
    if (!requestAllowed && !isCastTarget && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Request') {
      violations.push({
        rule: 'request-type-confinement',
        line: at(node),
        message:
          'the type `Request` is confined to the request-body seam. Use `HttpRequest` from backend/src/lib/requestBody.ts — it is `Request` with the body-draining members removed, so an unbounded read cannot compile.',
      });
    }
    // RULE 1b — `as Request` / `<Request>expr`: casting the body members back on.
    if (
      !requestAllowed &&
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      ts.isTypeReferenceNode(node.type) &&
      ts.isIdentifier(node.type.typeName) &&
      node.type.typeName.text === 'Request'
    ) {
      violations.push({
        rule: 'request-type-confinement',
        line: at(node),
        message:
          'casting back to `Request` re-exposes the raw body stream and defeats the streaming cap. Read the body via readCappedJson / readCappedText / readCappedBytes instead.',
      });
    }
    // RULE 1c — `new Request(...)`.
    if (!requestAllowed && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Request') {
      violations.push({
        rule: 'request-type-confinement',
        line: at(node),
        message: 'constructing a `Request` inside backend/src is confined to the request-body seam.',
      });
    }
    // RULE 2 — a raw body-draining call.
    if (
      !rawAllowed &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      RAW_READ_METHODS.has(node.expression.name.text)
    ) {
      const method = node.expression.name.text;
      violations.push({
        rule: 'no-raw-body-drain',
        line: at(node),
        message:
          `\`.${method}()\` buffers a whole body before anything can measure it. Bun's maxRequestBodySize does NOT bound a chunked request, so this is an unbounded allocation on a public route. ` +
          'Use readCappedJson / readCappedText / readCappedBytes from backend/src/lib/requestBody.ts, which abort mid-stream at the cap.',
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

/** Every git-tracked `.ts` file under `backend/src` — universal, no globbing guesswork. */
export function trackedBackendSources(root = repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'backend/src'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((p) => p.endsWith('.ts'));
}

function main() {
  const files = trackedBackendSources();
  if (files.length === 0) {
    console.error('check-backend-body-readers: found 0 tracked files under backend/src — refusing to report a pass on an empty scan.');
    process.exit(1);
  }
  // A stale exclusion is a hole nobody is watching: every allowlisted path must
  // still exist in the scanned set, or the list is silently wrong.
  const scanned = new Set(files);
  const stale = [...REQUEST_TYPE_ALLOWED.keys(), ...RAW_READ_ALLOWED.keys()].filter((p) => !scanned.has(p));
  if (stale.length > 0) {
    console.error(`check-backend-body-readers: allowlist names ${stale.length} path(s) that are no longer tracked under backend/src:`);
    for (const p of stale) console.error(`  - ${p}`);
    console.error('Remove them from the allowlist (or restore the file). An exclusion for a file that does not exist hides nothing and proves nothing.');
    process.exit(1);
  }

  let total = 0;
  for (const rel of files) {
    const violations = scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'));
    for (const v of violations) {
      console.error(`${rel}:${v.line}  [${v.rule}]  ${v.message}`);
      total++;
    }
  }

  if (total > 0) {
    console.error('');
    console.error(`❌ check-backend-body-readers: ${total} violation(s) in ${files.length} scanned file(s).`);
    console.error('   Every request body in this backend must be read through backend/src/lib/requestBody.ts,');
    console.error('   which caps the read WHILE STREAMING. A Content-Length check followed by .text() is not a cap.');
    process.exit(1);
  }
  console.log(`✅ check-backend-body-readers: ${files.length} tracked backend source files scanned, request-body seam intact.`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
