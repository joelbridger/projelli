// Filesystem Tools for AI Access
// Provides secure file operations that AI models can use to interact with workspace

import type { WorkspaceService } from '@/modules/workspace/WorkspaceService';

export interface FileOperationResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Tool definitions for AI models
 * These match the Claude/OpenAI function calling schema
 */
export const FILESYSTEM_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the workspace',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file relative to the workspace root (e.g., "docs/README.md")',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the workspace. IMPORTANT: Always use read_file first to check if the file exists and read its current content before writing. This tool will overwrite the entire file, so you must preserve any existing content you want to keep. Use this to update existing files or create new ones.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file relative to the workspace root',
        },
        content: {
          type: 'string',
          description: 'The complete content to write to the file (will replace existing content)',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: 'List all files and folders in a directory',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list (empty string or "." for root)',
        },
        recursive: {
          type: 'boolean',
          description: 'Whether to list recursively (default: false)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or folder',
    input_schema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'The current path of the file/folder',
        },
        to: {
          type: 'string',
          description: 'The new path for the file/folder',
        },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or folder (moves to trash)',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path to the file/folder to delete',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The path for the new folder',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_workspace_structure',
    description: 'Get the complete file tree structure of the workspace',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
] as const;

/**
 * Execute a filesystem tool
 */
export async function executeFilesystemTool(
  toolName: string,
  parameters: Record<string, unknown>,
  workspaceService: WorkspaceService,
  rootPath: string
): Promise<FileOperationResult> {
  try {
    switch (toolName) {
      case 'read_file': {
        const { path } = parameters as { path: string };
        const fullPath = `${rootPath}/${path}`;
        const content = await workspaceService.readFile(fullPath);
        return {
          success: true,
          data: { content, path },
        };
      }

      case 'write_file': {
        const { path, content } = parameters as { path: string; content: string };
        const fullPath = `${rootPath}/${path}`;

        // Check if file exists before writing
        let fileExisted = false;
        let previousContent = '';
        try {
          previousContent = await workspaceService.readFile(fullPath);
          fileExisted = true;
        } catch {
          // File doesn't exist, that's okay
          fileExisted = false;
        }

        await workspaceService.writeFile(fullPath, content);

        return {
          success: true,
          data: {
            path,
            action: fileExisted ? 'updated' : 'created',
            message: fileExisted
              ? `File updated successfully (previously existed with ${previousContent.length} characters)`
              : 'File created successfully',
          },
        };
      }

      case 'list_files': {
        const { path, recursive } = parameters as { path: string; recursive?: boolean };
        const fullPath = path === '' || path === '.' ? rootPath : `${rootPath}/${path}`;

        if (recursive) {
          const tree = await workspaceService.getFileTree();
          return {
            success: true,
            data: { files: tree, path },
          };
        } else {
          const files = await workspaceService.list(fullPath);
          return {
            success: true,
            data: { files, path },
          };
        }
      }

      case 'move_file': {
        const { from, to } = parameters as { from: string; to: string };
        const fullFrom = `${rootPath}/${from}`;
        const fullTo = `${rootPath}/${to}`;
        await workspaceService.move(fullFrom, fullTo);
        return {
          success: true,
          data: { from, to, message: 'File moved successfully' },
        };
      }

      case 'delete_file': {
        const { path } = parameters as { path: string };
        const fullPath = `${rootPath}/${path}`;
        await workspaceService.delete(fullPath);
        return {
          success: true,
          data: { path, message: 'File moved to trash successfully' },
        };
      }

      case 'create_folder': {
        const { path } = parameters as { path: string };
        const fullPath = `${rootPath}/${path}`;
        await workspaceService.mkdir(fullPath);
        return {
          success: true,
          data: { path, message: 'Folder created successfully' },
        };
      }

      case 'get_workspace_structure': {
        const tree = await workspaceService.getFileTree();
        return {
          success: true,
          data: { structure: tree },
        };
      }

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Format file tree for AI context
 */
export function formatFileTreeForContext(tree: unknown[], indent = 0): string {
  const lines: string[] = [];
  const indentation = '  '.repeat(indent);

  for (const node of tree) {
    const item = node as { name: string; type: 'file' | 'folder'; children?: unknown[] };
    const icon = item.type === 'folder' ? '📁' : '📄';
    lines.push(`${indentation}${icon} ${item.name}`);

    if (item.type === 'folder' && item.children) {
      lines.push(formatFileTreeForContext(item.children, indent + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Create workspace context for AI initialization
 */
export async function createWorkspaceContext(
  workspaceService: WorkspaceService,
  rootPath: string
): Promise<string> {
  try {
    // Read CLAUDE.md if it exists
    let claudeMdContent = '';
    try {
      claudeMdContent = await workspaceService.readFile(`${rootPath}/CLAUDE.md`);
    } catch {
      // CLAUDE.md doesn't exist, that's okay
    }

    // Get file structure
    const tree = await workspaceService.getFileTree();
    const treeFormatted = formatFileTreeForContext(tree);

    return `# Workspace Context

## Workspace Root
${rootPath}

## File Structure
${treeFormatted}

${claudeMdContent ? `## Project Context (from CLAUDE.md)\n\n${claudeMdContent}` : ''}

## Available Tools
You have access to the following tools to interact with the workspace:
- read_file: Read any file in the workspace
- write_file: Create or update files
- list_files: List directory contents
- move_file: Move or rename files/folders
- delete_file: Delete files/folders (moves to trash)
- create_folder: Create new folders
- get_workspace_structure: Get the complete file tree

## Instructions
1. You have full access to all files in the workspace
2. Use the tools above to read, write, and organize files as needed
3. Always use relative paths from the workspace root
4. All file operations are automatically logged in the audit trail

### IMPORTANT: File Editing Best Practices
5. **ALWAYS prefer editing existing files over creating new ones**
   - Before creating a new file, use list_files or get_workspace_structure to check if a similar file exists
   - If a file exists, use read_file to read its current content first
   - Then use write_file with the updated content (preserving existing parts you want to keep)
6. **Check before you create**:
   - Use read_file on the target path before write_file to see if it exists
   - The write_file tool will tell you if it updated an existing file or created a new one
7. **Only create new files when**:
   - The user explicitly asks for a new file
   - No suitable existing file can be found to edit
   - The content is truly distinct and doesn't belong in existing files
8. When editing files, follow the patterns you see in existing files
`;
  } catch (error) {
    console.error('Error creating workspace context:', error);
    return `# Workspace Context\n\nWorkspace Root: ${rootPath}\n\nError loading full context: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}
