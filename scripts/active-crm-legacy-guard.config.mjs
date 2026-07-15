/**
 * Active CRM/client ownership boundary.
 *
 * New client capability work belongs below crm-clients and reaches the shell
 * through its registries. The Matters screens remain compatibility code while
 * the live CRM path is completed; do not mount new work there.
 */
export const activeCrmLegacyGuardConfig = {
  sourceRoot: 'src',
  activeClientRoots: ['features/crm-clients'],
  legacyFeaturePrefix: '@/features/matters/',
  // These are deliberately narrow, frozen adapters used by the already-live
  // Client Map. They are compatibility bridges, not places to add capability.
  compatibilityAdapterImports: [
    ['src/features/crm-clients/ClientMapWorkspace.tsx', '@/features/matters/ClientMapPanel'],
    ['src/features/crm-clients/ClientMapWorkspace.tsx', '@/features/matters/useClientMap'],
    ['src/features/crm-clients/ClientMapWorkspace.tsx', '@/features/matters/clientMap/guidedInterview'],
    ['src/features/crm-clients/ClientMapWorkspace.tsx', '@/features/matters/clientMap/openSource'],
    ['src/features/crm-clients/bookRanking.ts', '@/features/matters/clientMap/guidedInterview'],
  ],
  activeMount: {
    file: 'src/app/shell/AppSurfaceRouter.tsx',
    module: '@/features/crm-clients',
    symbol: 'ClientsSurface',
  },
  legacyMountModules: [
    '@/features/matters/MattersHome',
    '@/features/matters/MatterHub',
  ],
};
