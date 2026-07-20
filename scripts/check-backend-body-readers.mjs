#!/usr/bin/env node
/**
 * Fail-closed enforcement for the backend request-body totality boundary.
 *
 * Runtime is the primary defense: server.ts gives handlers a new metadata-only
 * HttpRequest after lib/requestBody.ts has consumed the inbound stream under a
 * hard cap. The checker protects that structure with positive rules:
 *
 *  - raw Request types exist only in the seam and Bun's top-level fetch;
 *  - Bun's raw fetch parameter may be used only for safe metadata, preparation,
 *    peer-IP lookup, and WebSocket upgrade;
 *  - handler requests may expose only the small metadata member allowlist, and
 *    may never be cast to recover invented members;
 *  - the three reviewed outbound-response reads remain exact and growth-locked.
 *
 * Scope is every git-tracked TypeScript source under backend/src. Any unknown
 * extension fails closed unless it is put on the reviewed exclusion list.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const REQUEST_TYPE_ALLOWED = new Map([
  ['backend/src/lib/requestBody.ts', 'The totality seam: consumes the one raw inbound Request and creates the safe metadata-only handler envelope.'],
  ['backend/src/server.ts', "Bun's fetch callback, requestIP, and upgrade APIs require the concrete inbound Request; every use of its parameter is positively checked."],
]);

export const RAW_READ_ALLOWED = new Map([
  ['backend/src/lib/requestBody.ts', 'The totality seam: its streaming reader enforces the hard cap before any handler runs.'],
  ['backend/src/lib/oidc.ts', 'Reads an outbound identity-provider Response, not an inbound request body; this direction is reviewed separately.'],
  ['backend/src/lib/docusignSigning/jwtGrant.ts', 'Reads an outbound DocuSign token Response, not an inbound request body; this direction is reviewed separately.'],
]);

/** Non-TypeScript files under backend/src must be named here or the scan fails. */
export const SOURCE_SCOPE_EXCLUDED = new Map();

const LOCKED_REQUEST_TYPE_PATHS = ['backend/src/lib/requestBody.ts', 'backend/src/server.ts'];
const LOCKED_RAW_READ_PATHS = [
  'backend/src/lib/docusignSigning/jwtGrant.ts',
  'backend/src/lib/oidc.ts',
  'backend/src/lib/requestBody.ts',
];
const LOCKED_SCOPE_EXCLUSIONS = [];
const TS_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const LEGACY_RAW_READ_METHODS = new Set(['text', 'json', 'arrayBuffer', 'blob', 'formData', 'bytes']);
const HANDLER_METADATA_MEMBERS = new Set(['url', 'method', 'headers', 'signal']);
const RAW_SERVER_METADATA_MEMBERS = new Set(['url', 'method']);
const RAW_SERVER_CALLS = new Set(['prepareHttpRequest', 'requestIP', 'upgrade']);

const sorted = (xs) => [...xs].sort();
const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

export function validateAllowlistIntegrity() {
  const checks = [
    ['REQUEST_TYPE_ALLOWED', sorted(REQUEST_TYPE_ALLOWED.keys()), LOCKED_REQUEST_TYPE_PATHS],
    ['RAW_READ_ALLOWED', sorted(RAW_READ_ALLOWED.keys()), LOCKED_RAW_READ_PATHS],
    ['SOURCE_SCOPE_EXCLUDED', sorted(SOURCE_SCOPE_EXCLUDED.keys()), LOCKED_SCOPE_EXCLUSIONS],
  ];
  for (const [name, actual, expected] of checks) {
    if (!same(actual, expected)) {
      throw new Error(`check-backend-body-readers: ${name} changed outside its reviewed lock. Expected ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`);
    }
  }
  for (const [path, reason] of [...REQUEST_TYPE_ALLOWED, ...RAW_READ_ALLOWED, ...SOURCE_SCOPE_EXCLUDED]) {
    if (typeof reason !== 'string' || reason.length <= 40) {
      throw new Error(`check-backend-body-readers: ${path} needs a reviewed justification longer than 40 characters.`);
    }
  }
}

