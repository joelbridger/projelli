// Move File Command
// Undoable file move operation

import { BaseCommand, type CommandData } from '../Command';

/**
 * File operations interface for move
 */
export interface MoveFileOps {
  move: (from: string, to: string) => Promise<void>;
}

/**
 * MoveFileCommand handles file/folder moves with undo support
 */
export class MoveFileCommand extends BaseCommand {
  constructor(
    private readonly fromPath: string,
    private readonly toPath: string,
    private readonly fileOps: MoveFileOps
  ) {
    super(`Move: ${fromPath} → ${toPath}`);
  }

  async execute(): Promise<void> {
    await this.fileOps.move(this.fromPath, this.toPath);
  }

  async undo(): Promise<void> {
    // Move back to original location
    await this.fileOps.move(this.toPath, this.fromPath);
  }

  toJSON(): CommandData {
    return {
      id: this.id,
      type: 'MoveFileCommand',
      description: this.description,
      timestamp: this.timestamp.toISOString(),
      data: {
        fromPath: this.fromPath,
        toPath: this.toPath,
      },
    };
  }
}
