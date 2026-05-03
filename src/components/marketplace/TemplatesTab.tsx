/**
 * TemplatesTab — the Templates subtab inside Settings → Marketplace.
 *
 * Layout:
 *   [Browse | Installed]                                   <- inner toggle
 *   [Search input] [Category dropdown]              [Refresh]   <- toolbar
 *   <grid of TemplateCatalogCard>
 *
 * On mount the tab kicks off a silent refresh so users see fresh data, then
 * loads the cached list. After refresh we push the resulting cacheStatus
 * back into the store so the offline banner above us re-renders.
 *
 * Selecting a card swaps the grid for `TemplateDetailView`. Detail-view
 * state is local rather than store-resident so the rest of the app does not
 * have to know which template is selected.
 *
 * The Installed subview is delegated to `InstalledTemplatesList`, which calls
 * `service.uninstall(id)` and bubbles the removal back up through the
 * `onUninstalled` callback.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react';
import { useTemplatesMarketplace } from '@/hooks/useTemplatesMarketplace';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';
import { compareSemver } from '@/modules/marketplace';
import { TemplateCatalogCard } from './TemplateCatalogCard';
import { TemplateDetailView } from './TemplateDetailView';
import { InstalledTemplatesList } from './InstalledTemplatesList';

const ALL_CATEGORIES = '__all__';

type TemplatesSubview = 'browse' | 'installed';

export function TemplatesTab() {
  const { service, cacheStatus, setCacheStatus } = useTemplatesMarketplace();
  void cacheStatus;

  const [view, setView] = useState<TemplatesSubview>('browse');
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledEntry[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Initial load: silent refresh + list. We swallow refresh errors because
  // the offline banner above us already conveys network failure.
  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        await service.refresh({ silent: true });
      } catch {
        // silent
      } finally {
        if (!cancelled) {
          setCacheStatus(service.cacheStatus());
        }
      }
      try {
        const [list, installedList] = await Promise.all([
          service.list(),
          service.listInstalled(),
        ]);
        if (!cancelled) {
          setEntries(list);
          setInstalled(installedList);
        }
      } catch {
        // empty list is fine
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, setCacheStatus]);

  const installedById = useMemo(() => {
    const m = new Map<string, InstalledEntry>();
    for (const e of installed) m.set(e.id, e);
    return m;
  }, [installed]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) set.add(e.category);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (category !== ALL_CATEGORIES && e.category !== category) return false;
      if (q.length === 0) return true;
      const hay = [
        e.name,
        e.description,
        ...(e.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [category, entries, search]);

  const selected = selectedId ? entries.find((e) => e.id === selectedId) ?? null : null;

  const handleRefresh = useCallback(async () => {
    if (!service) return;
    setRefreshing(true);
    try {
      await service.refresh();
    } catch {
      // banner shows the failure; nothing else to surface here.
    } finally {
      setCacheStatus(service.cacheStatus());
    }
    try {
      const [list, installedList] = await Promise.all([
        service.list(),
        service.listInstalled(),
      ]);
      setEntries(list);
      setInstalled(installedList);
    } catch {
      // keep prior state
    } finally {
      setRefreshing(false);
    }
  }, [service, setCacheStatus]);

  const handleInstalled = useCallback(
    (e: InstalledEntry) => {
      setInstalled((prev) => {
        const next = prev.filter((p) => p.id !== e.id);
        next.push(e);
        return next;
      });
    },
    [],
  );

  const handleUninstalled = useCallback((id: string) => {
    setInstalled((prev) => prev.filter((p) => p.id !== id));
  }, []);

  if (!service) {
    return (
      <div
        data-testid="templates-tab-empty"
        className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
      >
        Open a workspace to browse community templates.
      </div>
    );
  }

  if (selected) {
    const installedEntry = installedById.get(selected.id);
    const updateAvailable = Boolean(
      installedEntry &&
        compareSemver(selected.version, installedEntry.version) > 0,
    );
    return (
      <TemplateDetailView
        entry={selected}
        service={service}
        installed={installedEntry}
        updateAvailable={updateAvailable}
        onBack={() => setSelectedId(null)}
        onInstalled={handleInstalled}
        onUninstalled={handleUninstalled}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="templates-tab">
      <Tabs
        value={view}
        onValueChange={(v) => setView(v as TemplatesSubview)}
        className="space-y-4"
      >
        <TabsList data-testid="templates-tab-subview-list">
          <TabsTrigger value="browse" data-testid="templates-tab-subview-browse">
            Browse
          </TabsTrigger>
          <TabsTrigger value="installed" data-testid="templates-tab-subview-installed">
            Installed
            {installed.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">
                {installed.length.toString()}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        {view === 'browse' && (
          <BrowseView
            entries={filtered}
            installedById={installedById}
            categories={categories}
            search={search}
            category={category}
            loading={loading}
            refreshing={refreshing}
            totalCount={entries.length}
            onSearchChange={setSearch}
            onCategoryChange={setCategory}
            onRefresh={() => {
              void handleRefresh();
            }}
            onSelect={setSelectedId}
          />
        )}

        {view === 'installed' && (
          <InstalledTemplatesList
            service={service}
            installed={installed}
            onUninstalled={handleUninstalled}
          />
        )}
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browse view
// ---------------------------------------------------------------------------

interface BrowseViewProps {
  entries: CatalogEntry[];
  installedById: Map<string, InstalledEntry>;
  categories: string[];
  search: string;
  category: string;
  loading: boolean;
  refreshing: boolean;
  totalCount: number;
  onSearchChange: (q: string) => void;
  onCategoryChange: (c: string) => void;
  onRefresh: () => void;
  onSelect: (id: string) => void;
}

function BrowseView({
  entries,
  installedById,
  categories,
  search,
  category,
  loading,
  refreshing,
  totalCount,
  onSearchChange,
  onCategoryChange,
  onRefresh,
  onSelect,
}: BrowseViewProps) {
  const categoryLabel =
    category === ALL_CATEGORIES ? 'All categories' : category;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-testid="templates-tab-toolbar">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            data-testid="templates-tab-search"
            type="search"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              data-testid="templates-tab-category-trigger"
              className="gap-1.5 min-w-[160px] justify-between"
            >
              <span className="truncate">{categoryLabel}</span>
              <ChevronDown className="h-4 w-4 opacity-60" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="templates-tab-category-menu">
            <DropdownMenuItem
              data-testid="templates-tab-category-all"
              onClick={() => onCategoryChange(ALL_CATEGORIES)}
            >
              All categories
            </DropdownMenuItem>
            {categories.map((c) => (
              <DropdownMenuItem
                key={c}
                data-testid={`templates-tab-category-${c}`}
                onClick={() => onCategoryChange(c)}
              >
                {c}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          data-testid="templates-tab-refresh"
          variant="outline"
          onClick={onRefresh}
          disabled={refreshing}
          className="gap-1.5"
        >
          <RefreshCw
            className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
            aria-hidden="true"
          />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {loading ? (
        <div
          data-testid="templates-tab-loading"
          className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading templates...
        </div>
      ) : entries.length === 0 ? (
        <div
          data-testid="templates-tab-empty-state"
          className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
        >
          {totalCount === 0
            ? 'No templates available yet. Check back soon.'
            : 'No templates match these filters.'}
        </div>
      ) : (
        <div
          data-testid="templates-tab-grid"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          {entries.map((e) => {
            const installedEntry = installedById.get(e.id);
            const updateAvailable = Boolean(
              installedEntry &&
                compareSemver(e.version, installedEntry.version) > 0,
            );
            return (
              <TemplateCatalogCard
                key={e.id}
                entry={e}
                installed={Boolean(installedEntry)}
                updateAvailable={updateAvailable}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
