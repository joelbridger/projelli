/**
 * App-wide map for registered shell surface ids.
 *
 * Interfaces are intentionally augmentable: a future feature that adds a
 * surface must extend this map with `declare module` in its own module. With
 * no string index signature, misspelled or unregistered ids fail typecheck.
 */
export interface AppSurfaceMap {
  home: true;
  matters: true;
  search: true;
  scheduling: true;
  settings: true;
  files: true;
  email: true;
  workflows: true;
  audit: true;
  privacy: true;
  'ai-assistant': true;
  research: true;
  trash: true;
}

export type AppSurface = Extract<keyof AppSurfaceMap, string>;

/** A cross-tool navigation request. P0-B will add feature-specific resolvers. */
export interface NavigationTarget {
  surface: AppSurface;
  [key: string]: unknown;
}
