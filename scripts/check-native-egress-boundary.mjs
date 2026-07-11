#!/usr/bin/env node
/**
 * Static proof for Offline Mode's native boundary.
 *
 * `reqwest::Client` is intentionally a low-level transport.  A connector may
 * construct one to set its timeout/auth headers, but production transport must
 * still pass through `connector_network::{authorize_*, await_authorized}` (or
 * `EgressHttpClient`).  This check rejects a raw client or WebSocket
 * constructor unless the containing source file is one of those policy clients
 * or demonstrably uses that native policy boundary.
 *
 * This is deliberately source-level defence in depth, not a replacement for
 * the traffic-recording release test.  It makes a newly added native bypass
 * fail fast in both the local gate and CI.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const RAW_CONSTRUCTION = [
  /\breqwest::Client::(?:new|builder)\s*\(/,
  /\b(?:tokio_tungstenite|tungstenite)::(?:connect_async|client_async(?:_tls)?)\s*\(/,
];

const REDIRECT_CAPABLE_CLIENT = /\breqwest::Client::(?:new|builder)\s*\(/;
const RAW_REDIRECTING_GET = /\breqwest::get\s*\(/;
const REDIRECT_DISABLED = /\.redirect\s*\(\s*(?:reqwest::redirect::)?Policy::none\s*\(\s*\)\s*\)/;

// These are the boundary implementation itself, not consumers of it.
const POLICY_IMPLEMENTATIONS = new Set([
  'src-tauri/src/network_policy.rs',
  'src-tauri/src/egress_http.rs',
  'src-tauri/src/commands/connector_network.rs',
]);

const LOOPBACK_SIDECARS = new Set([
  // This sidecar owns a bundled process that is hard-bound to literal
  // 127.0.0.1. It cannot be configured to contact a remote host.
  'src-tauri/src/sidecars/llama_server.rs',
]);

const KNOWN_TRACKED_EXCEPTIONS = new Map([
  [
    'src-tauri/src/commands/firm/sso.rs',
    // KNOWN, TRACKED GAP: this file has unguarded /auth/sso/start and
    // /auth/sso/exchange calls. It is owned by the concurrent firm-relay
    // workstream and is NOT closed. Remove this exception when that lane lands
    // its Offline Mode fix. Do not add other production exceptions here.
    'KNOWN, TRACKED gap: unguarded SSO calls; owned by the concurrent firm-relay workstream; remove when that lane lands its Offline Mode fix.',
  ],
]);

function toPosix(path) {
  return path.split(sep).join('/');
}

function collectRustFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectRustFiles(full, out);
    else if (entry.endsWith('.rs')) out.push(full);
  }
  return out;
}

/**
 * Rust test modules conventionally live at the end of these files. Their fake
 * clients/loopback servers must not create a production-policy finding.
 */
