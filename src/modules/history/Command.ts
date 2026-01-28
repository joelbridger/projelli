// Command Interface
// Base interface for undoable file operations

/**
 * Command interface for undoable operations
 */
export interface Command {
  /**
   * Unique identifier for this command
   */
  readonly id: string;

  /**
   * Human-readable description
   */
  readonly description: string;

  /**
   * Timestamp when command was created
   */
  readonly timestamp: Date;

  /**
   * Execute the command
   */
  execute(): Promise<void>;

  /**
   * Undo the command
   */
  undo(): Promise<void>;

  /**
   * Serialize command for persistence
   */
  toJSON(): CommandData;
}

/**
 * Serializable command data
 */
export interface CommandData {
  id: string;
  type: string;
  description: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Command factory for deserialization
 */
export type CommandFactory = (data: CommandData) => Command;

/**
 * Base class for commands with common functionality
 */
export abstract class BaseCommand implements Command {
  readonly id: string;
  readonly description: string;
  readonly timestamp: Date;

  constructor(description: string) {
    this.id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.description = description;
    this.timestamp = new Date();
  }

  abstract execute(): Promise<void>;
  abstract undo(): Promise<void>;
  abstract toJSON(): CommandData;
}
