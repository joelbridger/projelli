function keyFor(intakeId: string): string {
  return `lantern:docusign-launch-opened:${intakeId}`;
}

/** Session-only UX guard. DocuSign remains the authority for actual one-time use. */
export function hasOpenedSigningLaunch(intakeId: string): boolean {
  try {
    return window.sessionStorage.getItem(keyFor(intakeId)) === '1';
  } catch {
    return false;
  }
}

export function markSigningLaunchOpened(intakeId: string): void {
  try {
    window.sessionStorage.setItem(keyFor(intakeId), '1');
  } catch {
    // Private browsing may not expose session storage. The provider still enforces one-time use.
  }
}
