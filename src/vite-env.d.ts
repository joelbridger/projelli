/// <reference types="vite/client" />

interface Window {
  /**
   * Set before the renderer loads by a debug Tauri window when
   * `LANTERN_TEST_MODE=1`. This only hides first-run decoration; it does not
   * alter workspace or CRM persistence.
   */
  __LANTERN_TEST_MODE__?: boolean;
}

// Environment variables type definitions
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string;
  // Add more environment variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
