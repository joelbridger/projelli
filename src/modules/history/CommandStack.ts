// Command Stack
// Manages undo/redo history

import type { Command, CommandData } from './Command';

/**
 * Configuration for command stack
 */
export interface CommandStackConfig {
  maxSize: number;
  persistKey?: string;
}

/**
 * CommandStack manages undo/redo history
 */
export class CommandStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxSize: number;
  private readonly persistKey: string | undefined;

  constructor(config: CommandStackConfig = { maxSize: 100 }) {
    this.maxSize = config.maxSize;
    this.persistKey = config.persistKey;
  }

  /**
   * Execute a command and push to undo stack
   */
  async execute(command: Command): Promise<void> {
    await command.execute();

    // Push to undo stack
    this.undoStack.push(command);

    // Clear redo stack (new action invalidates redo history)
    this.redoStack = [];

    // Enforce max size
    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    // Persist if configured
    this.persist();
  }

  /**
   * Undo the last command
   */
  async undo(): Promise<Command | null> {
    const command = this.undoStack.pop();
    if (!command) return null;

    await command.undo();
    this.redoStack.push(command);

    this.persist();
    return command;
  }

  /**
   * Redo the last undone command
   */
  async redo(): Promise<Command | null> {
    const command = this.redoStack.pop();
    if (!command) return null;

    await command.execute();
    this.undoStack.push(command);

    this.persist();
    return command;
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Get the last command that can be undone
   */
  peekUndo(): Command | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  /**
   * Get the last command that can be redone
   */
  peekRedo(): Command | undefined {
    return this.redoStack[this.redoStack.length - 1];
  }

  /**
   * Get undo history
   */
  getUndoHistory(): Command[] {
    return [...this.undoStack];
  }

  /**
   * Get redo history
   */
  getRedoHistory(): Command[] {
    return [...this.redoStack];
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.persist();
  }

  /**
   * Get stack sizes
   */
  getSize(): { undo: number; redo: number } {
    return {
      undo: this.undoStack.length,
      redo: this.redoStack.length,
    };
  }

  /**
   * Serialize stacks for persistence
   */
  toJSON(): { undo: CommandData[]; redo: CommandData[] } {
    return {
      undo: this.undoStack.map((cmd) => cmd.toJSON()),
      redo: this.redoStack.map((cmd) => cmd.toJSON()),
    };
  }

  /**
   * Persist to localStorage if configured
   */
  private persist(): void {
    if (!this.persistKey || typeof localStorage === 'undefined') return;

    try {
      localStorage.setItem(this.persistKey, JSON.stringify(this.toJSON()));
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Create a command stack instance
 */
export function createCommandStack(config?: CommandStackConfig): CommandStack {
  return new CommandStack(config);
}
