import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const TEST_PATH = /(?:\.test\.|\.spec\.|\/__tests__\/)/;
const REQUIRED_TREE_ROOTS = ['src', 'scripts'];
const SOURCE_EXTENSION = /\.(?:cjs|js|jsx|mjs|ts|tsx)$/;
const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);
const REVIEWED_EXTERNAL_MATTER_SET_STATE = new Set([
  'src/dev/marketing-capture-bridge.ts',
  'src/platform/state/reloadWorkspaceScopedStores.ts',
]);

function memberCall(node, sourceFile) {
  if (ts.isPropertyAccessExpression(node.expression)) {
    return {
      owner: node.expression.expression.getText(sourceFile),
      method: node.expression.name.text,
    };
  }
  if (
    ts.isElementAccessExpression(node.expression) &&
    node.expression.argumentExpression &&
    (ts.isStringLiteral(node.expression.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.expression.argumentExpression))
  ) {
    return {
      owner: node.expression.expression.getText(sourceFile),
      method: node.expression.argumentExpression.text,
    };
  }
  return null;
}

function propertyName(node, sourceFile) {
  return node.name && ts.isIdentifier(node.name)
    ? node.name.text
    : node.name?.getText(sourceFile);
}

function assignedPropertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression &&
    (ts.isStringLiteral(node.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
  ) {
    return node.argumentExpression.text;
  }
  return undefined;
}

function enclosingPropertyName(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isPropertyAssignment(current) || ts.isMethodDeclaration(current)) {
      return propertyName(current, sourceFile);
    }
    current = current.parent;
  }
  return undefined;
}

function enclosingIfText(node, sourceFile) {
  let current = node.parent;
  while (current) {
    if (ts.isIfStatement(current)) return current.expression.getText(sourceFile);
    current = current.parent;
  }
  return '';
}

