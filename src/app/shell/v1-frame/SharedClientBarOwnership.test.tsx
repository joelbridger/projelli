import { render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { AppSurfaceRouter } from '@/app/shell/AppSurfaceRouter';
import type { AppSurfaceDescriptor } from '@/app/shell/registry/types';
import type { AppSurfaceCapabilities } from '@/app/shell/runtime/AppSurfaceRuntime';
import { AppSurfaceRuntimeProvider } from '@/app/shell/runtime/AppSurfaceRuntimeProvider';
import { V1ShellFrameFlagGate } from './V1ShellFrame';

const flagsRead = vi.hoisted(() => [] as string[]);
const sharedDescriptor: AppSurfaceDescriptor = {
  id: 'matters',
  labelKey: 'common.nav.clients',
  icon: Users,
  placement: 'primary',
  order: 10,
  clientContext: 'shared',
  errorLabel: 'Clients',
  render: () => <div data-testid="shared-surface-content" />,
};

vi.mock('@/platform/flags', () => ({
  useFlag: (id: string) => {
    flagsRead.push(id);
    return id === 'shared-client-bar' || id === 'v1-shell-frame';
  },
}));

vi.mock('@/app/shell/runtime/useAppSurfaceRegistry', () => ({
  useAppSurfaceRegistry: () => ({
    descriptors: [sharedDescriptor],
    ready: true,
    error: null,
  }),
}));

vi.mock('@/app/lifecycle/useIntakeInboxSync', () => ({
  useIntakeInboxSync: vi.fn(),
}));
vi.mock('@/platform/intake/useEmailReplyIngestion', () => ({
  useEmailReplyIngestion: vi.fn(),
}));
vi.mock('@/platform/intake/useDocumentExtractionIngestion', () => ({
  useDocumentExtractionIngestion: vi.fn(),
}));

const nothing = () => {};
const nothingAsync = () => Promise.resolve();

function createCapabilities(): AppSurfaceCapabilities {
  return {
    navigation: {
      setSurface: nothing,
      setMattersSurfaceMode: nothing,
      pushSnapshot: nothing,
    },
    workspace: {
      rootPath: '/workspace',
      activeMatter: null,
      apiKeys: [],
      serviceRef: { current: null },
      setFileTree: nothing,
      refreshFileTree: nothing,
      requestApiKeySetup: nothing,
    },
    documents: {
      view: 'browser',
      setView: nothing,
      open: () => Promise.resolve(false),
      createFile: nothing,
      createFolder: nothing,
      rename: nothing,
      renameWithName: nothingAsync,
      delete: nothing,
      move: nothingAsync,
      download: nothing,
      createDefault: nothing,
      importFiles: nothingAsync,
      createDocxAtRoot: nothingAsync,
      createTextFileAtRoot: nothingAsync,
      createFolderAtRoot: nothingAsync,
      setLetterheadTemplate: nothing,
      trashItems: [],
      trashStats: { itemCount: 0, totalSize: 0, oldestItem: undefined },
      trashRetentionPeriod: 30,
      trashCustomRetentionDays: 30,
      restoreFromTrash: nothingAsync,
      permanentlyDelete: nothingAsync,
      emptyTrash: nothingAsync,
      changeTrashRetention: nothing,
    },
    ask: { prefill: null, setPrefill: nothing },
    workflows: {
      currentExecution: null,
      activeTemplate: null,
      showInterviewDialog: false,
      interviewQuestions: null,
      providerError: null,
      saveError: null,
      runHistory: [],
      activeFilePath: null,
      openTabs: [],
      submitInterview: nothing,
      cancelInterview: nothing,
      saveAsFile: nothingAsync,
      exportDocx: nothingAsync,
      exportPptx: nothingAsync,
      start: nothingAsync,
    },
    audit: {
      entries: [],
      integrity: undefined,
      verifyIntegrity: () => Promise.resolve(undefined),
      repairSeal: nothingAsync,
      addEntry: nothing,
    },
    settings: {
      open: nothing,
      action: nothing,
      restartOnboarding: nothing,
    },
  };
}

describe('v1 shared-client-bar ownership', () => {
  it('renders exactly one bar when both shell flags are on', () => {
    flagsRead.length = 0;
    render(
      <V1ShellFrameFlagGate
        activeSurface="matters"
        legacy={<div data-testid="legacy-shell" />}
        onOpenCommandPalette={nothing}
        onSurfaceChange={nothing}
      >
        <AppSurfaceRuntimeProvider value={createCapabilities()}>
          <AppSurfaceRouter sidebarActiveTab="matters" />
        </AppSurfaceRuntimeProvider>
      </V1ShellFrameFlagGate>
    );

    expect(screen.getAllByTestId('shared-client-bar')).toHaveLength(1);
    expect(screen.getByTestId('shared-surface-content')).toBeInTheDocument();
    expect(flagsRead).toContain('shared-client-bar');
    expect(flagsRead).toContain('v1-shell-frame');
  });
});
