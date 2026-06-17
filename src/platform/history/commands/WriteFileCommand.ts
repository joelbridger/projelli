// Write File Command
// Undoable file write operation

import { BaseCommand, type CommandData } from '../Command';

/**
 * File operations interface (injected dependency)
 */
export interface FileOps {
  writeFile: (path: string, content: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
  exists: (path: string) => Promise<boolean>;
  delete: (path: string) => Promise<void>;
}

/**
 * WriteFileCommand handles creating/updating files with undo support
 */
export class WriteFileCommand extends BaseCommand {
  private previousContent: string | null = null;
  private fileExisted: boolean = false;

  constructor(
    private readonly path: string,
    private readonly content: string,
    private readonly fileOps: FileOps
  ) {
    super(`Write file: ${path}`);
  }

  async execute(): Promise<void> {
    // Save previous state for undo
    this.fileExisted = await this.fileOps.exists(this.path);
    if (this.fileExisted) {
      this.previousContent = await this.fileOps.readFile(this.path);
    }

    // Write the new content
    await this.fileOps.writeFile(this.path, this.content);
  }

  async undo(): Promise<void> {
    if (this.fileExisted && this.previousContent !== null) {
      // Restore previous content
      await this.fileOps.writeFile(this.path, this.previousContent);
    } else {
      // File didn't exist before, delete it
      await this.fileOps.delete(this.path);
    }
  }

  toJSON(): CommandData {
    return {
      id: this.id,
      type: 'WriteFileCommand',
      description: this.description,
      timestamp: this.timestamp.toISOString(),
      data: {
        path: this.path,
        content: this.content,
        previousContent: this.previousContent,
        fileExisted: this.fileExisted,
      },
    };
  }
}