export function scanSelectionWriters(relativePath, source) {
  if (TEST_PATH.test(relativePath)) return { allowed: [], forbidden: [] };
  const sourceFile = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    relativePath.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : relativePath.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : /\.(?:cjs|js|mjs)$/.test(relativePath)
          ? ts.ScriptKind.JS
          : ts.ScriptKind.TS
  );
  const allowed = [];
  const forbidden = [];

  function record(node, disposition, detail) {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const entry = `${relativePath}:${String(line)} ${detail}`;
    (disposition === 'allowed' ? allowed : forbidden).push(entry);
  }

  function visit(node) {
    if (
      ts.isBinaryExpression(node) &&
      ASSIGNMENT_OPERATORS.has(node.operatorToken.kind) &&
      assignedPropertyName(node.left) === 'activeMatterId'
    ) {
      record(node, 'forbidden', 'direct activeMatterId property assignment');
    }

    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = node.initializer.getText(sourceFile);
      const sourceOwnsMatterWriter = initializer.includes('useMatterStore');
      const sourceOwnsClientWriter = initializer.includes('useClientContextStore');
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          const extracted = element.propertyName?.getText(sourceFile)
            ?? element.name.getText(sourceFile);
          if (sourceOwnsMatterWriter && extracted === 'setActiveMatter') {
            record(element, 'forbidden', 'destructured legacy writer setActiveMatter');
          }
          if (
            sourceOwnsClientWriter &&
            (extracted === 'setClient' || extracted === 'clearClient')
          ) {
            record(element, 'forbidden', `destructured legacy client writer ${extracted}`);
          }
        }
      } else if (
        ts.isIdentifier(node.name) &&
        ((sourceOwnsMatterWriter && /\.setActiveMatter\b/.test(initializer)) ||
          (sourceOwnsClientWriter && /\.(?:setClient|clearClient)\b/.test(initializer)))
      ) {
        record(node, 'forbidden', 'legacy selection writer extracted into a local binding');
      }
    }

    if (ts.isCallExpression(node)) {
      const member = memberCall(node, sourceFile);
      const method = member?.method;
      if (method === 'setActiveMatter') {
        if (relativePath === 'src/platform/client-context/clientContextStore.ts') {
          record(node, 'allowed', 'single source-owned follower projection');
        } else {
          record(node, 'forbidden', 'direct setActiveMatter caller');
        }
      }
      if (method === 'setClient' || method === 'clearClient') {
        record(node, 'forbidden', `direct legacy client writer ${method}`);
      }
      if (
        method === 'setState' &&
        member?.owner === 'useClientContextStore'
      ) {
        record(node, 'forbidden', 'raw client-context setState');
      }
      if (
        method === 'setState' &&
        member?.owner === 'useMatterStore' &&
        relativePath !== 'src/platform/matter/matterStore.ts' &&
        !REVIEWED_EXTERNAL_MATTER_SET_STATE.has(relativePath) &&
        !(
          node.arguments[0] &&
          ts.isObjectLiteralExpression(node.arguments[0]) &&
          node.arguments[0].properties.some(
            (property) =>
              ts.isPropertyAssignment(property) &&
              propertyName(property, sourceFile) === 'activeMatterId'
          )
        )
      ) {
        record(node, 'forbidden', 'unreviewed raw matter-store setState');
      }
    }

    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node, sourceFile) === 'activeMatterId'
    ) {
      let call = node.parent;
      while (call && !ts.isCallExpression(call)) call = call.parent;
      if (call && ts.isCallExpression(call)) {
        const callee = memberCall(call, sourceFile);
        const calleeText = call.expression.getText(sourceFile);
        if (callee?.owner === 'useMatterStore' && callee.method === 'setState') {
          const guard = enclosingIfText(call, sourceFile);
          if (
            relativePath === 'src/platform/matter/matterStore.ts' &&
            guard.includes('selectionWriterRetirementEnabled()')
          ) {
            record(node, 'allowed', 'dark-only disk hydration follower compatibility');
          } else {
            record(node, 'forbidden', 'raw useMatterStore.setState follower assignment');
          }
        } else if (calleeText === 'set') {
          const owner = enclosingPropertyName(call, sourceFile);
          if (relativePath === 'src/features/meetings/meetingStore.ts') {
            record(node, 'allowed', 'Meetings-private record cursor, not matter follower');
            return;
          }
          if (relativePath !== 'src/platform/matter/matterStore.ts') {
            record(node, 'forbidden', 'raw Zustand follower assignment outside matter owner');
          } else if (owner === 'setActiveMatter') {
            record(node, 'allowed', 'legacy follower setter reached only by projection writer');
          } else if (owner === 'deleteMatter' || owner === 'setMatterArchived') {
            const ownerText = call.parent?.parent?.getText(sourceFile) ?? '';
            if (ownerText.includes('selectionWriterRetirementEnabled()')) {
              record(node, 'allowed', `${owner} dark-only compatibility branch`);
            } else {
              record(node, 'forbidden', `${owner} independently chooses follower`);
            }
          } else {
            record(node, 'forbidden', `unexpected matter-store follower writer ${owner ?? 'unknown'}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { allowed, forbidden };
}

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(target));
    else if (SOURCE_EXTENSION.test(entry.name)) files.push(target);
  }
  return files;
}

export function auditSelectionWriters(root) {
  const allowed = [];
  const forbidden = [];
  for (const treeRoot of REQUIRED_TREE_ROOTS) {
    const directory = path.join(root, treeRoot);
    if (!fs.existsSync(directory)) continue;
    for (const file of walk(directory)) {
      const relativePath = path.relative(root, file).split(path.sep).join('/');
      const result = scanSelectionWriters(relativePath, fs.readFileSync(file, 'utf8'));
      allowed.push(...result.allowed);
      forbidden.push(...result.forbidden);
    }
  }
  const projectionWriterCount = allowed.filter((entry) =>
    entry.includes('single source-owned follower projection')
  ).length;
  if (projectionWriterCount !== 1) {
    forbidden.push(
      `selection projection writer count is ${String(projectionWriterCount)}; expected exactly 1`
    );
  }
  return { allowed, forbidden };
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
  : false;

if (invokedDirectly) {
  const root = process.cwd();
  const result = auditSelectionWriters(root);
  console.log('Allowed selection-writer inventory:');
  for (const entry of result.allowed) console.log(`ALLOW ${entry}`);
  if (result.forbidden.length > 0) {
    console.error('Forbidden selection writers:');
    for (const entry of result.forbidden) console.error(`FORBID ${entry}`);
    process.exitCode = 1;
  } else {
    console.log('PASS: one follower projection writer; zero direct client writers.');
  }
}
