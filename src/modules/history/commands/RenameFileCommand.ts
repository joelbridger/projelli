// Rename File Command
// Undoable file rename operation

import { BaseCommand, type CommandData } from '../Command';

/**
 * File operations interface for rename
 */
export interface RenameFileOps {
  rename: (path: string, newName: string) => Promise<void>;
}

/**
 * RenameFileCommand handles file/folder renames with undo support
 */
export class RenameFileCommand extends BaseCommand {
  private readonly oldName: string;

  constructor(
    private readonly path: string,
    private readonly newName: string,
    private readonly fileOps: RenameFileOps
  ) {
    super(`Rename: ${path.split('/').pop()} → ${newName}`);
    this.oldName = path.split('/').pop() ?? '';
  }

  async execute(): Promise<void> {
    await this.fileOps.rename(this.path, this.newName);
  }

  async undo(): Promise<void> {
    // Calculate new path after rename
    const pathParts = this.path.split('/');
    pathParts[pathParts.length - 1] = this.newName;
    const newPath = pathParts.join('/');

    // Rename back to original
    await this.fileOps.rename(newPath, this.oldName);
  }

  toJSON(): CommandData {
    return {
      id: this.id,
      type: 'RenameFileCommand',
      description: this.description,
      timestamp: this.timestamp.toISOString(),
      data: {
        path: this.path,
        newName: this.newName,
        oldName: this.oldName,
      },
    };
  }
}
