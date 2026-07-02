// Workspace Types

/**
 * Represents a file or folder in the workspace
 */
export interface FileNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  extension?: string;
  size?: number;
  modifiedAt?: Date;
  /**
   * Set when this folder's contents could not be read (permission denied, an
   * offline network/OneDrive location, a locked drive). `children` is still
   * `[]` in this case, but it means "couldn't check", not "empty" — the UI
   * should show that honestly instead of looking like an ordinary empty folder.
   */
  readError?: boolean;
}

/**
 * Workspace configuration
 */
export interface Workspace {
  rootPath: string;
  name: string;
  createdAt: Date;
  lastOpenedAt: Date;
}

/**
 * Recent workspace entry
 */
export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: Date;
}
