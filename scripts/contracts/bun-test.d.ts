/**
 * The root contract typecheck runs before the backend's Bun install in CI.
 * These tiny declarations let TypeScript follow the real cross-boundary
 * imports; Bun runs the actual assertions immediately afterward.
 */
declare module 'bun:test' {
  export const afterEach: (callback: () => void | Promise<void>) => void;
  export const describe: (name: string, callback: () => void | Promise<void>) => void;
  export const test: (name: string, callback: () => void | Promise<void>) => void;
  export const expect: any;
}
