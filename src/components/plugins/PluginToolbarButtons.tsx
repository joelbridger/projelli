// Plugin runner — toolbar buttons contributed by installed plugins.
//
// Subscribes to `pluginRegistryStore.toolbar` and renders one button per
// contribution. Click invokes `manager.invokeCommand(pluginId, command)`.
// Renders nothing when there are no plugin buttons so the surrounding
// toolbar layout stays unchanged for users without plugins.
//
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 8.1)

import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';

interface PluginToolbarButtonsProps {
  className?: string;
}

/**
 * Resolve a Lucide icon by its kebab-or-pascal-case name. Plugins specify
 * the name in the manifest as a string (e.g., "wand-sparkles"); convert to
 * the PascalCase Lucide export. Falls back to `Puzzle` so an unknown name
 * still renders a recognizable plugin glyph instead of crashing the toolbar.
 */
function resolveIcon(name: string): LucideIcon {
  const pascal = name
    .split(/[-_\s]+/)
    .map((s) => (s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : ''))
    .join('');
  const candidate = (LucideIcons as unknown as Record<string, LucideIcon | undefined>)[pascal];
  return candidate ?? LucideIcons.Puzzle;
}

export function PluginToolbarButtons({ className }: PluginToolbarButtonsProps) {
  const buttons = usePluginRegistryStore((state) => state.toolbar);

  if (buttons.length === 0) return null;

  return (
    <div
      data-testid="plugin-toolbar-section"
      className={cn('flex items-center gap-0.5 pl-1 ml-1 border-l', className)}
    >
      {buttons.map((btn) => {
        const Icon = resolveIcon(btn.icon);
        return (
          <Button
            key={`${btn.pluginId}-${btn.id}`}
            data-testid={`plugin-toolbar-button-${btn.id}`}
            data-plugin-id={btn.pluginId}
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title={btn.tooltip}
            aria-label={btn.tooltip}
            onClick={() => {
              const manager = getActivePluginManager();
              if (!manager) return;
              void manager.invokeCommand(btn.pluginId, btn.command).catch((err: unknown) => {
                // Plugin command failures are logged in audit by PluginManager;
                // we swallow here to keep the click handler resilient.
                console.warn(
                  `[plugins] Toolbar command ${btn.command} from ${btn.pluginId} failed:`,
                  err,
                );
              });
            }}
          >
            <Icon className="h-4 w-4" />
          </Button>
        );
      })}
    </div>
  );
}

export default PluginToolbarButtons;
