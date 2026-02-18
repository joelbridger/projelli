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
