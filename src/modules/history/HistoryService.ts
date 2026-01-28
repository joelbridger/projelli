// History Service
// Orchestrates undo/redo for file operations

import { CommandStack, createCommandStack } from './CommandStack';
import { WriteFileCommand, type FileOps } from './commands/WriteFileCommand';
import { DeleteFileCommand } from './commands/DeleteFileCommand';
import { MoveFileCommand, type MoveFileOps } from './commands/MoveFileCommand';
import { RenameFileCommand, type RenameFileOps } from './commands/RenameFileCommand';
import { BatchCommand } from './commands/BatchCommand';
import type { Command } from './Command';

/**
 * Combined file operations interface
 */
export interface HistoryFileOps extends FileOps, MoveFileOps, RenameFileOps {}

/**
 * History change event
 */
export type HistoryChangeHandler = (canUndo: boolean, canRedo: boolean) => void;

/**
 * HistoryService provides undoable file operations
 */
export class HistoryService {
  private readonly stack: CommandStack;
  private readonly listeners: Set<HistoryChangeHandler> = new Set();

  constructor(
    private readonly fileOps: HistoryFileOps,
    maxHistorySize: number = 100
  ) {
    this.stack = createCommandStack({ maxSize: maxHistorySize });
  }

  /**
   * Subscribe to history changes
   */
  onChange(handler: HistoryChangeHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /**
   * Notify listeners of history changes
   */
  private notifyListeners(): void {
    const canUndo = this.stack.canUndo();
    const canRedo = this.stack.canRedo();
    for (const listener of this.listeners) {
      listener(canUndo, canRedo);
    }
  }

  /**
   * Write file with undo support
   */
  async writeFile(path: string, content: string): Promise<void> {
    const command = new WriteFileCommand(path, content, this.fileOps);
    await this.stack.execute(command);
    this.notifyListeners();
  }

  /**
   * Delete file with undo support (soft delete to trash)
   */
  async deleteFile(path: string, useTrash: boolean = true): Promise<void> {
    const command = new DeleteFileCommand(path, this.fileOps, useTrash);
    await this.stack.execute(command);
    this.notifyListeners();
  }

  /**
   * Move file with undo support
   */
  async moveFile(from: string, to: string): Promise<void> {
    const command = new MoveFileCommand(from, to, this.fileOps);
    await this.stack.execute(command);
    this.notifyListeners();
  }

  /**
   * Rename file with undo support
   */
  async renameFile(path: string, newName: string): Promise<void> {
    const command = new RenameFileCommand(path, newName, this.fileOps);
    await this.stack.execute(command);
    this.notifyListeners();
  }

  /**
   * Batch delete files with undo support
   */
  async batchDelete(paths: string[], useTrash: boolean = true): Promise<void> {
    const commands = paths.map(
      (path) => new DeleteFileCommand(path, this.fileOps, useTrash)
    );
    const batchCommand = new BatchCommand(
      commands,
      `Delete ${paths.length} item${paths.length > 1 ? 's' : ''}`
    );
    await this.stack.execute(batchCommand);
    this.notifyListeners();
  }

  /**
   * Batch move files with undo support
   */
  async batchMove(moves: Array<{ from: string; to: string }>): Promise<void> {
    const commands = moves.map(
      ({ from, to }) => new MoveFileCommand(from, to, this.fileOps)
    );
    const batchCommand = new BatchCommand(
      commands,
      `Move ${moves.length} item${moves.length > 1 ? 's' : ''}`
    );
    await this.stack.execute(batchCommand);
    this.notifyListeners();
  }

  /**
   * Execute a custom command
   */
  async executeCommand(command: Command): Promise<void> {
    await this.stack.execute(command);
    this.notifyListeners();
  }

  /**
   * Undo last operation
   */
  async undo(): Promise<Command | null> {
    const command = await this.stack.undo();
    this.notifyListeners();
    return command;
  }

  /**
   * Redo last undone operation
   */
  async redo(): Promise<Command | null> {
    const command = await this.stack.redo();
    this.notifyListeners();
    return command;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.stack.canUndo();
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.stack.canRedo();
  }

  /**
   * Get description of what will be undone
   */
  getUndoDescription(): string | undefined {
    return this.stack.peekUndo()?.description;
  }

  /**
   * Get description of what will be redone
   */
  getRedoDescription(): string | undefined {
    return this.stack.peekRedo()?.description;
  }

  /**
   * Get history sizes
   */
  getHistorySize(): { undo: number; redo: number } {
    return this.stack.getSize();
  }

  /**
   * Clear all history
   */
  clearHistory(): void {
    this.stack.clear();
    this.notifyListeners();
  }
}

/**
 * Create a history service instance
 */
export function createHistoryService(
  fileOps: HistoryFileOps,
  maxHistorySize?: number
): HistoryService {
  return new HistoryService(fileOps, maxHistorySize);
}