function scriptKind(relPath) {
  if (relPath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (relPath.endsWith('.mts')) return ts.ScriptKind.TS;
  if (relPath.endsWith('.cts')) return ts.ScriptKind.TS;
  return ts.ScriptKind.TS;
}

function namedType(node, name) {
  return ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === name;
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return null;
}

function directCallName(call) {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return null;
}

function isDeclarationIdentifier(node) {
  return (ts.isParameter(node.parent) || ts.isVariableDeclaration(node.parent) || ts.isBindingElement(node.parent)) && node.parent.name === node;
}

function isDirectMemberBase(node) {
  return (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) && node.parent.expression === node;
}

function isAllowedRawServerReference(node) {
  if (isDeclarationIdentifier(node)) return true;
  if (isDirectMemberBase(node)) return RAW_SERVER_METADATA_MEMBERS.has(memberName(node.parent));
  if (ts.isCallExpression(node.parent)) {
    const index = node.parent.arguments.indexOf(node);
    return index === 0 && RAW_SERVER_CALLS.has(directCallName(node.parent));
  }
  return false;
}

/** @returns {{rule:string,line:number,message:string}[]} */
export function scanSource(relPath, sourceText) {
  const sf = ts.createSourceFile(relPath, sourceText, ts.ScriptTarget.Latest, true, scriptKind(relPath));
  const violations = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const requestAllowed = REQUEST_TYPE_ALLOWED.has(relPath);
  const rawAllowed = RAW_READ_ALLOWED.has(relPath);
  const handlerParams = new Set();
  const rawServerParams = new Set();

  for (const diagnostic of sf.parseDiagnostics ?? []) {
    const start = diagnostic.start ?? 0;
    const line = sf.getLineAndCharacterOfPosition(start).line + 1;
    violations.push({
      rule: 'parse-failure',
      line,
      message: `TypeScript parse failed closed: TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`,
    });
  }

  const collect = (node) => {
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      if (namedType(node.type, 'HttpRequest')) handlerParams.add(node.name);
      if (namedType(node.type, 'Request')) rawServerParams.add(node.name);
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  const handlerNames = new Set([...handlerParams].map((n) => n.text));
  const rawServerNames = new Set([...rawServerParams].map((n) => n.text));

  const visit = (node) => {
    const isCastTarget = node.parent && (ts.isAsExpression(node.parent) || ts.isTypeAssertionExpression(node.parent)) && node.parent.type === node;
    if (!requestAllowed && !isCastTarget && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Request') {
      violations.push({ rule: 'request-type-confinement', line: at(node), message: 'Raw Request is confined to the totality seam and Bun fetch boundary. Handlers receive HttpRequest metadata plus already-capped private bytes.' });
    }
    if (!requestAllowed && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && namedType(node.type, 'Request')) {
      violations.push({ rule: 'request-type-confinement', line: at(node), message: 'Casting to Request attempts to reintroduce a drainable object outside the totality boundary.' });
    }
    if (!requestAllowed && ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Request') {
      violations.push({ rule: 'request-type-confinement', line: at(node), message: 'Constructing Request under backend/src is confined to the totality seam.' });
    }

    if (relPath !== 'backend/src/lib/requestBody.ts' && (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && ts.isIdentifier(node.expression) && handlerNames.has(node.expression.text)) {
      violations.push({ rule: 'handler-request-confinement', line: at(node), message: 'A handler request may not be cast. It is a metadata-only envelope; use its declared metadata or a capped reader directly.' });
    }
    if (relPath !== 'backend/src/lib/requestBody.ts' && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && ts.isIdentifier(node.expression) && handlerNames.has(node.expression.text)) {
      const name = memberName(node);
      if (name === null || !HANDLER_METADATA_MEMBERS.has(name)) {
        violations.push({ rule: 'handler-request-confinement', line: at(node), message: `Handler requests expose only ${[...HANDLER_METADATA_MEMBERS].join(', ')}. Unknown/computed members fail closed.` });
      }
    }
    if (relPath !== 'backend/src/lib/requestBody.ts' && ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && ts.isIdentifier(node.initializer) && handlerNames.has(node.initializer.text)) {
      for (const element of node.name.elements) {
        const name = element.propertyName ?? element.name;
        if (!ts.isIdentifier(name) || !HANDLER_METADATA_MEMBERS.has(name.text)) {
          violations.push({ rule: 'handler-request-confinement', line: at(node), message: 'Destructuring a non-metadata member from HttpRequest is forbidden.' });
          break;
        }
      }
    }

    if (relPath === 'backend/src/server.ts' && ts.isIdentifier(node) && rawServerNames.has(node.text) && !isAllowedRawServerReference(node)) {
      violations.push({ rule: 'raw-server-request-use', line: at(node), message: `The raw Bun Request may only be passed to ${[...RAW_SERVER_CALLS].join(', ')} or read for ${[...RAW_SERVER_METADATA_MEMBERS].join(', ')}. All other uses fail closed.` });
    }

    if (!rawAllowed && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && LEGACY_RAW_READ_METHODS.has(node.expression.name.text)) {
      violations.push({ rule: 'no-raw-body-drain', line: at(node), message: `.${node.expression.name.text}() buffers an entire body. Inbound reads must use the totality seam; outbound reads require an exact reviewed exception.` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

/** Universal git scope minus an exact reviewed exclusion list. */
export function trackedBackendSources(root = repoRoot) {
  const out = execFileSync('git', ['ls-files', '-z', '--', 'backend/src'], { cwd: root, encoding: 'utf8' });
  const tracked = out.split('\0').filter(Boolean);
  const unknown = tracked.filter((path) => !TS_SOURCE_EXTENSIONS.has(extname(path)) && !SOURCE_SCOPE_EXCLUDED.has(path));
  if (unknown.length > 0) {
    throw new Error(`check-backend-body-readers: refusing unknown tracked backend/src file type(s): ${unknown.join(', ')}. Review and scan it, or add an exact justified exclusion.`);
  }
  return tracked.filter((path) => !SOURCE_SCOPE_EXCLUDED.has(path));
}

function main() {
  try {
    validateAllowlistIntegrity();
    const files = trackedBackendSources();
    if (files.length === 0) throw new Error('check-backend-body-readers: found 0 tracked files under backend/src — refusing to report a pass on an empty scan.');
    const scanned = new Set(files);
    const stale = [...REQUEST_TYPE_ALLOWED.keys(), ...RAW_READ_ALLOWED.keys()].filter((path) => !scanned.has(path));
    if (stale.length > 0) throw new Error(`check-backend-body-readers: allowlist names untracked path(s): ${stale.join(', ')}`);

    let total = 0;
    for (const rel of files) {
      for (const violation of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) {
        console.error(`${rel}:${violation.line}  [${violation.rule}]  ${violation.message}`);
        total++;
      }
    }
    if (total > 0) {
      console.error(`\n❌ check-backend-body-readers: ${total} violation(s) in ${files.length} scanned file(s); failing closed.`);
      process.exit(1);
    }
    console.log(`✅ check-backend-body-readers: ${files.length} tracked backend source files scanned; totality boundary intact.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
