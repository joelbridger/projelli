/**
 * AI Chat file management hook
 * Handles chat file state, CRUD operations, and file persistence
 */

import { useState, useCallback } from 'react';
import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';
import type { AIChatFile } from '@/types/ai';

interface UseAIChatFilesOptions {
  rootPath: string | null;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  handleFileOpen: (path: string, name: string) => Promise<void>;
  handleDelete: (path: string) => Promise<void>;
}

interface UseAIChatFilesReturn {
  chatFiles: AIChatFile[];
  setChatFiles: React.Dispatch<React.SetStateAction<AIChatFile[]>>;
  loadChatFiles: () => Promise<AIChatFile[]>;
  saveChatFile: (chatData: AIChatFile) => Promise<void>;
  handleCreateNewChat: (provider: 'anthropic' | 'openai' | 'google') => Promise<void>;
  handleOpenChat: (chatFile: AIChatFile) => Promise<void>;
  handleDeleteChat: (chatId: string) => Promise<void>;
}

export function useAIChatFiles({
  rootPath,
  workspaceServiceRef,
  handleFileOpen,
  handleDelete,
}: UseAIChatFilesOptions): UseAIChatFilesReturn {
  const [chatFiles, setChatFiles] = useState<AIChatFile[]>([]);

  // Load chat files from workspace
  const loadChatFiles = useCallback(async (): Promise<AIChatFile[]> => {
    if (!workspaceServiceRef.current || !rootPath) return [];

    try {
      const aiChatsPath = `${rootPath}/AI Chats`;
      const exists = await workspaceServiceRef.current.exists(aiChatsPath);
      if (!exists) return [];

      const entries = await workspaceServiceRef.current.list(aiChatsPath);
      const chatFiles: AIChatFile[] = [];

      for (const entry of entries) {
        // Handle date-based folder structure (check if entry is a folder)
        if (entry.type === 'folder') {
          try {
            const dateFolderEntries = await workspaceServiceRef.current.list(entry.path);
            for (const chatEntry of dateFolderEntries) {
              if (chatEntry.type === 'file' && chatEntry.name.endsWith('.aichat')) {
                try {
                  const content = await workspaceServiceRef.current.readFile(chatEntry.path);
                  const chatData = JSON.parse(content) as AIChatFile;
                  // Store the full path for later use
                  (chatData as any)._storedPath = chatEntry.path;
                  chatFiles.push(chatData);
                } catch (error) {
                  console.error(`Failed to load chat file ${chatEntry.name}:`, error);
                }
              }
            }
          } catch (error) {
            console.error(`Failed to load date folder ${entry.name}:`, error);
          }
        }
        // Also support legacy flat structure (backward compatibility)
        else if (entry.type === 'file' && entry.name.endsWith('.aichat')) {
          try {
            const content = await workspaceServiceRef.current.readFile(entry.path);
            const chatData = JSON.parse(content) as AIChatFile;
            // Store the full path for later use
            (chatData as any)._storedPath = entry.path;
            chatFiles.push(chatData);
          } catch (error) {
            console.error(`Failed to load chat file ${entry.name}:`, error);
          }
        }
      }

      // Sort by updated date (newest first)
      chatFiles.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
      return chatFiles;
    } catch (error) {
      console.error('Failed to load chat files:', error);
      return [];
    }
  }, [rootPath, workspaceServiceRef]);

  // Save chat file to workspace
  const saveChatFile = useCallback(
    async (chatData: AIChatFile) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      try {
        // Create date-based folder structure: AI Chats/YYYY-MM-DD/
        const dateStr = new Date().toISOString().split('T')[0]; // e.g., "2026-01-26"
        const dateFolderPath = `${rootPath}/AI Chats/${dateStr}`;

        // Ensure date folder exists
        try {
          await workspaceServiceRef.current.mkdir(dateFolderPath);
        } catch (error) {
          // Folder may already exist, ignore error
        }

        const filename = `${chatData.title}.aichat`;
        const filePath = `${dateFolderPath}/${filename}`;
        await workspaceServiceRef.current.writeFile(filePath, JSON.stringify(chatData, null, 2));

        // Reload chat files
        const files = await loadChatFiles();
        setChatFiles(files);
      } catch (error) {
        console.error('Failed to save chat file:', error);
      }
    },
    [rootPath, workspaceServiceRef, loadChatFiles]
  );

  // Get provider display name
  const getProviderDisplayName = (provider: 'anthropic' | 'openai' | 'google'): string => {
    switch (provider) {
      case 'anthropic': return 'Claude';
      case 'openai': return 'ChatGPT';
      case 'google': return 'Gemini';
      default: return 'AI';
    }
  };

  // Handle creating new chat
  const handleCreateNewChat = useCallback(
    async (provider: 'anthropic' | 'openai' | 'google') => {
      if (!rootPath) return;

      const now = new Date();
      const timestamp = now.toISOString();
      const chatId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // Generate sequential title like "Claude Chat 1", "ChatGPT Chat 2"
      const providerName = getProviderDisplayName(provider);
      const existingChats = chatFiles.filter(c => c.title.startsWith(`${providerName} Chat`));
      const nextNumber = existingChats.length + 1;
      const title = `${providerName} Chat ${nextNumber}`;

      const newChat: AIChatFile = {
        id: chatId,
        title,
        created: timestamp,
        updated: timestamp,
        messages: [],
        provider, // Store provider for future reference
      };

      await saveChatFile(newChat);

      // Open the chat file in the main panel (in date folder)
      const dateStr = now.toISOString().split('T')[0];
      const filename = `${title}.aichat`;
      const filePath = `${rootPath}/AI Chats/${dateStr}/${filename}`;
      await handleFileOpen(filePath, filename);
    },
    [rootPath, saveChatFile, handleFileOpen, chatFiles]
  );

  // Handle opening chat
  const handleOpenChat = useCallback(
    async (chatFile: AIChatFile) => {
      if (!rootPath) return;

      // Use stored path if available (from loadChatFiles)
      const storedPath = (chatFile as any)._storedPath;
      if (storedPath) {
        const filename = storedPath.split('/').pop() || `${chatFile.title}.aichat`;
        await handleFileOpen(storedPath, filename);
        return;
      }

      // Fallback: try to find the file in date-based structure
      // Extract date from chat's created timestamp
      const filename = `${chatFile.title}.aichat`;
      const dateStr = new Date(chatFile.created).toISOString().split('T')[0];
      const dateBasedPath = `${rootPath}/AI Chats/${dateStr}/${filename}`;
      const legacyPath = `${rootPath}/AI Chats/${filename}`;

      // Try date-based path first, then legacy path
      try {
        if (workspaceServiceRef.current) {
          const datePathExists = await workspaceServiceRef.current.exists(dateBasedPath);
          if (datePathExists) {
            await handleFileOpen(dateBasedPath, filename);
            return;
          }
        }
        await handleFileOpen(legacyPath, filename);
      } catch (error) {
        console.error('Failed to open chat file:', error);
      }
    },
    [rootPath, workspaceServiceRef, handleFileOpen]
  );

  // Handle deleting chat
  const handleDeleteChat = useCallback(
    async (chatId: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      const chatToDelete = chatFiles.find(c => c.id === chatId);
      if (!chatToDelete) return;

      // Use stored path if available (from loadChatFiles)
      const storedPath = (chatToDelete as any)._storedPath;
      if (storedPath) {
        try {
          await handleDelete(storedPath);
          // Reload chat files
          const files = await loadChatFiles();
          setChatFiles(files);
          return;
        } catch (error) {
          console.error('Failed to delete chat:', error);
          return;
        }
      }

      // Fallback: try to find the file in date-based structure
      const filename = `${chatToDelete.title}.aichat`;
      const dateStr = new Date(chatToDelete.created).toISOString().split('T')[0];
      const dateBasedPath = `${rootPath}/AI Chats/${dateStr}/${filename}`;
      const legacyPath = `${rootPath}/AI Chats/${filename}`;

      try {
        // Try date-based path first
        const datePathExists = await workspaceServiceRef.current.exists(dateBasedPath);
        if (datePathExists) {
          await handleDelete(dateBasedPath);
        } else {
          // Try legacy path
          await handleDelete(legacyPath);
        }

        // Reload chat files
        const files = await loadChatFiles();
        setChatFiles(files);
      } catch (error) {
        console.error('Failed to delete chat:', error);
      }
    },
    [rootPath, workspaceServiceRef, chatFiles, handleDelete, loadChatFiles]
  );

  return {
    chatFiles,
    setChatFiles,
    loadChatFiles,
    saveChatFile,
    handleCreateNewChat,
    handleOpenChat,
    handleDeleteChat,
  };
}
