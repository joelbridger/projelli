/**
 * openMatterNotes — entry-point contract for opening the shared notes surface.
 *
 * Opens (or focuses) the notes tab for a given local matter. Uses the app's
 * existing tab mechanism: a synthetic path `matter-notes:/<localMatterId>` is
 * opened as an `openTab` call with type `'file'`. MainPanel's render switch
 * detects the `matter-notes:/` prefix and renders MatterNotesEditor instead of
 * the default file content.
 *
 * This function is safe to call from anywhere that has access to the editor
 * store (it reads state without subscribing to React).
 *
 * Contract: `export function openMatterNotes(localMatterId: string): void`
 */

import { useEditorStore } from '@/stores/editorStore';
import { useMatterStore } from '@/stores/matterStore';
import i18n from '@/i18n';

/**
 * Open or focus the shared notes surface for a matter.
 *
 * If the tab is already open, this focuses it without re-creating it.
 * If the matter does not exist, or is not shared with a firm, this is a
 * no-op. Opening notes for an unshared matter makes no sense: there is no
 * firm matter ID to sync against.
 */
export function openMatterNotes(localMatterId: string): void {
  const matter = useMatterStore.getState().matters.find((m) => m.id === localMatterId);
  if (!matter || !matter.shared || !matter.firmMatterId) return;

  const tabPath = `matter-notes:/${localMatterId}`;
  const { openTabs, setActiveTab, openTab } = useEditorStore.getState();

  // If the tab is already open, just focus it.
  const existing = openTabs.find((t) => t.path === tabPath);
  if (existing) {
    setActiveTab(tabPath);
    return;
  }

  // F-125: use matterLabel (not matter.name) so the tab title always shows the
  // best human-readable label — avoids leaking raw IDs if matter.name is empty
  // or if name === client (both set to client_name on firm-linked matters).
  const label = matter.client.trim() || matter.name.trim() || (matter.firmMatterId ?? matter.id);
  const tabTitle = i18n.t('matter.notes.tab-title', { name: label });

  // Open a new notes tab.
  openTab(
    tabPath,
    tabTitle,
    '', // Notes content is managed by the Yjs doc, not the tab content field.
    'file',
  );
}
