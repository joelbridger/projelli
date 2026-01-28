// Version Service
// Manages file version history with snapshots and restore capabilities

export interface FileVersion {
  id: string;
  filePath: string;
  content: string;
  timestamp: Date;
  size: number;
  message?: string; // Optional commit message
}

export interface VersionMetadata {
  filePath: string;
  versions: FileVersion[];
  maxVersions: number;
}

/**
 * VersionService provides file version history with snapshots
 */
export class VersionService {
  private readonly storageKey = 'workspace_versions';
  private readonly maxVersionsPerFile: number;
  private versionCache: Map<string, VersionMetadata> = new Map();

  constructor(maxVersionsPerFile: number = 50) {
    this.maxVersionsPerFile = maxVersionsPerFile;
    this.loadFromStorage();
  }

  /**
   * Save a new version snapshot of a file
   */
  async saveVersion(
    filePath: string,
    content: string,
    message?: string
  ): Promise<FileVersion> {
    const version: FileVersion = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      filePath,
      content,
      timestamp: new Date(),
      size: new Blob([content]).size,
      ...(message !== undefined && { message }),
    };

    // Get or create metadata for this file
    let metadata = this.versionCache.get(filePath);
    if (!metadata) {
      metadata = {
        filePath,
        versions: [],
        maxVersions: this.maxVersionsPerFile,
      };
      this.versionCache.set(filePath, metadata);
    }

    // Add new version at the beginning (newest first)
    metadata.versions.unshift(version);

    // Trim old versions if exceeding max
    if (metadata.versions.length > this.maxVersionsPerFile) {
      metadata.versions = metadata.versions.slice(0, this.maxVersionsPerFile);
    }

    // Persist to localStorage
    this.saveToStorage();

    return version;
  }

  /**
   * Get all versions for a file
   */
  getVersions(filePath: string): FileVersion[] {
    const metadata = this.versionCache.get(filePath);
    return metadata ? [...metadata.versions] : [];
  }

  /**
   * Get a specific version by ID
   */
  getVersion(filePath: string, versionId: string): FileVersion | undefined {
    const metadata = this.versionCache.get(filePath);
    if (!metadata) return undefined;

    return metadata.versions.find((v) => v.id === versionId);
  }

  /**
   * Get the latest version for a file
   */
  getLatestVersion(filePath: string): FileVersion | undefined {
    const metadata = this.versionCache.get(filePath);
    return metadata && metadata.versions.length > 0
      ? metadata.versions[0]
      : undefined;
  }

  /**
   * Delete a specific version
   */
  deleteVersion(filePath: string, versionId: string): boolean {
    const metadata = this.versionCache.get(filePath);
    if (!metadata) return false;

    const initialLength = metadata.versions.length;
    metadata.versions = metadata.versions.filter((v) => v.id !== versionId);

    if (metadata.versions.length < initialLength) {
      this.saveToStorage();
      return true;
    }

    return false;
  }

  /**
   * Clear all versions for a file
   */
  clearVersions(filePath: string): void {
    this.versionCache.delete(filePath);
    this.saveToStorage();
  }

  /**
   * Clear all versions for all files
   */
  clearAllVersions(): void {
    this.versionCache.clear();
    this.saveToStorage();
  }

  /**
   * Get version count for a file
   */
  getVersionCount(filePath: string): number {
    const metadata = this.versionCache.get(filePath);
    return metadata ? metadata.versions.length : 0;
  }

  /**
   * Get total size of all versions for a file
   */
  getTotalSize(filePath: string): number {
    const metadata = this.versionCache.get(filePath);
    if (!metadata) return 0;

    return metadata.versions.reduce((total, v) => total + v.size, 0);
  }

  /**
   * Get all files that have versions
   */
  getFilesWithVersions(): string[] {
    return Array.from(this.versionCache.keys());
  }

  /**
   * Compare two versions and get diff stats
   */
  compareVersions(
    filePath: string,
    versionId1: string,
    versionId2: string
  ): { added: number; removed: number; changed: boolean } | null {
    const v1 = this.getVersion(filePath, versionId1);
    const v2 = this.getVersion(filePath, versionId2);

    if (!v1 || !v2) return null;

    const lines1 = v1.content.split('\n');
    const lines2 = v2.content.split('\n');

    // Simple diff: count added/removed lines
    const added = Math.max(0, lines2.length - lines1.length);
    const removed = Math.max(0, lines1.length - lines2.length);
    const changed = v1.content !== v2.content;

    return { added, removed, changed };
  }

  /**
   * Export versions to JSON for backup
   */
  exportVersions(): string {
    const data: Record<string, VersionMetadata> = {};
    this.versionCache.forEach((metadata, filePath) => {
      data[filePath] = {
        ...metadata,
        versions: metadata.versions.map((v) => ({
          ...v,
          timestamp: v.timestamp.toISOString(),
        })) as any,
      };
    });
    return JSON.stringify(data, null, 2);
  }

  /**
   * Import versions from JSON backup
   */
  importVersions(jsonData: string): void {
    try {
      const data = JSON.parse(jsonData);
      this.versionCache.clear();

      Object.entries(data).forEach(([filePath, metadata]: [string, any]) => {
        this.versionCache.set(filePath, {
          filePath: metadata.filePath,
          maxVersions: metadata.maxVersions,
          versions: metadata.versions.map((v: any) => ({
            ...v,
            timestamp: new Date(v.timestamp),
          })),
        });
      });

      this.saveToStorage();
    } catch (error) {
      console.error('Failed to import versions:', error);
      throw new Error('Invalid version data format');
    }
  }

  /**
   * Load versions from localStorage
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        this.versionCache.clear();

        Object.entries(data).forEach(([filePath, metadata]: [string, any]) => {
          this.versionCache.set(filePath, {
            filePath: metadata.filePath,
            maxVersions: metadata.maxVersions || this.maxVersionsPerFile,
            versions: metadata.versions.map((v: any) => ({
              ...v,
              timestamp: new Date(v.timestamp),
            })),
          });
        });
      }
    } catch (error) {
      console.error('Failed to load versions from storage:', error);
    }
  }

  /**
   * Save versions to localStorage
   */
  private saveToStorage(): void {
    try {
      const data: Record<string, any> = {};
      this.versionCache.forEach((metadata, filePath) => {
        data[filePath] = {
          filePath: metadata.filePath,
          maxVersions: metadata.maxVersions,
          versions: metadata.versions.map((v) => ({
            ...v,
            timestamp: v.timestamp.toISOString(),
          })),
        };
      });

      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save versions to storage:', error);
    }
  }
}

/**
 * Create a singleton version service instance
 */
let versionServiceInstance: VersionService | null = null;

export function getVersionService(): VersionService {
  if (!versionServiceInstance) {
    versionServiceInstance = new VersionService();
  }
  return versionServiceInstance;
}
