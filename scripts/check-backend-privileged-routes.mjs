#!/usr/bin/env node
/**
 * Build-failing structural guard for backend privileged routes.
 *
 * The runtime registry makes `auth` mandatory in TypeScript. This independent
 * AST check closes the escape hatches TypeScript permits (casts, indirect
 * objects, direct handler dispatch) and derives its scan from BUILD ground truth (scripts/lib/gate-scope.mjs), never from the git index.
 */

import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveGateScope } from './lib/gate-scope.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PRIVILEGED_REGISTRY = 'backend/src/routes/privileged.ts';
export const ALLOWED_AUTH = new Set(['admin', 'provisioning']);

/** Calls to these handlers outside the registry are an auth-bypass registration. */
export const PRIVILEGED_HANDLERS = new Set([
  'handleAudit', 'handleCreateOrg', 'handleCreateUser', 'handleDeprovisionUser',
  'handleListOrgUsers', 'handleListSeats', 'handleRevokeSeat', 'handleTransferSeat',
  'handleAddMatterMember', 'handleArchiveMatter', 'handleClearWall', 'handleCreateMatter',
  'handleListMatterMembers', 'handleListMatters', 'handleRemoveMatterMember', 'handleSetWall',
  'handleCheckpointChunk', 'handleCheckpointManifest', 'handleCheckpointPrune',
  'handleSsoConfigDelete', 'handleSsoConfigGet', 'handleSsoConfigSet',
  'handleDeleteProviderKey', 'handleInferenceBilling', 'handleListProviderKeys', 'handleSetProviderKey',
]);

const RAW_PRIVILEGED_PATHS = new Set([
  '/org/seats', '/org/seat/revoke', '/org/user/deprovision', '/org/seats/transfer',
  '/org/users', '/org/users/list', '/org/audit', '/org/sso/config/set',
  '/org/sso/config/get', '/org/sso/config/delete', '/org/matters', '/org/matters/list',
  '/assured/keys/set', '/assured/keys/list', '/assured/keys/delete', '/assured/billing',
]);
const RAW_PRIVILEGED_RESTS = new Set([
  'members/add', 'members/remove', 'members/list', 'wall/set', 'wall/clear', 'archive',
  'checkpoints/chunks', 'checkpoints/manifest', 'checkpoints/prune',
]);

/**
 * The legacy server switch is frozen. Any newly compared path or dynamic
 * route suffix must go through a typed registry instead of silently growing
 * the switch. That makes a new security-sensitive route stop the build even
 * when its name is not on our privileged-handler list yet.
 */
const LEGACY_RAW_PATHS = new Set([
  '/notify/send', '/notify/inbox', '/notify/ack', '/notify/sync-ticket',
  '/notify/terminal', '/notify/sync', '/matter/mine', '/intake',
  '/intake/granted', '/healthz', '/.well-known/seat-pubkey', '/auth/login',
  '/auth/refresh', '/auth/logout', '/auth/me', '/auth/sso/start',
  '/auth/sso/callback', '/auth/sso/exchange', '/org/activate', '/seat/validate',
  '/seat/heartbeat', '/assured/infer', '/device/register', '/org/users/devices',
  '/org/admins', '/org/claim', '/webhooks/lemonsqueezy',
  '/webhooks/docusign-signing',
]);
const LEGACY_RAW_RESTS = new Set([
  'sync-ticket', 'sync', 'updates', 'checkpoints/receipt', 'keys/publish',
  'keys/fetch', 'keys', 'checklist', 'inbox', 'ack', 'revoke', 'extend',
  'regenerate', 'bundle', 'state', 'capability', 'launch', 'envelope',
  'wakeups', 'wakeups/ack',
]);

function property(object, name) {
  return object.properties.find((p) =>
    ts.isPropertyAssignment(p) &&
    ((ts.isIdentifier(p.name) && p.name.text === name) || (ts.isStringLiteral(p.name) && p.name.text === name)),
  );
}

function literalText(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;
}

/**
 * @returns {{rule: string, line: number, message: string}[]}
 */
