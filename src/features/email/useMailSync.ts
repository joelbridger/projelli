// Re-export shim (Wave 5c). The mail-sync hook was promoted to
// `@/platform/connectors/email/useMailSync` so the Settings connector panels can
// live in the platform layer. This shim keeps the in-flight email feature files
// (App.tsx) importing the old path until they migrate to the platform path
// directly. Safe to delete once no `@/features/email/useMailSync` importers
// remain.
export * from '@/platform/connectors/email/useMailSync';
