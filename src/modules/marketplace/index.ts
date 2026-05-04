export { MarketplaceService } from './MarketplaceService';
export type {
  MarketplaceServiceOptions,
  InstallPhase,
  InstallOptions,
  CacheStatus,
  ManifestValidator,
  ManifestValidatorResult,
  ValidatedMarketplaceManifest,
  MarketplaceAuditEmitter,
  InstallAuditPayload,
  InstallFailedAuditPayload,
  UninstallAuditPayload,
  UpdateAuditPayload,
} from './MarketplaceService';
export {
  createTemplatesMarketplaceService,
  TEMPLATES_REPO_URL,
  TEMPLATES_CATALOG_PATH,
} from './TemplatesMarketplaceService';
export type { CreateTemplatesMarketplaceOptions } from './TemplatesMarketplaceService';
export {
  createPluginsMarketplaceService,
  PLUGINS_REPO_URL,
  PLUGINS_CATALOG_PATH,
} from './PluginsMarketplaceService';
export type { CreatePluginsMarketplaceOptions } from './PluginsMarketplaceService';
export type { CatalogEntry, InstalledEntry, UpdateInfo } from '@/types/marketplace';
export {
  downloadTarball,
  verifyChecksum,
  extractTarball,
  cleanupOnError,
} from './install';
export type {
  DownloadProgress,
  DownloadTarballOptions,
} from './install';
export {
  TEMPLATE_PROVENANCE_LABELS,
  isTemplateProvenance,
} from './templateProvenance';
export type { TemplateProvenance } from './templateProvenance';
export {
  validateTemplateManifest,
  templateManifestSchema,
  templateFileEntrySchema,
  templateManifestAuthorSchema,
  checkMinProjelliVersion,
  compareSemver,
} from './manifestValidator';
export type { TemplateManifestValidationResult } from './manifestValidator';
export type {
  TemplateManifest,
  TemplateFileEntry,
  TemplateFileType,
  TemplateManifestAuthor,
} from '@/types/templateManifest';
export {
  TemplateMetadataReader,
  COMMUNITY_TEMPLATE_ID_PREFIX,
} from './TemplateMetadataReader';
export type { TemplateMetadataReaderOptions } from './TemplateMetadataReader';
