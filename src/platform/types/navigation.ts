/**
 * Open map for shell surface ids.
 *
 * The concrete ids live in the app-owned surface registry. Keeping this map
 * open lets platform stores name navigation destinations without importing
 * upward from `app/` or maintaining a second fixed union. Runtime navigation
 * is validated by the registry before a surface is mounted.
 */
export interface AppSurfaceMap {
  [surfaceId: string]: unknown;
}

export type AppSurface = Extract<keyof AppSurfaceMap, string>;

/** A cross-tool navigation request. P0-B will add feature-specific resolvers. */
export interface NavigationTarget {
  surface: AppSurface;
  [key: string]: unknown;
}
