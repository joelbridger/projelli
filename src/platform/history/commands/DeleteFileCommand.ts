// Delete File Command
// Soft delete with undo support

import { BaseCommand, type CommandData } from '../Command';
import type { FileOps } from './WriteFileCommand';

/**
 * DeleteFileCommand handles file deletion with soft delete support
 */
export class DeleteFileCommand extends BaseCommand {
  private savedContent: string | null = null;
  private trashPath: string | null = null;

  constructor(
    private readonly path: string,
    private readonly fileOps: FileOps,
    private readonly useTrash: boolean = true
  ) {
    super(`Delete file: ${path}`);
  }

  async execute(): Promise<void> {
    // Save content for undo
    this.savedContent = await this.fileOps.readFile(this.path);

    if (this.useTrash) {
      // Move to trash instead of permanent delete
      const timestamp = Date.now();
      const fileName = this.path.split('/').pop() ?? 'file';
      this.trashPath = `/.trash/${timestamp}_${fileName}`;

      await this.fileOps.writeFile(this.trashPath, this.savedContent);
    }

    await this.fileOps.delete(this.path);
  }

  async undo(): Promise<void> {
    if (this.savedContent !== null) {
      // Restore the file
      await this.fileOps.writeFile(this.path, this.savedContent);

      // Remove from trash if it was moved there
      if (this.trashPath) {
        try {
          await this.fileOps.delete(this.trashPath);
        } catch {
          // Ignore if trash file doesn't exist
        }
      }
    }
  }

  toJSON(): CommandData {
    return {
      id: this.id,
      type: 'DeleteFileCommand',
      description: this.description,
      timestamp: this.timestamp.toISOString(),
      data: {
        path: this.path,
        savedContent: this.savedContent,
        trashPath: this.trashPath,
        useTrash: this.useTrash,
      },
    };
  }
}
