/**
 * CRM bulk-selection public doorway.
 *
 * Future action lanes may import only this package. The contract exposes
 * selected household ids, read-only count, individual/visible/all selection,
 * clearing, and stale-id reconciliation. It is deliberately in-memory only;
 * selection is not persisted across a reload.
 */
export { bulkSelectDirectoryTool } from './directoryTool';
export { useBulkSelection, type BulkSelectionContract } from './selectionStore';
