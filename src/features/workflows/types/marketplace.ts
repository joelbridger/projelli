import type { TemplateProvenance } from '@/features/workflows/marketplace/svc/templateProvenance';

export type { TemplateProvenance };

export interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: { name: string; githubUser?: string; url?: string };
  category: string;
  tags: string[];
  screenshots?: string[];
  installUrl: string;
  manifestUrl: string;
  minAdvisor Prep HeroVersion: string;
  maxAdvisor Prep HeroVersion?: string;
  ratings?: { stars: number; count: number };
  publishedAt: string;
  updatedAt: string;
  /** SHA-256 of the installable tarball, hex */
  checksum?: string;
}

export interface InstalledEntry extends CatalogEntry {
  installedAt: string;
  installedPath: string;
  /** Where the template came from; drives the WorkflowPanel badge. */
  provenance: TemplateProvenance;
  /** apiVersion read from the installed manifest.json (spec §6.2). */
  manifestVersion: string;
}

export interface UpdateInfo {
  id: string;
  installedVersion: string;
  latestVersion: string;
}
