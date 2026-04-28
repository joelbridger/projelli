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
  minProjelliVersion: string;
  maxProjelliVersion?: string;
  ratings?: { stars: number; count: number };
  publishedAt: string;
  updatedAt: string;
  /** SHA-256 of the installable tarball, hex */
  checksum?: string;
}

export interface InstalledEntry extends CatalogEntry {
  installedAt: string;
  installedPath: string;
}

export interface UpdateInfo {
  id: string;
  installedVersion: string;
  latestVersion: string;
}
