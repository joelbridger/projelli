/**
 * PluginsSettings — installed-plugin management + per-plugin settings pages.
 *
 * Renders an overview of installed plugins (status badge per plugin) and
 * one navigable section per plugin-contributed `SettingsPageSpec`. Each
 * plugin page subtree lives in this single Settings category to keep the
 * top-level Settings nav small; users still see each plugin page in its
 * own row inside this category.
 *
 * Stream C3 — task 8.4.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PluginSettingsPage } from '@/components/plugins/PluginSettingsPage';
import { cn } from '@/lib/utils';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import { usePluginRegistryStore } from '@/stores/pluginRegistryStore';

export function PluginsSettings() {
  const { t } = useTranslation();
  const installed = usePluginManagerStore((state) => state.installedPlugins);
  const statusByPluginId = usePluginManagerStore((state) => state.statusByPluginId);
  const settingsPages = usePluginRegistryStore((state) => state.settingsPages);
  const [activePageId, setActivePageId] = useState<string | null>(null);

  const activePage = settingsPages.find((p) => p.id === activePageId) ?? null;

  return (
    <div className="space-y-6" data-testid="plugins-settings">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{t('settings.plugins.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('settings.plugins.description')}
        </p>
      </div>

      <section data-testid="plugins-installed-list">
        <h3 className="text-sm font-semibold mb-2">{t('settings.plugins.installed-heading')}</h3>
        {installed.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('settings.plugins.empty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {installed.map((p) => {
              const status = statusByPluginId[p.manifest.id] ?? p.status;
              return (
                <li
                  key={p.manifest.id}
                  data-testid={`plugin-installed-${p.manifest.id}`}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{p.manifest.name}</div>
                    <div className="text-xs text-muted-foreground">
                      v{p.manifest.version} - {p.manifest.id}
                    </div>
                  </div>
                  <span
                    data-testid={`plugin-status-${p.manifest.id}`}
                    className={cn(
                      'shrink-0 text-xs px-2 py-0.5 rounded-full',
                      status === 'enabled' && 'bg-green-500/15 text-green-700 dark:text-green-400',
                      status === 'disabled' && 'bg-muted text-muted-foreground',
                      status === 'crashed' && 'bg-red-500/15 text-red-700 dark:text-red-400',
                      status === 'installed' && 'bg-muted text-muted-foreground',
                      status === 'updating' && 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
                    )}
                  >
                    {status}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {settingsPages.length > 0 && (
        <section data-testid="plugins-settings-pages">
          <h3 className="text-sm font-semibold mb-2">{t('settings.plugins.plugin-settings-heading')}</h3>
          <nav
            data-testid="plugins-settings-nav"
            className="flex flex-col border rounded-md overflow-hidden mb-3"
          >
            {settingsPages.map((page) => {
              const isActive = activePage?.id === page.id;
              return (
                <button
                  key={page.id}
                  data-testid={`plugins-settings-nav-${page.id}`}
                  data-plugin-id={page.pluginId}
                  className={cn(
                    'text-left px-3 py-2 text-sm border-b last:border-b-0 transition-colors',
                    isActive
                      ? 'bg-accent text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                  )}
                  onClick={() => setActivePageId(page.id)}
                >
                  {page.title}
                </button>
              );
            })}
          </nav>

          {activePage && <PluginSettingsPage page={activePage} />}
        </section>
      )}
    </div>
  );
}
