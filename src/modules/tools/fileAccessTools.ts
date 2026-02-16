// File Access Tools for AI Chat
// Provides Claude with full read/write access to workspace files

export const FILE_ACCESS_TOOLS = [
  {
    name: 'read_file',
    description: 'Read contents of a file in the workspace',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'Relative path to file from workspace root (e.g., "PROJECT_VISION.md" or "docs/README.md")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. IMPORTANT: If the file already exists at the given path, it will be overwritten with the new content (use this to edit existing files). If it doesn\'t exist, a new file will be created. Always use the exact same path when editing an existing file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'Relative path to file from workspace root (e.g., "docs/NEW_DOC.md"). Use the exact same path to edit an existing file.'
        },
        content: {
          type: 'string' as const,
          description: 'The complete content to write to the file (this will replace any existing content)'
        }
      },
      required: ['path', 'content']
    }
  },
  {
    name: 'create_folder',
    description: 'Create a new folder in the workspace',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'Relative path for the new folder (e.g., "new_folder" or "docs/subfolders")'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or folder',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: {
          type: 'string' as const,
          description: 'Current relative path of the file/folder'
        },
        to: {
          type: 'string' as const,
          description: 'New relative path for the file/folder'
        }
      },
      required: ['from', 'to']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file or folder (moves to trash for safety)',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'Relative path to the file/folder to delete'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'list_files',
    description: 'List files and folders in a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string' as const,
          description: 'Relative path to directory (empty string or "." for root, e.g., "docs" for docs folder)'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'search_files',
    description: 'Search for files by name pattern (supports wildcards like *.md)',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description: 'Search query or pattern (e.g., "*.md" for all markdown files, "vision" to find files with "vision" in name)'
        }
      },
      required: ['query']
    }
  }
];
