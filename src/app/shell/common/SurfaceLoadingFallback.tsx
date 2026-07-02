// Shared Suspense fallback for lazily-loaded full-screen surfaces and modal
// bodies (Email, Settings, Activity Log, connector panels, etc). Deliberately
// plain — it's on screen for a single frame or two on a warm cache, so it
// just needs to read as "loading", not carry any surface-specific chrome.

import { Loader2 } from 'lucide-react';

export function SurfaceLoadingFallback() {
  return (
    <div className="flex h-full w-full flex-1 items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  );
}
