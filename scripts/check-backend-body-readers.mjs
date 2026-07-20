#!/usr/bin/env node
/**
 * Fail-closed enforcement of the backend request-body REACHABILITY property.
 *
 * ── WHAT IS ENFORCED ─────────────────────────────────────────────────────────
 * Not "these known drain shapes are banned". That is an enumeration, and an
 * enumeration is defeated by the shape nobody listed. What is enforced is the
 * structural property the runtime already has:
 *
 *     NO `Request` AND NO `ReadableStream` IS REACHABLE FROM ANY CODE UNDER
 *     backend/src EXCEPT THE SEAM (lib/requestBody.ts) AND THE EXACT REVIEWED
 *     OUTBOUND-RESPONSE READERS.
 *
 * If neither type can be named, typed, constructed, cast to, or referenced as a
 * value outside those files, then no handler and no helper can hold one — and a
 * drain needs one. The N+1th clever shape does not need to be predicted, because
 * it has no raw material to operate on. That is the same claim the runtime makes
 * (a frozen four-property envelope, `Object.prototype`, nothing stream-bearing
 * reachable); this checker is the REGRESSION defence that keeps it true.
 *
 * ── WHY THERE IS NO CALLEE ALLOWLIST ANY MORE ────────────────────────────────
 * A previous revision let Bun's raw `fetch` parameter live in `server.ts` and
 * guarded it with a positive allowlist of callee NAMES (`prepareHttpRequest`,
 * `requestIP`, `upgrade`). A reviewer defeated it in one line: an imported
 * function that merely happens to be *named* `upgrade` satisfied the allowlist,
 * its callee module was clean too (`getReader()` was on no denylist), and a
 * 300 MB flood took RSS to 381.8 MB with the scan, the self-test and `tsc` all
 * green. An allowlist over a name is defeatable by naming.
 *
 * So the raw parameter was REMOVED instead. `lib/requestBody.ts` now owns Bun's
 * fetch callback (`serveFetch`) and the two APIs that genuinely need the
 * concrete request (`peerAddress`, `upgradeWebSocket`). `server.ts` never
 * receives, names, or holds a `Request`. There is no name left to allowlist and
 * therefore none to defeat.
 *
 * ── SCOPE COMES FROM THE COMPILER, NOT FROM GIT ──────────────────────────────
 * `git ls-files` is a PROXY for "what gets compiled" and it diverges: a
 * `.gitignore`d file is invisible to git and compiled by `tsc` anyway (the root
 * `.gitignore`'s bare `dist` already shadows `backend/src/dist/`). Scope is now
 * taken from `tsc --noEmit --listFilesOnly` — the compiler's own file set — and
 * unioned with a direct filesystem walk of `backend/src` so a non-TypeScript
 * file the compiler ignores still fails closed. Neither channel can hide a file
 * from the other; there is no exclusion list in either.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** THE seam. One file. Everything about the boundary lives or dies here. */
export const SEAM_PATH = 'backend/src/lib/requestBody.ts';

/** Files permitted to name/type/construct a raw `Request`. */
export const REQUEST_TYPE_ALLOWED = new Map([
  [SEAM_PATH, 'The totality seam: it owns Bun\'s fetch callback, consumes the one raw inbound Request, and hands out a metadata-only envelope.'],
]);

/** Files permitted to name/type/construct a `ReadableStream`. */
export const STREAM_TYPE_ALLOWED = new Map([
  [SEAM_PATH, 'The totality seam: its capped streaming reader is the only consumer of the inbound body stream.'],
  ['backend/src/lib/assured.ts', 'Scans an OUTBOUND provider Response stream for token counts; no inbound request body reaches this module.'],
]);

/** Files permitted to call a whole-body buffering method (.text/.json/...). */
export const RAW_READ_ALLOWED = new Map([
  [SEAM_PATH, 'The totality seam: its streaming reader enforces the hard cap before any handler runs.'],
  ['backend/src/lib/oidc.ts', 'Reads an outbound identity-provider Response, not an inbound request body; this direction is reviewed separately.'],
  ['backend/src/lib/docusignSigning/jwtGrant.ts', 'Reads an outbound DocuSign token Response, not an inbound request body; this direction is reviewed separately.'],
]);

/** Files permitted to take a reader/tee/pipe off a stream. */
export const STREAM_DRAIN_ALLOWED = new Map([
  [SEAM_PATH, 'The totality seam: the capped reader aborts and cancels the inbound stream the moment the cap is crossed.'],
  ['backend/src/lib/assured.ts', 'Reads the OUTBOUND provider Response branch for usage counts; the bytes are discarded and never buffered whole.'],
  ['backend/src/routes/assured.ts', 'Tees the OUTBOUND provider Response so the client branch streams through untouched; no inbound body is involved.'],
]);

