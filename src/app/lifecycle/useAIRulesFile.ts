/**
 * useAIRulesFile — owns the handleOpenAIRules handler.
 *
 * Extracted from App.tsx (Wave 5b decomposition). The handler body is copied
 * VERBATIM from App.tsx; only the source of referenced values changed (they
 * now come from the options object instead of App's local scope).
 */
import { useCallback } from 'react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { workspacePath } from '@/platform/fs/appPath';

export interface UseAIRulesFileOptions {
  rootPath: string | null;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  handleFileOpen: (path: string, name: string) => Promise<void>;
  refreshFileTree: () => void;
}

export function useAIRulesFile({
  rootPath,
  workspaceServiceRef,
  handleFileOpen,
  refreshFileTree,
}: UseAIRulesFileOptions) {
  const handleOpenAIRules = useCallback(async () => {
    if (!rootPath || !workspaceServiceRef.current) return;

    const rulesPath = workspacePath(rootPath, 'ai-rules.md');

    try {
      // Check if file exists
      const exists = await workspaceServiceRef.current.exists(rulesPath);

      if (!exists) {
        // Create default AI rules file
        const defaultContent = `# AI Rules

This file contains rules and guidelines for AI assistants in this workspace.

## General Guidelines
- Be helpful, accurate, and concise
- Follow user instructions carefully
- Ask for clarification when needed

## Specific Rules
- Add your custom rules here
- AI will read and follow these rules in all chats
`;
        await workspaceServiceRef.current.writeFile(rulesPath, defaultContent);
        refreshFileTree();
      }

      // Open the file
      await handleFileOpen(rulesPath, 'ai-rules.md');
    } catch (error) {
      console.error('Failed to open AI rules file:', error);
    }
  }, [rootPath, handleFileOpen, refreshFileTree]);

  return { handleOpenAIRules };
}
