import {
  createContext,
  useContext,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from 'react';
import type { TrashRetentionPeriod } from '@/features/documents/TrashPanel';
import type { TrashedItem, TrashStats } from '@/platform/history/TrashService';
import type { SettingCategory } from '@/platform/settings/schema';
import type { useEditorStore } from '@/platform/state/editorStore';
import type { MattersSurfaceMode } from '@/platform/state/appNavigationStore';
import type { APIKey } from '@/platform/types';
import type { AuditEntry } from '@/platform/types/audit';
import type { AppSurface } from '@/platform/types/navigation';
import type { Matter } from '@/platform/types/matter';
import type { FileNode } from '@/platform/types/workspace';
import type {
  InterviewQuestion,
  RunRecord,
  WorkflowExecution,
  WorkflowTemplate,
} from '@/platform/types/workflow';
import type { AuditIntegrityVerdict } from '@/platform/utils/tauri-commands';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';

export interface AppSurfaceCapabilities {
  navigation: {
    setSurface: (surface: AppSurface) => void;
    setMattersSurfaceMode: (mode: MattersSurfaceMode) => void;
    pushSnapshot: () => void;
  };
  workspace: {
    rootPath: string | null | undefined;
    activeMatter: Matter | null;
    apiKeys: APIKey[];
    serviceRef: MutableRefObject<WorkspaceService | null>;
    setFileTree: (tree: FileNode[]) => void;
    refreshFileTree: () => void;
    requestApiKeySetup: () => void;
  };
  documents: {
    view: 'browser' | 'editor';
    setView: (view: 'browser' | 'editor') => void;
    open: (path: string, name: string) => Promise<boolean>;
    createFile: (parentPath: string) => void;
    createFolder: (parentPath: string) => void;
    rename: (path: string) => void;
    renameWithName: (path: string, newName: string) => Promise<void>;
    delete: (path: string) => void;
    move: (sourcePath: string, targetPath: string) => Promise<void>;
    download: (path: string, name: string) => void;
    createDefault: (parentPath?: string) => void;
    importFiles: (folderPath?: string | null) => Promise<void>;
    createDocxAtRoot: (parentPath?: string) => Promise<void>;
    createTextFileAtRoot: () => Promise<void>;
    createFolderAtRoot: () => Promise<void>;
    setLetterheadTemplate: (path: string) => void;
    trashItems: TrashedItem[];
    trashStats: TrashStats;
    trashRetentionPeriod: TrashRetentionPeriod;
    trashCustomRetentionDays: number;
    restoreFromTrash: (id: string) => Promise<void>;
    permanentlyDelete: (id: string) => Promise<void>;
    emptyTrash: () => Promise<void>;
    changeTrashRetention: (
      period: TrashRetentionPeriod,
      customDays?: number
    ) => void;
  };
  ask: {
    prefill: { question: string; autoSubmit?: boolean } | null;
    setPrefill: Dispatch<
      SetStateAction<{ question: string; autoSubmit?: boolean } | null>
    >;
  };
  workflows: {
    currentExecution: WorkflowExecution | null;
    activeTemplate: WorkflowTemplate | null;
    showInterviewDialog: boolean;
    interviewQuestions: InterviewQuestion[] | null;
    providerError:
      | 'needs-provider'
      | 'ollama-unreachable'
      | 'needs-client'
      | null;
    saveError: string | null;
    runHistory: RunRecord[];
    activeFilePath: string | null;
    openTabs: ReturnType<typeof useEditorStore.getState>['openTabs'];
    submitInterview: (answers: Record<string, string>) => void;
    cancelInterview: () => void;
    saveAsFile: (content: string, suggestedName: string) => Promise<void>;
    exportDocx: (content: string, suggestedName: string) => Promise<void>;
    exportPptx: (content: string, suggestedName: string) => Promise<void>;
    start: (template: WorkflowTemplate) => Promise<void>;
  };
  audit: {
    entries: AuditEntry[];
    integrity: AuditIntegrityVerdict | undefined;
    verifyIntegrity: () => Promise<AuditIntegrityVerdict | undefined>;
    repairSeal: () => Promise<void>;
    addEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  };
  settings: {
    open: (category?: SettingCategory) => void;
    action: (actionId: string) => void;
    restartOnboarding: () => void;
    pageFocus?: { category?: SettingCategory; key: number };
    /** Live Settings inputs supplied by the shell, not loaded by a feature frame. */
    loadTemplates: () => WorkflowTemplate[];
    extraSections: Array<{
      id: string;
      label: string;
      testid: string;
      content: ReactNode;
    }>;
  };
}

export interface AppSurfaceRuntime extends AppSurfaceCapabilities {
  legacy: {
    home: () => ReactNode;
    clients: () => ReactNode;
    ask: () => ReactNode;
    email: () => ReactNode;
    documents: () => ReactNode;
    workflows: () => ReactNode;
    audit: () => ReactNode;
    privacy: () => ReactNode;
    scheduling: () => ReactNode;
    settings: () => ReactNode;
    mainPanel: () => ReactNode;
  };
}

export const AppSurfaceRuntimeContext = createContext<AppSurfaceCapabilities | null>(
  null
);

export function useOptionalAppSurfaceCapabilities(): AppSurfaceCapabilities | null {
  return useContext(AppSurfaceRuntimeContext);
}

/**
 * Compatibility shape for direct router tests and older shell embedders.
 * Production App.tsx uses AppSurfaceRuntimeProvider and no longer passes this
 * flat bundle through the router.
 */
export interface LegacyAppSurfaceRouterProps {
  sidebarActiveTab: AppSurface;
  askPrefill: { question: string; autoSubmit?: boolean } | null;
  setAskPrefill: Dispatch<
    SetStateAction<{ question: string; autoSubmit?: boolean } | null>
  >;
  documentsView: 'browser' | 'editor';
  setDocumentsView: (view: 'browser' | 'editor') => void;
  setSidebarActiveTab: (tab: AppSurface) => void;
  mattersSurfaceMode: MattersSurfaceMode;
  setMattersSurfaceMode: (mode: MattersSurfaceMode) => void;
  pushNavigationSnapshot: () => void;
  currentExecution: WorkflowExecution | null;
  activeWorkflowTemplate: WorkflowTemplate | null;
  showInterviewDialog: boolean;
  interviewQuestions: InterviewQuestion[] | null;
  workflowProviderError:
    | 'needs-provider'
    | 'ollama-unreachable'
    | 'needs-client'
    | null;
  workflowSaveError: string | null;
  runHistory: RunRecord[];
  auditEntries: AuditEntry[];
  auditIntegrity: AuditIntegrityVerdict | undefined;
  verifyAuditIntegrity: () => Promise<AuditIntegrityVerdict | undefined>;
  repairAuditSeal: () => Promise<void>;
  apiKeys: APIKey[];
  rootPath: string | null | undefined;
  fileTree: FileNode[];
  trashItems: TrashedItem[];
  trashStats: TrashStats;
  trashRetentionPeriod: TrashRetentionPeriod;
  trashCustomRetentionDays: number;
  activeWorkflowFilePath: string | null;
  openTabs: ReturnType<typeof useEditorStore.getState>['openTabs'];
  workspaceServiceRef: MutableRefObject<WorkspaceService | null>;
  setFileTree: (tree: FileNode[]) => void;
  openSettings: (category?: SettingCategory) => void;
  handleFileOpen: (path: string, name: string) => Promise<boolean>;
  handleCreateFile: (parentPath: string) => void;
  handleCreateFolder: (parentPath: string) => void;
  handleRename: (path: string) => void;
  handleRenameWithName: (path: string, newName: string) => Promise<void>;
  handleDelete: (path: string) => void;
  handleMove: (sourcePath: string, targetPath: string) => Promise<void>;
  handleDownload: (path: string, name: string) => void;
  handleCreateDefaultDocument: (parentPath?: string) => void;
  handleImportFiles: (folderPath?: string | null) => Promise<void>;
  handleCreateDocxAtRoot: (parentPath?: string) => Promise<void>;
  handleCreateTextFileAtRoot: () => Promise<void>;
  handleCreateFolderAtRoot: () => Promise<void>;
  handleSetLetterheadTemplate: (path: string) => void;
  handleRestoreFromTrash: (id: string) => Promise<void>;
  handlePermanentDelete: (id: string) => Promise<void>;
  handleEmptyTrash: () => Promise<void>;
  handleTrashRetentionChange: (
    period: TrashRetentionPeriod,
    customDays?: number
  ) => void;
  refreshFileTree: () => void;
  addAuditEntry: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  handleRequestApiKeySetup: () => void;
  handleInterviewSubmit: (answers: Record<string, string>) => void;
  handleInterviewCancel: () => void;
  handleWorkflowSaveAsFile: (
    content: string,
    suggestedName: string
  ) => Promise<void>;
  handleWorkflowExportDocx: (
    content: string,
    suggestedName: string
  ) => Promise<void>;
  handleWorkflowExportPptx: (
    content: string,
    suggestedName: string
  ) => Promise<void>;
  handleStartWorkflow: (template: WorkflowTemplate) => Promise<void>;
  handleSettingsAction: (actionId: string) => void;
  handleSettingsRestartOnboarding: () => void;
  activeMatter: Matter | null;
  settingsPageFocus?: { category?: SettingCategory; key: number };
}

export function legacyRouterPropsToCapabilities(
  props: LegacyAppSurfaceRouterProps
): AppSurfaceCapabilities {
  return {
    navigation: {
      setSurface: props.setSidebarActiveTab,
      setMattersSurfaceMode: props.setMattersSurfaceMode,
      pushSnapshot: props.pushNavigationSnapshot,
    },
    workspace: {
      rootPath: props.rootPath,
      activeMatter: props.activeMatter,
      apiKeys: props.apiKeys,
      serviceRef: props.workspaceServiceRef,
      setFileTree: props.setFileTree,
      refreshFileTree: props.refreshFileTree,
      requestApiKeySetup: props.handleRequestApiKeySetup,
    },
    documents: {
      view: props.documentsView,
      setView: props.setDocumentsView,
      open: props.handleFileOpen,
      createFile: props.handleCreateFile,
      createFolder: props.handleCreateFolder,
      rename: props.handleRename,
      renameWithName: props.handleRenameWithName,
      delete: props.handleDelete,
      move: props.handleMove,
      download: props.handleDownload,
      createDefault: props.handleCreateDefaultDocument,
      importFiles: props.handleImportFiles,
      createDocxAtRoot: props.handleCreateDocxAtRoot,
      createTextFileAtRoot: props.handleCreateTextFileAtRoot,
      createFolderAtRoot: props.handleCreateFolderAtRoot,
      setLetterheadTemplate: props.handleSetLetterheadTemplate,
      trashItems: props.trashItems,
      trashStats: props.trashStats,
      trashRetentionPeriod: props.trashRetentionPeriod,
      trashCustomRetentionDays: props.trashCustomRetentionDays,
      restoreFromTrash: props.handleRestoreFromTrash,
      permanentlyDelete: props.handlePermanentDelete,
      emptyTrash: props.handleEmptyTrash,
      changeTrashRetention: props.handleTrashRetentionChange,
    },
    ask: {
      prefill: props.askPrefill,
      setPrefill: props.setAskPrefill,
    },
    workflows: {
      currentExecution: props.currentExecution,
      activeTemplate: props.activeWorkflowTemplate,
      showInterviewDialog: props.showInterviewDialog,
      interviewQuestions: props.interviewQuestions,
      providerError: props.workflowProviderError,
      saveError: props.workflowSaveError,
      runHistory: props.runHistory,
      activeFilePath: props.activeWorkflowFilePath,
      openTabs: props.openTabs,
      submitInterview: props.handleInterviewSubmit,
      cancelInterview: props.handleInterviewCancel,
      saveAsFile: props.handleWorkflowSaveAsFile,
      exportDocx: props.handleWorkflowExportDocx,
      exportPptx: props.handleWorkflowExportPptx,
      start: props.handleStartWorkflow,
    },
    audit: {
      entries: props.auditEntries,
      integrity: props.auditIntegrity,
      verifyIntegrity: props.verifyAuditIntegrity,
      repairSeal: props.repairAuditSeal,
      addEntry: props.addAuditEntry,
    },
    settings: {
      open: props.openSettings,
      action: props.handleSettingsAction,
      restartOnboarding: props.handleSettingsRestartOnboarding,
      loadTemplates: () => [],
      extraSections: [],
      ...(props.settingsPageFocus
        ? { pageFocus: props.settingsPageFocus }
        : {}),
    },
  };
}
