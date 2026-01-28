// Batch Command
// Executes multiple commands as a single undoable operation

import { BaseCommand, type Command, type CommandData } from '../Command';

/**
 * BatchCommand executes multiple commands as a single operation
 * Useful for multi-select batch operations (delete, move, etc.)
 */
export class BatchCommand extends BaseCommand {
  private readonly commands: Command[];

  constructor(commands: Command[], description?: string) {
    super(description || `Batch operation (${commands.length} items)`);
    this.commands = commands;
  }

  /**
   * Execute all commands in order
   */
  async execute(): Promise<void> {
    for (const command of this.commands) {
      await command.execute();
    }
  }

  /**
   * Undo all commands in reverse order
   */
  async undo(): Promise<void> {
    // Undo in reverse order
    for (let i = this.commands.length - 1; i >= 0; i--) {
      const command = this.commands[i];
      if (command) {
        await command.undo();
      }
    }
  }

  /**
   * Serialize batch command
   */
  toJSON(): CommandData {
    return {
      id: this.id,
      type: 'batch',
      description: this.description,
      timestamp: this.timestamp.toISOString(),
      data: {
        commands: this.commands.map((cmd) => cmd.toJSON()),
      },
    };
  }

  /**
   * Get number of commands in batch
   */
  get commandCount(): number {
    return this.commands.length;
  }

  /**
   * Get all commands
   */
  getCommands(): readonly Command[] {
    return this.commands;
  }
}
