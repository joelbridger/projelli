/**
 * MattersSidebarPanel — inline sidebar content for the Matters tab (F-122).
 *
 * Shows the list of local matters (name, client, privileged badge) and a
 * button to open the full MatterManagerDialog. A user who has never opened
 * an AI chat can find and manage matters from this entry point.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMatters } from '@/stores/matterStore';
import { MatterManagerDialog } from './MatterManagerDialog';

export function MattersSidebarPanel() {
  const { t } = useTranslation();
  const matters = useMatters();
  const [managerOpen, setManagerOpen] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden" data-testid="matters-sidebar-panel">
      {/* Section header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b">
        <span className="text-xs font-semibold text-foreground">
          {t('layout.sidebar.tabs.matters')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => setManagerOpen(true)}
          title={t('matter.sidebar.open-manager')}
          data-testid="matters-sidebar-open-manager"
          aria-label={t('matter.sidebar.open-manager')}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Matter list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {matters.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">{t('matter.sidebar.empty')}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 text-xs gap-1.5"
              onClick={() => setManagerOpen(true)}
              data-testid="matters-sidebar-create-first"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('matter.sidebar.create-first')}
            </Button>
          </div>
        ) : (
          <>
            {matters.map((m) => (
              <button
                key={m.id}
                type="button"
                className="w-full text-left rounded-md px-2 py-1.5 text-xs hover:bg-accent transition-colors"
                data-testid={`matters-sidebar-matter-${m.id}`}
                onClick={() => setManagerOpen(true)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {m.privileged && (
                    <ShieldAlert className="h-3 w-3 shrink-0 text-rose-600" aria-label={t('matter.manager.privileged-label')} />
                  )}
                  <span className="font-medium truncate">{m.name || m.client}</span>
                </div>
                {m.client && m.name !== m.client && (
                  <span className="block text-muted-foreground truncate mt-0.5">{m.client}</span>
                )}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-1.5 text-xs text-muted-foreground mt-1"
              onClick={() => setManagerOpen(true)}
              data-testid="matters-sidebar-manage-all"
            >
              <Briefcase className="h-3.5 w-3.5" />
              {t('matter.sidebar.manage-all')}
            </Button>
          </>
        )}
      </div>

      {/* The full dialog, mounted here so it's always reachable */}
      <MatterManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
    </div>
  );
}

export default MattersSidebarPanel;
