/**
 * File System Watcher
 *
 * Monitors the workspace for file/folder changes and triggers callbacks
 * when changes are detected. Uses polling mechanism for browser compatibility.
 */

export interface FileSystemWatcherOptions {
  pollInterval?: number; // Milliseconds between polls (default: 2000)
  onFileTreeChange?: () => void | Promise<void>;
}

export class FileSystemWatcher {
  private pollInterval: number;
  private onFileTreeChange: (() => void | Promise<void>) | undefined;
  private intervalId: number | null = null;
  private isPolling = false;
  private lastFileTreeSnapshot: string | null = null;

  constructor(options: FileSystemWatcherOptions = {}) {
    this.pollInterval = options.pollInterval ?? 2000; // Default: 2 seconds
    this.onFileTreeChange = options.onFileTreeChange ?? undefined;
  }

  /**
   * Start watching for file system changes
   */
  start(getFileTreeSnapshot: () => Promise<string>): void {
    if (this.intervalId !== null) {
      console.warn('FileSystemWatcher already started');
      return;
    }

    console.log(`FileSystemWatcher started with ${this.pollInterval}ms poll interval`);

    // Initial snapshot
    getFileTreeSnapshot().then(snapshot => {
      this.lastFileTreeSnapshot = snapshot;
    });

    // Start polling
    this.intervalId = window.setInterval(async () => {
      if (this.isPolling) {
        // Skip if previous poll is still running
        return;
      }

      this.isPolling = true;
      try {
        const currentSnapshot = await getFileTreeSnapshot();

        // Compare with last snapshot
        if (this.lastFileTreeSnapshot !== null && currentSnapshot !== this.lastFileTreeSnapshot) {
          console.log('FileSystemWatcher: File tree change detected');
          this.lastFileTreeSnapshot = currentSnapshot;

          // Trigger callback
          if (this.onFileTreeChange) {
            await this.onFileTreeChange();
          }
        } else if (this.lastFileTreeSnapshot === null) {
          // First snapshot after start
          this.lastFileTreeSnapshot = currentSnapshot;
        }
      } catch (error) {
        console.error('FileSystemWatcher: Error during poll:', error);
      } finally {
        this.isPolling = false;
      }
    }, this.pollInterval);
  }

  /**
   * Stop watching for file system changes
   */
  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.lastFileTreeSnapshot = null;
      console.log('FileSystemWatcher stopped');
    }
  }

  /**
   * Update the poll interval (requires restart to take effect)
   */
  setPollInterval(milliseconds: number): void {
    this.pollInterval = milliseconds;
  }

  /**
   * Update the change callback
   */
  setOnFileTreeChange(callback: () => void | Promise<void>): void {
    this.onFileTreeChange = callback;
  }

  /**
   * Check if watcher is currently active
   */
  isActive(): boolean {
    return this.intervalId !== null;
  }

  /**
   * Force a snapshot update (useful after manual file operations)
   */
  async updateSnapshot(getFileTreeSnapshot: () => Promise<string>): Promise<void> {
    try {
      this.lastFileTreeSnapshot = await getFileTreeSnapshot();
    } catch (error) {
      console.error('FileSystemWatcher: Error updating snapshot:', error);
    }
  }
}

/**
 * Create a file tree snapshot for comparison
 * This generates a string representation of the file tree structure
 */
export function createFileTreeSnapshot(fileTree: any[]): string {
  const sortedTree = JSON.stringify(fileTree, (_key, value) => {
    // Sort arrays to ensure consistent ordering
    if (Array.isArray(value)) {
      return value.slice().sort((a, b) => {
        if (typeof a === 'object' && typeof b === 'object' && a.path && b.path) {
          return a.path.localeCompare(b.path);
        }
        return 0;
      });
    }
    return value;
  });

  return sortedTree;
}
