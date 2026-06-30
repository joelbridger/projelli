/**
 * useAudioRecording — owns the handleSaveAudioRecording handler.
 *
 * Extracted from App.tsx (Wave 5b decomposition). The handler body is copied
 * VERBATIM from App.tsx; only the source of referenced values changed (they
 * now come from the options object instead of App's local scope).
 */
import { useCallback } from 'react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { FileNode } from '@/platform/types/workspace';

export interface UseAudioRecordingOptions {
  rootPath: string | null;
  workspaceServiceRef: React.MutableRefObject<WorkspaceService | null>;
  setFileTree: (tree: FileNode[]) => void;
  handleFileOpen: (path: string, name: string) => Promise<void>;
}

export function useAudioRecording({
  rootPath,
  workspaceServiceRef,
  setFileTree,
  handleFileOpen,
}: UseAudioRecordingOptions) {
  const handleSaveAudioRecording = useCallback(
    async (audioBlob: Blob, filename: string) => {
      if (!workspaceServiceRef.current || !rootPath) return;

      // Ensure Audio Recordings folder exists
      const audioPath = `${rootPath}/Audio Recordings`;
      const audioExists = await workspaceServiceRef.current.exists(audioPath);
      if (!audioExists) {
        await workspaceServiceRef.current.mkdir(audioPath);
      }

      const filePath = `${audioPath}/${filename}`;
      try {
        // Convert blob to array buffer
        const arrayBuffer = await audioBlob.arrayBuffer();
        await workspaceServiceRef.current.writeFileBinary(filePath, arrayBuffer);
        const fileTree = await workspaceServiceRef.current.getFileTree();
        setFileTree(fileTree);

        // Open the audio file
        await handleFileOpen(filePath, filename);
      } catch (error) {
        console.error('Failed to save audio recording:', error);
      }
    },
    [rootPath, setFileTree, handleFileOpen]
  );

  return { handleSaveAudioRecording };
}
