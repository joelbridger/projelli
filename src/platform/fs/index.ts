// Workspace Module
// File system operations with path validation and security

// Types
export type {
  FSBackend,
  FileStat,
  FileOperation,
  SecurityErrorReason,
  WorkspaceInitOptions,
} from './types';
export {
  SecurityError,
  FileOperationError,
  DEFAULT_WORKSPACE_FOLDERS,
} from './types';

// Path Validator
export { PathValidator, createPathValidator } from './PathValidator';

// Workspace Service
export {
  WorkspaceService,
  createWorkspaceService,
} from './WorkspaceService';

// File System Backends
export { WebFSBackend, createWebFSBackend } from './WebFSBackend';
export {
  TauriFSBackend,
  createTauriFSBackend,
  isTauriEnvironment,
} from './TauriFSBackend';
