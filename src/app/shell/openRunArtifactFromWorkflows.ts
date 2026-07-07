import type { AppSurface } from '@/app/lifecycle/useGlobalEventBus';

export async function openRunArtifactFromWorkflows({
  path,
  name,
  handleFileOpen,
  setSidebarActiveTab,
}: {
  path: string;
  name: string;
  handleFileOpen: (path: string, name: string) => Promise<boolean>;
  setSidebarActiveTab: (tab: AppSurface) => void;
}): Promise<boolean> {
  const opened = await handleFileOpen(path, name);
  if (opened) {
    setSidebarActiveTab('files');
  }
  return opened;
}