export function scanSource(relPath, sourceText) {
  const sf = ts.createSourceFile(relPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const at = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const add = (node, rule, message) => violations.push({ rule, line: at(node), message });

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'definePrivilegedRoute') {
      const arg = node.arguments[0];
      if (!arg) {
        add(node, 'declared-auth-required', 'definePrivilegedRoute requires one inline route object with an explicit auth declaration.');
      } else if (ts.isAsExpression(arg) || ts.isTypeAssertionExpression(arg)) {
        add(arg, 'no-route-definition-cast', 'A cast can hide a missing auth property. Pass an inline object to definePrivilegedRoute without `as` or angle-bracket assertions.');
      } else if (!ts.isObjectLiteralExpression(arg)) {
        add(arg, 'inline-route-definition-required', 'Privileged route definitions must be inline object literals so the build can prove their auth declaration; renamed variables and factory results are refused.');
      } else {
        if (arg.properties.some((p) => ts.isSpreadAssignment(p))) {
          add(arg, 'no-route-definition-spread', 'A spread can smuggle in or overwrite auth. Spell out every privileged route field directly.');
        }
        const auth = property(arg, 'auth');
        if (!auth) {
          add(arg, 'declared-auth-required', 'Privileged route has no declared `auth`. Add an approved literal such as `auth: "admin"`; an undeclared privileged route must not build.');
        } else {
          const value = literalText(auth.initializer);
          if (!value || !ALLOWED_AUTH.has(value)) {
            add(auth, 'declared-auth-required', `Privileged route auth must be one approved literal (${[...ALLOWED_AUTH].map((v) => JSON.stringify(v)).join(', ')}), not a variable or cast.`);
          }
        }
        for (const required of ['id', 'method', 'path', 'purpose', 'handler']) {
          if (!property(arg, required)) add(arg, 'complete-route-definition', `Privileged route is missing required field \`${required}\`.`);
        }
      }
    }

    // A privileged handler invoked outside the registry bypasses the shared
    // pre-body authentication gate even if its current implementation happens
    // to repeat a check internally.
    if (
      relPath !== PRIVILEGED_REGISTRY &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      PRIVILEGED_HANDLERS.has(node.expression.text)
    ) {
      add(node, 'no-direct-privileged-dispatch', `${node.expression.text} is privileged and may only be dispatched from ${PRIVILEGED_REGISTRY}. Register it with definePrivilegedRoute and declare auth.`);
    }

    // Catch the historically vulnerable raw flat-switch shape as a second,
    // path-based layer. Comments and strings do not form binary expressions,
    // so they cannot silence or spuriously trigger this rule.
    if (relPath === 'backend/src/server.ts' && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken) {
      const sides = [[node.left, node.right], [node.right, node.left]];
      for (const [routeSide, valueSide] of sides) {
        const value = literalText(valueSide);
        if (!value) continue;
        const isPath = ts.isIdentifier(routeSide) && routeSide.text === 'path';
        const isRest = ts.isPropertyAccessExpression(routeSide) && routeSide.name.text === 'rest';
        if (!isPath && !isRest) continue;
        if (value.startsWith('/admin/') || RAW_PRIVILEGED_PATHS.has(value) || RAW_PRIVILEGED_RESTS.has(value)) {
          add(node, 'no-raw-privileged-route', `Privileged route fragment ${JSON.stringify(value)} is registered in the raw server switch. Move it to ${PRIVILEGED_REGISTRY} and declare auth.`);
        } else if ((isPath && !LEGACY_RAW_PATHS.has(value)) || (isRest && !LEGACY_RAW_RESTS.has(value))) {
          add(node, 'new-raw-route-requires-declaration', `New raw route fragment ${JSON.stringify(value)} is not allowed in the frozen server switch. Register it through a typed route definition with an explicit security declaration.`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return violations;
}

/**
 * Every backend TypeScript source, from build ground truth.
 *
 * SCOPE (R-30). This was `git ls-files -z -- backend/src`: the git INDEX. A new
 * route file that is written but not yet `git add`ed, and any file under a
 * gitignored path (the root `.gitignore`'s bare `dist` already shadows
 * `backend/src/dist/`), was invisible — so an unauthenticated privileged route
 * could be added and this checker would print a green tick AND a scanned-file
 * count that both looked right. That is the second checker in this repository
 * found with an index-derived scope, so the derivation was removed from every
 * checker rather than patched here: scope now comes from
 * scripts/lib/gate-scope.mjs (filesystem walk of backend/src UNION the backend
 * TypeScript project's own resolved file list), and no git is consulted.
 */
export function backendSources(root = repoRoot) {
  return deriveGateScope({
    label: 'check-backend-privileged-routes',
    root,
    walkRoots: ['backend/src'],
    projects: [{ dir: 'backend' }],
    requireExtensions: TS_SOURCE_EXTENSIONS,
  });
}

/** backend/src is declared TypeScript-only; anything else in it THROWS, never skips. */
const TS_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

function main() {
  const scope = backendSources();
  const files = scope.files;
  if (!files.includes(PRIVILEGED_REGISTRY)) {
    console.error(`check-backend-privileged-routes: required registry is not in the derived scope: ${PRIVILEGED_REGISTRY}`);
    process.exit(1);
  }

  let total = 0;
  for (const rel of files) {
    for (const violation of scanSource(rel, readFileSync(resolve(repoRoot, rel), 'utf8'))) {
      console.error(`${rel}:${violation.line}  [${violation.rule}]  ${violation.message}`);
      total++;
    }
  }
  if (total > 0) {
    console.error('');
    console.error(`❌ check-backend-privileged-routes: ${total} violation(s) in ${files.length} scanned file(s).`);
    console.error('   Privileged backend routes must be registered through definePrivilegedRoute with explicit auth,');
    console.error('   so authentication runs before target lookup or request-body reading.');
    process.exit(1);
  }
  console.log(
    `✅ check-backend-privileged-routes: ${files.length} backend source file(s) scanned ` +
      `(filesystem walk ${scope.fromWalk.length}, compiler cross-oracle ${scope.fromCompiler.length}; ` +
      `scope is not derived from git); every privileged registration declares auth.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
