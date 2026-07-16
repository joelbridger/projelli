import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { createFirmTagStore } from './tagCatalog';

/**
 * Reactive public doorway for reusable firm tags.
 *
 * It intentionally creates a fresh adapter for each live-record render. That
 * keeps `catalog` tied to the current canonical snapshot instead of preserving
 * a memoized object that can silently retain a stale record array.
 */
export function useFirmTagStore() {
  return createFirmTagStore(useLiveCrmRecords());
}