const LOCKED_REQUEST_TYPE_PATHS = [SEAM_PATH];
const LOCKED_STREAM_TYPE_PATHS = ['backend/src/lib/assured.ts', SEAM_PATH];
const LOCKED_RAW_READ_PATHS = [
  'backend/src/lib/docusignSigning/jwtGrant.ts',
  'backend/src/lib/oidc.ts',
  SEAM_PATH,
];
const LOCKED_STREAM_DRAIN_PATHS = ['backend/src/lib/assured.ts', SEAM_PATH, 'backend/src/routes/assured.ts'];

const TS_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const LEGACY_RAW_READ_METHODS = new Set(['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes']);
const STREAM_DRAIN_METHODS = new Set(['getReader', 'tee', 'pipeTo', 'pipeThrough']);
const STREAM_HELPER_CALLS = new Set([
  'readableStreamToText', 'readableStreamToArrayBuffer', 'readableStreamToBytes',
  'readableStreamToBlob', 'readableStreamToArray', 'readableStreamToJSON', 'readableStreamToFormData',
]);
const HANDLER_METADATA_MEMBERS = new Set(['url', 'method', 'headers', 'signal']);
const REFLECTION_NAMESPACES = new Set(['Reflect', 'Object']);
/** The ONE permitted producer of Bun's fetch callback. */
const SEAM_FETCH_FACTORY = 'serveFetch';

/**
 * Every rule this checker can emit. DECLARED here; the self-test derives the
 * same set independently from the AST of this file (every string literal
 * assigned to a `rule:` property) and fails if the two disagree in either
 * direction. It then requires each id to have a corpus shape that is detected by
 * that rule and no other, so deleting any rule produces a specific, named red.
 */
export const RULE_IDS = Object.freeze([
  'parse-failure',
  'request-type-annotation',
  'request-type-cast',
  'request-type-construction',
  'request-type-value',
  'stream-type-annotation',
  'stream-type-cast',
  'stream-type-construction',
  'stream-type-value',
  'handler-request-cast',
  'handler-request-member',
  'handler-request-computed',
  'handler-request-destructure',
  'handler-request-reflection',
  'handler-request-spread',
  'bun-serve-fetch-confinement',
  'bun-serve-options-confinement',
  'no-raw-body-drain',
  'no-stream-drain',
]);

const RULE_ID_SET = new Set(RULE_IDS);

const sorted = (xs) => [...xs].sort();
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

