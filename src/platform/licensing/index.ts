// Licensing module — the pure entitlement decision layer.
//
// `decideEntitlement` is the single source of truth for what a user may do
// given their license. DATA ACCESS IS ALWAYS TRUE in every branch.

export {
  decideEntitlement,
  isGrandfatheredLicense,
  normalizeStatus,
  toLicenseRecord,
  entitlementMessage,
  LANTERN_3_0_LAUNCH,
  OFFLINE_GRACE_DAYS,
  type Entitlement,
  type EntitlementState,
  type EntitledTier,
  type LicenseRecord,
  type LicenseStatus,
  type LicenseType,
  type OfflineGraceState,
  type TrialContext,
} from './entitlements';
