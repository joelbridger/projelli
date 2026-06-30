// Re-export shim (Wave 5c). The mail store was promoted to
// `@/platform/connectors/email/mailStore` so the Settings connector panels can
// live in the platform layer. This shim keeps the in-flight email feature files
// (EmailWorkspace.tsx, App.tsx) importing the old path until they migrate to the
// platform path directly. Safe to delete once no `@/features/email/mailStore`
// importers remain.
export * from '@/platform/connectors/email/mailStore';
