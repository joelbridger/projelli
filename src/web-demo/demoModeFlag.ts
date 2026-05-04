/**
 * Stream D-web Group III · Task 3.2
 *
 * Demo-mode feature flag. The web-demo Vite build (`vite.config.web-demo.ts`)
 * substitutes `__PROJELLI_DEMO__` with `true` at build time so Rollup can
 * statically evaluate `IS_DEMO` and tree-shake the demo-only modules out of
 * the desktop bundle. The desktop build leaves the global undefined; we
 * defensively `typeof`-check to avoid a ReferenceError in that case.
 */

declare const __PROJELLI_DEMO__: boolean | undefined;

export const IS_DEMO: boolean = typeof __PROJELLI_DEMO__ !== 'undefined' && __PROJELLI_DEMO__;
