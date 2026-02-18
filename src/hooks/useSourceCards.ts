/**
 * Source card management hook
 * Handles source card state, CRUD operations, and file persistence
 */

import { useState, useCallback } from 'react';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { SourceCard } from '@/types/research';

interface UseSourceCardsOptions {
  rootPath: string | null;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  handleFileOpen: (path: string, name: string) => Promise<void>;
}

interface UseSourceCardsReturn {
  sourceCards: SourceCard[];
  setSourceCards: React.Dispatch<React.SetStateAction<SourceCard[]>>;
  saveSourceCards: (cards: SourceCard[]) => Promise<void>;
  loadSourceCards: () => Promise<SourceCard[]>;
  handleOpenSourceFile: (cardId: string, title: string) => Promise<void>;
  handleCreateSourceCard: (cardData: Omit<SourceCard, 'id'>) => Promise<void>;
  handleUpdateSourceCard: (id: string, updates: Partial<SourceCard>) => Promise<void>;
  handleDeleteSourceCard: (id: string) => Promise<void>;
}

export function useSourceCards({
  rootPath,
  workspaceServiceRef,
  handleFileOpen,
}: UseSourceCardsOptions): UseSourceCardsReturn {
  const [sourceCards, setSourceCards] = useState<SourceCard[]>([]);

  // Save sources to file
  const saveSourceCards = useCallback(async (cards: SourceCard[]) => {
    if (!workspaceServiceRef.current || !rootPath) {
      console.warn('Cannot save sources: workspace not initialized', {
        hasWorkspaceService: !!workspaceServiceRef.current,
        hasRootPath: !!rootPath
      });
      return;
    }
    try {
      console.log('Saving sources:', { count: cards.length, rootPath });
      const researchPath = `${rootPath}/Research`;

      // Ensure Research folder exists
      const folderExists = await workspaceServiceRef.current.exists(researchPath);
      if (!folderExists) {
        await workspaceServiceRef.current.mkdir(researchPath);
      }

      // Save each card as individual .source file (named exactly as title)
      for (const card of cards) {
        // Use the title exactly as entered, just add .source extension
        const filename = `${card.title}.source`;
        const filePath = `${researchPath}/${filename}`;
        const content = JSON.stringify(card, null, 2);
        await workspaceServiceRef.current.writeFile(filePath, content);
      }

      console.log('sources saved successfully as individual files');
    } catch (error) {
      console.error('Failed to save sources:', error);
    }
  }, [rootPath, workspaceServiceRef]);

  // Load sources from individual files
  const loadSourceCards = useCallback(async (): Promise<SourceCard[]> => {
    if (!workspaceServiceRef.current || !rootPath) {
      console.warn('Cannot load sources: workspace not initialized');
      return [];
    }
    try {
      const researchPath = `${rootPath}/Research`;
      console.log('Loading sources from:', researchPath);

      const exists = await workspaceServiceRef.current.exists(researchPath);
      if (!exists) {
        console.log('Research folder does not exist yet');
        return [];
      }

      // Read all .source files from Research folder
      const fileTree = await workspaceServiceRef.current.getFileTree();
      const researchNode = fileTree.find(node => node.name === 'Research' && node.type === 'folder');

      if (!researchNode || !researchNode.children) {
        console.log('No source files found in Research folder');
        return [];
      }

      const cards: SourceCard[] = [];
      for (const file of researchNode.children) {
        if (file.name.endsWith('.source') && file.type === 'file') {
          try {
            const content = await workspaceServiceRef.current.readFile(file.path);
            const card = JSON.parse(content) as SourceCard;
            cards.push(card);
          } catch (error) {
            console.error(`Failed to load source from ${file.path}:`, error);
          }
        }
      }

      console.log('Loaded sources:', { count: cards.length });
      return cards;
    } catch (error) {
      console.error('Failed to load sources:', error);
      return [];
    }
  }, [rootPath, workspaceServiceRef]);

  // Handle opening source file
  const handleOpenSourceFile = useCallback(
    async (_cardId: string, title: string) => {
      if (!rootPath) return;
      const filename = `${title}.source`;
      const filePath = `${rootPath}/Research/${filename}`;
      await handleFileOpen(filePath, filename);
    },
    [rootPath, handleFileOpen]
  );

  // Handle creating source card
  const handleCreateSourceCard = useCallback(
    async (cardData: Omit<SourceCard, 'id'>) => {
      console.log('Creating source:', cardData);
      const newCard: SourceCard = {
        ...cardData,
        id: `src_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      };
      console.log('Generated card ID:', newCard.id);
      const newCards = [...sourceCards, newCard];
      console.log('New cards array:', { count: newCards.length });
      setSourceCards(newCards);
      await saveSourceCards(newCards);

      // Auto-open the new source as a tab
      await handleOpenSourceFile(newCard.id, newCard.title);
    },
    [sourceCards, saveSourceCards, handleOpenSourceFile]
  );

  // Handle updating source card
  const handleUpdateSourceCard = useCallback(
    async (id: string, updates: Partial<SourceCard>) => {
      const newCards = sourceCards.map((card) =>
        card.id === id ? { ...card, ...updates } : card
      );
      setSourceCards(newCards);
      await saveSourceCards(newCards);
    },
    [sourceCards, saveSourceCards]
  );

  // Handle deleting source card
  const handleDeleteSourceCard = useCallback(
    async (id: string) => {
      const newCards = sourceCards.filter((card) => card.id !== id);
      setSourceCards(newCards);
      await saveSourceCards(newCards);
    },
    [sourceCards, saveSourceCards]
  );

  return {
    sourceCards,
    setSourceCards,
    saveSourceCards,
    loadSourceCards,
    handleOpenSourceFile,
    handleCreateSourceCard,
    handleUpdateSourceCard,
    handleDeleteSourceCard,
  };
}
