// Research Types

/**
 * Source for tracking research citations
 */
export interface SourceCard {
  id: string;
  url: string;
  title: string;
  date_accessed: string;
  quote_or_snippet: string;
  claim_supported: string;
  reliability_notes: string;
  tags?: string[];
  screenshot_url?: string; // Optional URL or data URL for website screenshot
  favicon?: string; // Optional URL for website favicon
}
