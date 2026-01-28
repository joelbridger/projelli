// Status Bar Component
// Shows workspace info and status indicators

import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { FolderOpen, File, Edit } from 'lucide-react';

export function StatusBar() {
  const { rootPath } = useWorkspaceStore();
  const { openTabs, activeTabPath } = useEditorStore();
  const activeTab = openTabs.find((t) => t.path === activeTabPath);

  return (
    <div className="flex items-center h-6 px-2 border-t bg-card text-xs text-muted-foreground">
      {/* Workspace info */}
      <div className="flex items-center gap-1">
        <FolderOpen className="h-3 w-3" />
        <span className="truncate max-w-[200px]">{rootPath ?? 'No workspace'}</span>
      </div>

      <div className="flex-1" />

      {/* Active file info */}
      {activeTab && (
        <>
          <div className="flex items-center gap-1 mr-4">
            <File className="h-3 w-3" />
            <span className="truncate max-w-[200px]">{activeTab.name}</span>
          </div>

          {activeTab.isDirty && (
            <div className="flex items-center gap-1 text-amber-500">
              <Edit className="h-3 w-3" />
              <span>Modified</span>
            </div>
          )}
        </>
      )}

      {/* Tab count */}
      <div className="ml-4">
        {openTabs.length} file{openTabs.length !== 1 ? 's' : ''} open
      </div>
    </div>
  );
}

export default StatusBar;
