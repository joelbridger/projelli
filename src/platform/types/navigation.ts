/** The shell's left-nav surfaces (the `sidebarActiveTab` union). Lives in the
 *  platform layer so platform stores (e.g. the navigation history) can name a
 *  surface without importing upward from `app/` (architecture DAG). The app
 *  layer re-exports it from `useGlobalEventBus` for existing importers. */
export type AppSurface =
  | 'home'
  | 'files'
  | 'matters'
  | 'search'
  | 'email'
  | 'workflows'
  | 'ai-assistant'
  | 'research'
  | 'audit'
  | 'privacy'
  | 'scheduling'
  | 'settings'
  | 'trash';