function productionSource(source) {
  const testModule = source.search(/^\s*#\[cfg\(test\)\]\s*\n\s*mod\s+/m);
  return testModule === -1 ? source : source.slice(0, testModule);
}

function isPolicyGuardedClient(source) {
  const usesConnectorBoundary =
    (source.includes('crate::commands::connector_network::await_authorized') ||
      source.includes('crate::commands::connector_network::send_with_authorized_redirects') ||
      /\b(?:await_authorized|send_with_authorized_redirects)\s*\(/.test(source)) &&
    /\bNetworkPolicy\b/.test(source);
  const usesEgressHttpClient =
    source.includes('EgressHttpClient::new') && source.includes('authorize_url');
  return usesConnectorBoundary || usesEgressHttpClient;
}

/**
 * Per-call enclosure proof.
 *
 * `isPolicyGuardedClient` only proves a *file* contains guard code somewhere.
 * That is not proof that a given `.send()`/`.text()`/`.json()`/`.bytes()`
 * call is actually inside a guard's closure — a file can call
 * `await_authorized(...)` once for a header-time send and then read the
 * response body completely outside it. That body-read stops being
 * policy-owned the moment the guard closure returns, so a mode flip
 * mid-transfer cannot stop it — the exact bug class this check now also
 * catches, not just a raw unguarded client constructor.
 *
 * This walks every `await_authorized(...)` / `send_with_authorized_redirects(...)`
 * call in a guarded file, finds the balanced-bracket span of its argument
 * list (the closure passed to it lives inside that span), and then requires
 * every HTTP-completing call in the file — `.send().await`, `.text().await`,
 * `.json().await`/`.json::<T>().await`, `.bytes().await`, `.bytes_stream()`
 * — to fall inside at least one such span. A call outside every guard span
 * is a violation: the transport or the body it returned is not tied to the
 * live policy generation.
 */
const GUARD_CALL_NAMES = ['await_authorized', 'send_with_authorized_redirects'];
const HTTP_COMPLETING_CALL =
  /\.(?:send|text|bytes)\s*\(\s*\)\s*\.await|\.json\s*(?:::\s*<[^>]*>\s*)?\(\s*\)\s*\.await|\.bytes_stream\s*\(\s*\)/g;

/** Strip `//` line comments and `"..."` string literals to a same-length run
 * of spaces so index-based scanning stays aligned with the original source,
 * without matching brackets or call names that only appear in text. */
function blankCommentsAndStrings(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    if (source[i] === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (source[i] === '"') {
      let j = i + 1;
      while (j < n && source[j] !== '"') {
        if (source[j] === '\\') j += 1;
        j += 1;
      }
      j = Math.min(j + 1, n);
      out += ' '.repeat(j - i);
      i = j;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

const CFG_TEST_ATTR = /#\[cfg\(test\)\]/g;

/** Blank out the single statement an inline `#[cfg(test)]` attribute governs
 * (through the next top-level `;` or `,` — a match-arm body ends in `,`, a
 * `return`/`let` statement ends in `;`). That code does not exist in a
 * production build, so it must not be required to hold a live-policy guard;
 * this is the inline counterpart to `productionSource()`, which already
 * strips whole `#[cfg(test)] mod tests { ... }` blocks. Every connector's
 * `send()` helper uses exactly this idiom for its "no NetworkPolicy in a
 * production build" test-only fallback (`#[cfg(test)] return
 * Ok(request.send().await?);`), so leaving it unblanked would flag a path
 * that release binaries never contain. */
function blankInlineCfgTestStatements(scanSource) {
  let out = scanSource;
  CFG_TEST_ATTR.lastIndex = 0;
  let match;
  while ((match = CFG_TEST_ATTR.exec(out)) !== null) {
    const statementStart = match.index + match[0].length;
    let depth = 0;
    let end = out.length;
    for (let i = statementStart; i < out.length; i += 1) {
      const ch = out[i];
      if (ch === '(' || ch === '{' || ch === '[') depth += 1;
      else if (ch === ')' || ch === '}' || ch === ']') {
        depth -= 1;
        // A brace-bodied item (e.g. `#[cfg(test)] fn foo(...) { ... }`) ends
        // here; a plain statement's parens (e.g. `Ok(...)`) can also return
        // to depth 0 before the item does, but in that case the next branch
        // below catches the real end at the statement's trailing `;`/`,` —
        // this only fires early when a closing brace is what brought the
        // depth back to zero, i.e. an item body just closed.
        if (depth === 0 && ch === '}') {
          end = i + 1;
          break;
        }
      } else if ((ch === ';' || ch === ',') && depth === 0) {
        end = i + 1;
        break;
      }
    }
    out = out.slice(0, statementStart) + ' '.repeat(end - statementStart) + out.slice(end);
    CFG_TEST_ATTR.lastIndex = end;
  }
  return out;
}

/** Given the index of a call name's first character, return the balanced
 * span `[start, end)` of its argument list — from the `(` right after the
 * name through the matching `)` — or null if the source is malformed. Any
 * bracket type advances/retreats the same depth counter; Rust source is
 * well-nested, so depth returning to zero at a `)` is always that call's
 * true close even with `{}`/`[]` nested inside. */
function findCallArgSpan(scanSource, nameEnd) {
  const openParen = scanSource.indexOf('(', nameEnd);
  if (openParen === -1) return null;
  // Only whitespace may sit between the name and its `(`.
  if (scanSource.slice(nameEnd, openParen).trim().length > 0) return null;
  let depth = 0;
  for (let i = openParen; i < scanSource.length; i += 1) {
    const ch = scanSource[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return [openParen, i + 1];
    }
  }
  return null;
}

function findGuardSpans(scanSource) {
  const spans = [];
  for (const name of GUARD_CALL_NAMES) {
    const pattern = new RegExp(`\\b${name}\\s*(?=\\()`, 'g');
    let match;
    while ((match = pattern.exec(scanSource)) !== null) {
      const span = findCallArgSpan(scanSource, match.index + name.length);
      if (span) spans.push(span);
    }
  }
  return spans;
}

function findUnenclosedHttpCalls(source) {
  const scanSource = blankInlineCfgTestStatements(blankCommentsAndStrings(source));
  const guardSpans = findGuardSpans(scanSource);
  const violations = [];
  let match;
  HTTP_COMPLETING_CALL.lastIndex = 0;
  while ((match = HTTP_COMPLETING_CALL.exec(scanSource)) !== null) {
    const callStart = match.index;
    const enclosed = guardSpans.some(([start, end]) => callStart >= start && callStart < end);
    if (!enclosed) {
      const line = source.slice(0, callStart).split('\n').length;
      violations.push({ line, text: match[0] });
    }
  }
  return violations;
}

/** A builder's redirect setting must appear before its build call. Keeping the
 * scan local catches a copied client setup even when the rest of its file uses
 * authorize_url/await_authorized for the first request. */
function clientDisablesAutomaticRedirects(lines, start) {
  for (let index = start; index < Math.min(lines.length, start + 24); index += 1) {
    if (REDIRECT_DISABLED.test(lines.slice(start, index + 1).join(' '))) return true;
    if (/\.build\s*\(\s*\)/.test(lines[index])) return false;
  }
  return false;
}

export function findNativeEgressBoundaryViolations(root = repoRoot) {
  const nativeRoot = join(root, 'src-tauri/src');
  const violations = [];

  for (const file of collectRustFiles(nativeRoot)) {
    const relPath = toPosix(relative(root, file));
    const source = productionSource(readFileSync(file, 'utf8'));
    const lines = source.split('\n');
    const hasRawConstruction = lines.some((line) =>
      RAW_CONSTRUCTION.some((pattern) => pattern.test(line)),
    );
    const redirectViolations = [];
    if (
      !POLICY_IMPLEMENTATIONS.has(relPath) &&
      !LOOPBACK_SIDECARS.has(relPath) &&
      !KNOWN_TRACKED_EXCEPTIONS.has(relPath)
    ) {
      lines.forEach((line, index) => {
        if (RAW_REDIRECTING_GET.test(line)) {
          redirectViolations.push({
            relPath,
            line: index + 1,
            text: line.trim(),
            rule: 'raw reqwest::get follows redirects automatically',
          });
        } else if (
          REDIRECT_CAPABLE_CLIENT.test(line) &&
          !clientDisablesAutomaticRedirects(lines, index)
        ) {
          redirectViolations.push({
            relPath,
            line: index + 1,
            text: line.trim(),
            rule: 'reqwest client does not explicitly disable automatic redirects',
          });
        }
      });
    }
    violations.push(...redirectViolations);

    const exempt =
      POLICY_IMPLEMENTATIONS.has(relPath) ||
      LOOPBACK_SIDECARS.has(relPath) ||
      KNOWN_TRACKED_EXCEPTIONS.has(relPath);
    const guardedClient = !exempt && isPolicyGuardedClient(source);

    // A file that claims to route through the guard boundary must prove
    // every send and every body-read is actually enclosed by a guard call,
    // not merely that a guard call appears somewhere in the file.
    if (guardedClient) {
      for (const violation of findUnenclosedHttpCalls(source)) {
        violations.push({
          relPath,
          line: violation.line,
          text: violation.text,
          rule: 'HTTP call is not enclosed by an await_authorized/send_with_authorized_redirects span',
        });
      }
    }

    if (!hasRawConstruction) continue;

    if (exempt || guardedClient) continue;

    lines.forEach((line, index) => {
      if (RAW_CONSTRUCTION.some((pattern) => pattern.test(line))) {
        violations.push({ relPath, line: index + 1, text: line.trim() });
      }
    });
  }

  return violations;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const violations = findNativeEgressBoundaryViolations();
  if (violations.length > 0) {
    console.error('❌ Native network construction outside Offline Mode policy boundary:\n');
    for (const violation of violations) {
      console.error(`   ${violation.relPath}:${violation.line}  ${violation.text}${violation.rule ? ` (${violation.rule})` : ''}`);
    }
    console.error(
      '\nUse EgressHttpClient or connector_network authorization before the transport, and disable automatic redirects so every hop is authorized. ' +
        'Only the native policy implementation, literal-loopback sidecar, and one loud tracked SSO gap are exempt.',
    );
    process.exit(1);
  }

  const exceptions = [...KNOWN_TRACKED_EXCEPTIONS.entries()];
  console.log('✅ Native network construction is behind the Offline Mode policy boundary.');
  for (const [path, reason] of exceptions) {
    console.log(`⚠️  TEMPORARY EXCEPTION ${path}: ${reason}`);
  }
}
