# Browser launch recipe coverage

All owned Playwright Chromium launches now use `withBrowserLaunchOptions`, which
adds `--password-store=basic` only on Linux while keeping each launcher's
existing options. The direct Chrome process used to build demo PDFs receives the
same Linux-only flag.

CDP connection scripts are intentionally outside this recipe: they attach to an
already-running browser and therefore cannot control its launch arguments.
