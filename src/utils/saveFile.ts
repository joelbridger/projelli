// Cross-platform file save dialog
// Supports both browser (File System Access API) and Tauri (dialog plugin)

import { isTauriEnvironment } from '@/modules/workspace/BackendFactory';

export interface SaveFileOptions {
  /**
   * Suggested file name
   */
  suggestedName?: string;

  /**
   * File type filters (e.g., [{ name: 'Text', extensions: ['txt'] }])
   */
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;

  /**
   * Default file extension (Tauri only)
   */
  defaultExtension?: string;
}

/**
 * Shows a save file dialog and saves content to the selected location
 * @param content - The content to save (string or binary data)
 * @param options - Save options (suggested name, file types, etc.)
 * @returns Promise that resolves to the saved file path (Tauri) or undefined (browser)
 */
export async function saveFile(
  content: string | ArrayBuffer | Uint8Array,
  options: SaveFileOptions = {}
): Promise<string | undefined> {
  const isTauri = isTauriEnvironment();

  if (isTauri) {
    // Tauri mode: Use dialog plugin + fs plugin
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeFile, writeTextFile } = await import('@tauri-apps/plugin-fs');

      // Show save dialog
      const saveOptions: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> } = {};

      if (options.suggestedName) {
        saveOptions.defaultPath = options.suggestedName;
      }

      if (options.types) {
        saveOptions.filters = options.types.map(type => {
          const firstEntry = Object.entries(type.accept)[0];
          const [mimeType, extensions] = firstEntry || ['', []];
          return {
            name: type.description || mimeType || 'All Files',
            extensions: extensions || ['*'],
          };
        });
      }

      const filePath = await save(saveOptions);

      if (!filePath) {
        // User cancelled
        return undefined;
      }

      // Write file
      if (typeof content === 'string') {
        await writeTextFile(filePath, content);
      } else {
        const uint8Array = content instanceof Uint8Array ? content : new Uint8Array(content);
        await writeFile(filePath, uint8Array);
      }

      return filePath;
    } catch (error) {
      console.error('[saveFile] Failed to save in Tauri:', error);
      throw new Error(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    // Browser mode: Use File System Access API
    try {
      if (!('showSaveFilePicker' in window)) {
        throw new Error('File System Access API is not supported in this browser');
      }

      const pickerOptions: SaveFilePickerOptions = {};

      if (options.suggestedName) {
        pickerOptions.suggestedName = options.suggestedName;
      }

      if (options.types) {
        pickerOptions.types = options.types;
      }

      const handle = await window.showSaveFilePicker(pickerOptions);

      const writable = await handle.createWritable();

      if (typeof content === 'string') {
        await writable.write(content);
      } else {
        await writable.write(content);
      }

      await writable.close();
      return undefined; // Browser doesn't return path
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // User cancelled
        return undefined;
      }
      console.error('[saveFile] Failed to save in browser:', error);
      throw new Error(`Failed to save file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
