// useAIRules — load the workspace's optional ai-rules.md on mount and expose
// its contents. Extracted VERBATIM from AIChatViewer so the viewer is a thinner
// shell; the load logic + the deps-discipline guard are unchanged.

import { useEffect, useState } from 'react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

export function useAIRules(
  rootPath: string | undefined,
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null> | undefined,
): string {
  const [aiRules, setAiRules] = useState<string>('');

  // Load AI Rules from workspace.
  //
  // DEPS DISCIPLINE: `workspaceServiceRef` must NOT be in this array.
  // Refs are stable by object identity but their `.current` mutates
  // without signaling React; including a ref in deps trips effect
  // re-runs on ref-pointer changes that look like deps changes to the
  // tracker, producing a setState -> render -> setState loop (React
  // #185). See tests/unit/ai-rules-loading.test.tsx for the regression
  // guard.
  useEffect(() => {
    let isMounted = true;

    const loadAIRules = async () => {
      if (!rootPath || !workspaceServiceRef?.current) return;

      try {
        const rulesPath = `${rootPath}/ai-rules.md`;
        const exists = await workspaceServiceRef.current.exists(rulesPath);

        if (!isMounted) return;
        if (exists) {
          const content = await workspaceServiceRef.current.readFile(rulesPath);
          if (isMounted) setAiRules(content);
        } else {
          setAiRules('');
        }
      } catch (error) {
        console.error('Failed to load AI rules:', error);
        if (isMounted) setAiRules('');
      }
    };

    loadAIRules();

    return () => {
      isMounted = false;
    };
  }, [rootPath]);

  return aiRules;
}
