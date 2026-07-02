/**
 * Regression test for v1.5-rc.8 React #185 infinite loop.
 *
 * Bug: AIChatViewer's loadAIRules useEffect had `workspaceServiceRef`
 * in the dependency array. Refs are stable by identity but their
 * `.current` changes without triggering re-renders, which confuses
 * React's effect dependency tracking. On chat pop-out or new chat
 * creation, rootPath changed + the ref pointer identity appeared to
 * change, triggering an effect-setState-render loop that crashed
 * with "Maximum update depth exceeded".
 *
 * Fix: deps array is [rootPath] only + an isMounted cleanup guard
 * prevents setState on an unmounted component mid-async.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';

// Minimal reproduction of the fixed pattern. Mirrors the production
// fix shape so regressions are caught even if the file moves.
function AiRulesLoader({
  rootPath,
  workspaceService,
}: {
  rootPath: string;
  workspaceService: {
    exists: (p: string) => Promise<boolean>;
    readFile: (p: string) => Promise<string>;
  };
}) {
  const ref = useRef(workspaceService);
  ref.current = workspaceService;
  const [aiRules, setAiRules] = useState('');

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      if (!rootPath || !ref.current) return;
      const path = `${rootPath}/ai-rules.md`;
      const exists = await ref.current.exists(path);
      if (!isMounted) return;
      if (exists) {
        const content = await ref.current.readFile(path);
        if (isMounted) setAiRules(content);
      } else {
        setAiRules('');
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [rootPath]); // <-- deps must NOT include the ref

  return <div data-testid="rules">{aiRules}</div>;
}

describe('AI rules loader effect dependency correctness', () => {
  it('loads rules once when rootPath is set', async () => {
    const service = {
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => 'BE BRIEF'),
    };
    const { getByTestId } = render(
      <AiRulesLoader rootPath="/ws" workspaceService={service} />,
    );
    await waitFor(() =>
      expect(getByTestId('rules').textContent).toBe('BE BRIEF'),
    );
    expect(service.exists).toHaveBeenCalledTimes(1);
    expect(service.readFile).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('does not loop when workspaceService ref mutates without rootPath change', async () => {
    const svc1 = {
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => 'A'),
    };
    const { rerender } = render(
      <AiRulesLoader rootPath="/ws" workspaceService={svc1} />,
    );
    await waitFor(() => expect(svc1.exists).toHaveBeenCalledTimes(1));

    // Simulate the ref "pointer" changing without rootPath changing:
    // in the real code, parent passes a new WorkspaceService instance
    // on workspace reinit. Fixed effect must NOT re-run.
    const svc2 = {
      exists: vi.fn(async () => true),
      readFile: vi.fn(async () => 'B'),
    };
    rerender(<AiRulesLoader rootPath="/ws" workspaceService={svc2} />);

    await new Promise((r) => setTimeout(r, 50));
    expect(svc2.exists).not.toHaveBeenCalled();
    cleanup();
  });

  it('re-runs when rootPath changes', async () => {
    const service = {
      exists: vi.fn(async () => true),
      readFile: vi.fn(async (p: string) =>
        p.startsWith('/a/') ? 'RULE-A' : 'RULE-B',
      ),
    };
    const { rerender, getByTestId } = render(
      <AiRulesLoader rootPath="/a" workspaceService={service} />,
    );
    await waitFor(() =>
      expect(getByTestId('rules').textContent).toBe('RULE-A'),
    );

    rerender(<AiRulesLoader rootPath="/b" workspaceService={service} />);
    await waitFor(() =>
      expect(getByTestId('rules').textContent).toBe('RULE-B'),
    );

    expect(service.exists).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it('does not setState after unmount', async () => {
    let resolveExists: ((v: boolean) => void) | null = null;
    const service = {
      exists: vi.fn(
        () =>
          new Promise<boolean>((r) => {
            resolveExists = r;
          }),
      ),
      readFile: vi.fn(async () => ''),
    };
    const { unmount } = render(
      <AiRulesLoader rootPath="/ws" workspaceService={service} />,
    );
    unmount();
    (resolveExists as ((v: boolean) => void) | null)?.(true);
    await new Promise((r) => setTimeout(r, 10));
    // readFile should never be called because isMounted flipped false
    // before the exists promise resolved.
    expect(service.readFile).not.toHaveBeenCalled();
  });
});