export function validateAllowlistIntegrity() {
  const checks = [
    ['REQUEST_TYPE_ALLOWED', sorted(REQUEST_TYPE_ALLOWED.keys()), LOCKED_REQUEST_TYPE_PATHS],
    ['STREAM_TYPE_ALLOWED', sorted(STREAM_TYPE_ALLOWED.keys()), LOCKED_STREAM_TYPE_PATHS],
    ['RAW_READ_ALLOWED', sorted(RAW_READ_ALLOWED.keys()), LOCKED_RAW_READ_PATHS],
    ['STREAM_DRAIN_ALLOWED', sorted(STREAM_DRAIN_ALLOWED.keys()), LOCKED_STREAM_DRAIN_PATHS],
  ];
  for (const [name, actual, expected] of checks) {
    if (!same(actual, expected)) {
      throw new Error(`check-backend-body-readers: ${name} changed outside its reviewed lock. Expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
    }
  }
  for (const [path, reason] of [...REQUEST_TYPE_ALLOWED, ...STREAM_TYPE_ALLOWED, ...RAW_READ_ALLOWED, ...STREAM_DRAIN_ALLOWED]) {
    if (typeof reason !== 'string' || reason.length <= 40) {
      throw new Error(`check-backend-body-readers: ${path} needs a reviewed justification longer than 40 characters.`);
    }
  }
}

function scriptKind(relPath) {
  return relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function namedType(node, name) {
  return node !== undefined && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === name;
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

/** Is this identifier a *declaration* name rather than a use? */
function isDeclarationName(node) {
  const p = node.parent;
  if (!p) return false;
  return (ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isBindingElement(p)
    || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isPropertySignature(p)
    || ts.isPropertyDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)
    || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isEnumDeclaration(p)
    || ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isNamespaceImport(p)
    || ts.isImportClause(p) || ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p))
    && p.name === node;
}

/** `x.Request` — the identifier is the member, not a free reference. */
function isMemberName(node) {
  const p = node.parent;
  return p !== undefined && ((ts.isPropertyAccessExpression(p) && p.name === node)
    || (ts.isQualifiedName(p) && p.right === node));
}

/**
 * Rules that make one global constructor (`Request`, `ReadableStream`)
 * unreachable outside its reviewed files: it may not be a type, a cast target,
 * a `new` target, or a free value reference — and neither may `globalThis.X`.
 */
function forbidGlobal(node, typeName, ids, at, violations, what) {
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === typeName) {
    const cast = node.parent && (ts.isAsExpression(node.parent) || ts.isTypeAssertionExpression(node.parent)) && node.parent.type === node;
    if (!cast) violations.push({ rule: ids.annotation, line: at(node), message: `${what} is confined to the request-body seam. Naming it as a type here would make a drainable object reachable outside the seam.` });
  }
  if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && namedType(node.type, typeName)) {
    violations.push({ rule: ids.cast, line: at(node), message: `Casting to ${typeName} attempts to reintroduce a drainable object outside the request-body seam.` });
  }
  if (ts.isNewExpression(node) && globalRef(node.expression, typeName)) {
    violations.push({ rule: ids.construction, line: at(node), message: `Constructing ${typeName} under backend/src is confined to the request-body seam.` });
  }
  // Free value reference: `Request.prototype…`, `x instanceof Request`,
  // `globalThis.Request`. Excludes the `new X()` callee, already covered above.
  const isNewCallee = node.parent && ts.isNewExpression(node.parent) && node.parent.expression === node;
  if (!isNewCallee && globalRef(node, typeName) && !isDeclarationName(node)) {
    violations.push({ rule: ids.value, line: at(node), message: `Referencing ${typeName} as a value outside the request-body seam can recover a drainable object (e.g. ${typeName}.prototype.*). It is confined to the seam.` });
  }
}

/**
 * `Request` / `globalThis.Request` referenced as a VALUE.
 *
 * A plain `x: Request` annotation is excluded here because the annotation rule
 * already owns it — but `typeof Request` (as in `InstanceType<typeof Request>`,
 * a gap a reviewer found) is deliberately NOT excluded: that form names the
 * constructor through a value query and must fail closed too.
 */
function globalRef(node, typeName) {
  const p = node.parent;
  if (p && ((ts.isTypeReferenceNode(p) && p.typeName === node) || ts.isQualifiedName(p))) return false;
  if (ts.isIdentifier(node) && node.text === typeName) return !isMemberName(node);
  if (ts.isPropertyAccessExpression(node) && node.name.text === typeName) return true;
  if (ts.isElementAccessExpression(node) && node.argumentExpression
    && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === typeName) return true;
  return false;
}

/** @returns {{rule:string,line:number,message:string}[]} */
export function scanSource(relPath, sourceText) {
  const sf = ts.createSourceFile(relPath, sourceText, ts.ScriptTarget.Latest, true, scriptKind(relPath));
  const violations = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const isSeam = relPath === SEAM_PATH;
  const requestAllowed = REQUEST_TYPE_ALLOWED.has(relPath);
  const streamTypeAllowed = STREAM_TYPE_ALLOWED.has(relPath);
  const rawAllowed = RAW_READ_ALLOWED.has(relPath);
  const streamDrainAllowed = STREAM_DRAIN_ALLOWED.has(relPath);

  for (const diagnostic of sf.parseDiagnostics ?? []) {
    const start = diagnostic.start ?? 0;
    violations.push({
      rule: 'parse-failure',
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
      message: `TypeScript parse failed closed: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    });
  }

  const handlerNames = new Set();
  const collect = (node) => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && namedType(node.type, 'HttpRequest')) {
      handlerNames.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const isHandlerRef = (node) => ts.isIdentifier(node) && handlerNames.has(node.text);

  const visit = (node) => {
    if (!requestAllowed) {
      forbidGlobal(node, 'Request', {
        annotation: 'request-type-annotation', cast: 'request-type-cast',
        construction: 'request-type-construction', value: 'request-type-value',
      }, at, violations, 'The raw Request');
    }
    if (!streamTypeAllowed) {
      forbidGlobal(node, 'ReadableStream', {
        annotation: 'stream-type-annotation', cast: 'stream-type-cast',
        construction: 'stream-type-construction', value: 'stream-type-value',
      }, at, violations, 'A ReadableStream');
    }

    // ── the handler envelope's own surface ───────────────────────────────────
    if (!isSeam) {
      if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && isHandlerRef(node.expression)) {
        violations.push({ rule: 'handler-request-cast', line: at(node), message: 'A handler request may not be cast. It is a metadata-only envelope; use its declared metadata or a capped reader directly.' });
      }
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isHandlerRef(node.expression)) {
        const name = memberName(node);
        if (name === null) {
          violations.push({ rule: 'handler-request-computed', line: at(node), message: 'A computed member key on a handler request cannot be checked statically, so it fails closed.' });
        } else if (!HANDLER_METADATA_MEMBERS.has(name)) {
          violations.push({ rule: 'handler-request-member', line: at(node), message: `Handler requests expose only ${[...HANDLER_METADATA_MEMBERS].join(', ')}. Unknown members fail closed.` });
        }
      }
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isHandlerRef(node.initializer)) {
        for (const element of node.name.elements) {
          const name = element.propertyName ?? element.name;
          if (!ts.isIdentifier(name) || !HANDLER_METADATA_MEMBERS.has(name.text)) {
            violations.push({ rule: 'handler-request-destructure', line: at(node), message: 'Destructuring a non-metadata member from HttpRequest is forbidden.' });
            break;
          }
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && REFLECTION_NAMESPACES.has(node.expression.expression.text)
        && node.arguments.some(isHandlerRef)) {
        violations.push({ rule: 'handler-request-reflection', line: at(node), message: `Passing a handler request to ${node.expression.expression.text}.${node.expression.name.text}() is a reflective lookup that cannot be checked statically. It fails closed.` });
      }
      if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && isHandlerRef(node.expression)) {
        violations.push({ rule: 'handler-request-spread', line: at(node), message: 'Spreading a handler request copies whatever members it happens to carry, defeating the declared metadata surface. It fails closed.' });
      }
    }

    // ── Bun's fetch callback may only be produced by the seam ────────────────
    if (!isSeam) {
      if ((ts.isPropertyAssignment(node) || ts.isMethodDeclaration(node) || ts.isShorthandPropertyAssignment(node))
        && node.name && ts.isIdentifier(node.name) && node.name.text === 'fetch'
        && ts.isObjectLiteralExpression(node.parent)) {
        const init = ts.isPropertyAssignment(node) ? node.initializer : undefined;
        const ok = init !== undefined && ts.isCallExpression(init)
          && ((ts.isIdentifier(init.expression) && init.expression.text === SEAM_FETCH_FACTORY)
            || (ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === SEAM_FETCH_FACTORY));
        if (!ok) {
          violations.push({ rule: 'bun-serve-fetch-confinement', line: at(node), message: `A server 'fetch' handler must be produced by the seam's ${SEAM_FETCH_FACTORY}(). Declaring it directly would receive Bun's raw Request — contextually typed, so it needs no 'Request' annotation to be drainable.` });
        }
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'serve' && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === 'Bun') {
        const arg = node.arguments[0];
        if (arg === undefined || !ts.isCallExpression(arg)) {
          violations.push({ rule: 'bun-serve-options-confinement', line: at(node), message: 'Bun.serve() options must come from a function call that builds them (so the fetch handler is visible to this checker), never an inline or indirect object.' });
        }
      }
    }

    // ── whole-body / stream draining ─────────────────────────────────────────
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const called = node.expression.name.text;
      if (!rawAllowed && LEGACY_RAW_READ_METHODS.has(called)) {
        violations.push({ rule: 'no-raw-body-drain', line: at(node), message: `.${called}() buffers an entire body. Inbound reads must use the totality seam; outbound reads require an exact reviewed exception.` });
      }
      if (!streamDrainAllowed && (STREAM_DRAIN_METHODS.has(called) || STREAM_HELPER_CALLS.has(called))) {
        violations.push({ rule: 'no-stream-drain', line: at(node), message: `.${called}() consumes a byte stream. Stream consumption is confined to the seam and the exact reviewed outbound-response readers.` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  // A rule that is not in the declared inventory has no sole-witness shape and
  // therefore no test proving it goes red for its own reason. Emitting one is a
  // programming error, and it fails closed rather than reporting an id nobody
  // can account for. Together with the self-test's requirement that every
  // declared id HAS a witness, no rule can exist without a specific test.
  for (const violation of violations) {
    if (!RULE_ID_SET.has(violation.rule)) {
      throw new Error(`check-backend-body-readers: emitted undeclared rule id '${violation.rule}'. Add it to RULE_IDS and give it a sole-witness shape in scripts/drain-shape-corpus.json.`);
    }
  }
  return violations;
}

/**
 * Scope, taken from the COMPILER and belted by the filesystem.
 *
 * `tsc --noEmit --listFilesOnly` is the same oracle the self-test uses, so the
 * scan and the ground truth are the same file set by construction rather than
 * two sources that have to be reconciled. The filesystem walk can only ADD:
 * `tsc` does not list a `.txt`/`.js` sitting under `backend/src`, and an
 * unknown extension must still fail closed rather than pass unseen. Symlinks
 * are refused outright — following one leaves the reviewed tree.
 *
 * Every failure of either channel THROWS. A scope that cannot be derived is
 * never read as an empty scope.
 */
export function trackedBackendSources(root = repoRoot) {
  const fromCompiler = compilerSources(root);
  const fromDisk = walkSources(root);
  const all = [...new Set([...fromCompiler, ...fromDisk])].sort();
  const unknown = all.filter((path) => !TS_SOURCE_EXTENSIONS.has(extname(path)));
  if (unknown.length > 0) {
    throw new Error(`check-backend-body-readers: refusing unknown backend/src file type(s): ${unknown.join(', ')}. Review and scan it, or delete it.`);
  }
  return all;
}

/** The TypeScript project's own file list, filtered to backend/src. */
function compilerSources(root) {
  const tsc = resolve(root, 'backend/node_modules/.bin/tsc');
  const backend = resolve(root, 'backend');
  // No backend project at this root (the self-test drives a throwaway repo to
  // prove the empty-scan refusal). Returning [] reaches that refusal; it never
  // reaches a pass.
  if (!existsSync(tsc) || !existsSync(resolve(backend, 'tsconfig.json'))) return [];
  let output;
  try {
    output = execFileSync(tsc, ['--noEmit', '--listFilesOnly', '--pretty', 'false'], { cwd: backend, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // The compiler is the scope oracle. If it cannot produce a file list — a
    // syntax error, a broken tsconfig, an unusable toolchain — the scope is
    // UNKNOWN, and an unknown scope is never an empty one.
    const detail = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n').trim();
    throw new Error(`check-backend-body-readers: refusing to derive scope — the TypeScript compiler could not list the backend project's files, so the scan cannot know what it has not seen.\n${detail}`);
  }
  const prefix = `${resolve(root, 'backend/src')}/`;
  return output.split('\n').map((line) => line.trim()).filter(Boolean)
    .filter((path) => path.startsWith(prefix))
    .map((path) => relative(root, path).replaceAll('\\', '/'));
}

/** Everything actually on disk under backend/src. Symlinks fail closed. */
function walkSources(root) {
  const base = resolve(root, 'backend/src');
  if (!existsSync(base)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = resolve(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`check-backend-body-readers: refusing symlink under backend/src: ${relative(root, abs)}. A symlink leaves the reviewed tree.`);
      }
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(relative(root, abs).replaceAll('\\', '/'));
    }
  };
  walk(base);
  return out;
}

/**
 * The whole check, as a callable unit.
 *
 * `root` exists so the self-test can drive the REAL logic against a real
 * throwaway repository — notably to prove the empty-scan refusal, which cannot
 * be reached from the CLI without deleting the backend. It is NOT a bypass: the
 * CLI below always passes the real repository root, and every abnormal outcome
 * on any root THROWS. There is no argument, env var, or root that turns a
 * finding into a pass.
 *
 * @returns {number} violation count (0 = clean). Throws on any refusal.
 */
export function runCheck(root = repoRoot, log = console) {
  validateAllowlistIntegrity();
  const files = trackedBackendSources(root);
  if (files.length === 0) throw new Error('check-backend-body-readers: found 0 source files under backend/src — refusing to report a pass on an empty scan.');
  const scanned = new Set(files);
  const stale = [...REQUEST_TYPE_ALLOWED.keys(), ...STREAM_TYPE_ALLOWED.keys(), ...RAW_READ_ALLOWED.keys(), ...STREAM_DRAIN_ALLOWED.keys()]
    .filter((path) => !scanned.has(path));
  if (stale.length > 0) throw new Error(`check-backend-body-readers: allowlist names path(s) that are not in scope: ${[...new Set(stale)].join(', ')}`);

  let total = 0;
  for (const rel of files) {
    for (const violation of scanSource(rel, readFileSync(resolve(root, rel), 'utf8'))) {
      log.error(`${rel}:${violation.line}  [${violation.rule}]  ${violation.message}`);
      total++;
    }
  }
  if (total > 0) {
    log.error(`\n❌ check-backend-body-readers: ${total} violation(s) in ${files.length} scanned file(s); failing closed.`);
    return total;
  }
  log.log(`✅ check-backend-body-readers: ${files.length} backend source files scanned (compiler-derived scope); no Request and no ReadableStream is reachable outside the seam.`);
  return 0;
}

function main() {
  try {
    if (runCheck() > 0) process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
