export interface HostedBookingLinkInput {
  pageId: string;
  origin?: string | undefined;
}

/**
 * Small presentation adapter for a future hosted-page service. Building a URL
 * is intentionally local: this module never publishes, fetches, or persists.
 */
export function createHostedBookingLink({
  pageId,
  origin = 'https://book.lantern.local',
}: HostedBookingLinkInput): string {
  const safeOrigin = origin.replace(/\/$/, '');
  return `${safeOrigin}/p/${encodeURIComponent(pageId)}`;
}
