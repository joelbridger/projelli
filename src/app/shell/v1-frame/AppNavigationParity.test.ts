import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getAppSurfaceDescriptors } from '@/app/shell/registry/appSurfaceRegistry';
import type { AppSurface } from '@/platform/types/navigation';

type NavigationHandler = (surface: AppSurface) => void;
type NavigationEvent = readonly [name: string, value?: string | null];

const appSourceText = readFileSync(
  resolve(process.cwd(), 'src/App.tsx'),
  'utf8'
);
const appSource = ts.createSourceFile(
  'App.tsx',
  appSourceText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

function findJsxHandler(
  tagName: string,
  attributeName: string
): ts.ArrowFunction {
  const matches: ts.ArrowFunction[] = [];

  function visit(node: ts.Node): void {
    const element = ts.isJsxSelfClosingElement(node)
      ? node
      : ts.isJsxOpeningElement(node)
        ? node
        : null;
    if (element?.tagName.getText(appSource) === tagName) {
      for (const property of element.attributes.properties) {
        if (
          ts.isJsxAttribute(property) &&
          property.name.getText(appSource) === attributeName &&
          property.initializer &&
          ts.isJsxExpression(property.initializer) &&
          property.initializer.expression &&
          ts.isArrowFunction(property.initializer.expression)
        ) {
          matches.push(property.initializer.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(appSource);
  if (matches.length !== 1 || !matches[0]) {
    throw new Error(
      `Expected one ${tagName}.${attributeName} handler, found ${String(matches.length)}`
    );
  }
  return matches[0];
}

function compileHandler(
  handler: ts.ArrowFunction,
  context: Record<string, unknown>
): NavigationHandler {
  const javascript = ts.transpileModule(`(${handler.getText(appSource)})`, {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return runInNewContext(javascript, context) as NavigationHandler;
}

function runHandler(
  handler: ts.ArrowFunction,
  targetSurface: AppSurface,
  activeSurface: AppSurface,
  activeMatterId: string | null
): NavigationEvent[] {
  const events: NavigationEvent[] = [];
  const record = (name: string, value?: string | null) => {
    events.push(value === undefined ? [name] : [name, value]);
  };
  const matterState = {
    activeMatterId,
    setClientMapHubId: (value: string | null) => {
      record('setClientMapHubId', value);
    },
    setClientMapHubTab: (value: string | null) => {
      record('setClientMapHubTab', value);
    },
  };

  const compiled = compileHandler(handler, {
    sidebarActiveTab: activeSurface,
    pushNavigationSnapshot: () => {
      record('pushNavigationSnapshot');
    },
    setDocumentsView: (value: string) => {
      record('setDocumentsView', value);
    },
    setMattersSurfaceMode: (value: string) => {
      record('setMattersSurfaceMode', value);
    },
    setSidebarActiveTab: (value: string) => {
      record('setSidebarActiveTab', value);
    },
    readSelectionPresentation: () => ({ matterId: activeMatterId }),
    useMatterStore: { getState: () => matterState },
  });
  compiled(targetSurface);
  return events;
}

describe('App shell navigation parity drift guard', () => {
  it('keeps the copied v1 navigation callback behavior identical to legacy', () => {
    const v1Handler = findJsxHandler('V1ShellFrameFlagGate', 'onSurfaceChange');
    const legacyHandler = findJsxHandler('AppShellNav', 'onTabChange');
    const surfaces = new Set<AppSurface>([
      ...getAppSurfaceDescriptors().map((descriptor) => descriptor.id),
      'files',
      'matters',
    ]);

    for (const targetSurface of surfaces) {
      for (const activeSurface of ['home', targetSurface] as const) {
        for (const activeMatterId of [null, 'matter-1'] as const) {
          expect(
            runHandler(v1Handler, targetSurface, activeSurface, activeMatterId),
            `${targetSurface} from ${activeSurface} with matter ${activeMatterId ?? 'none'}`
          ).toEqual(
            runHandler(
              legacyHandler,
              targetSurface,
              activeSurface,
              activeMatterId
            )
          );
        }
      }
    }
  });
});
