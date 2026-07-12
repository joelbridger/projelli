import { mountWealthboxDepth } from './depth/runtime';

export * from './depth/customFieldIngestion';
export * from './depth/types';
export * from './depth/writeTargets';
export { ingestWealthboxCustomFieldsForAsk } from './depth/runtime';

// This is intentionally the connector's only mount point. The app shell owns
// the real Ask-index writer and supplies it during startup.
mountWealthboxDepth({
  ingestAskSources: () => Promise.reject(new Error('Wealthbox custom-field ingestion needs the app Ask-index bridge.')),
});
