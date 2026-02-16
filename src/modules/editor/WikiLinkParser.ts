// Wiki Link Parser
// Extracts [[wiki-style links]] from markdown content

export interface WikiLink {
  /** The text content inside the brackets */
  target: string;
  /** Display text if using piped syntax [[target|display]] */
  displayText: string | undefined;
  /** Start index in the document */
  startIndex: number;
  /** End index in the document */
  endIndex: number;
  /** Line number (1-based) */
  lineNumber: number;
  /** Column (0-based) */
  column: number;
}

export interface ParsedWikiLinks {
  /** All links found in the document */
  links: WikiLink[];
  /** Set of unique target names */
  targets: Set<string>;
}

// Regex to match wiki links: [[target]] or [[target|display]]
const WIKI_LINK_REGEX = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Parse wiki-style links from markdown content
 */
export function parseWikiLinks(content: string): ParsedWikiLinks {
  const links: WikiLink[] = [];
  const targets = new Set<string>();
  const lines = content.split('\n');

  let charIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';

    // Reset regex state
    WIKI_LINK_REGEX.lastIndex = 0;
    let match;

    while ((match = WIKI_LINK_REGEX.exec(line)) !== null) {
      const targetMatch = match[1];
      if (!targetMatch) continue;

      const target = targetMatch.trim();
      const displayText = match[2]?.trim();

      links.push({
        target,
        displayText,
        startIndex: charIndex + match.index,
        endIndex: charIndex + match.index + match[0].length,
        lineNumber: lineIndex + 1, // 1-based
        column: match.index,
      });

      targets.add(target);
    }

    charIndex += line.length + 1; // +1 for newline
  }

  return { links, targets };
}

/**
 * Check if a string contains wiki links
 */
export function containsWikiLinks(content: string): boolean {
  WIKI_LINK_REGEX.lastIndex = 0;
  return WIKI_LINK_REGEX.test(content);
}

/**
 * Resolve a wiki link target to a file path
 * Handles various formats:
 * - "filename" -> "filename.md"
 * - "folder/filename" -> "folder/filename.md"
 * - "filename.md" -> "filename.md"
 */
export function resolveWikiLinkTarget(target: string): string {
  // Already has .md extension
  if (target.endsWith('.md')) {
    return target;
  }

  // Add .md extension
  return `${target}.md`;
}

/**
 * Get the display text for a wiki link
 */
export function getWikiLinkDisplayText(link: WikiLink): string {
  return link.displayText ?? link.target;
}

/**
 * Create a wiki link string from target and optional display text
 */
export function createWikiLink(target: string, displayText?: string): string {
  if (displayText && displayText !== target) {
    return `[[${target}|${displayText}]]`;
  }
  return `[[${target}]]`;
}

/**
 * Replace wiki links in content with a custom formatter
 */
export function replaceWikiLinks(
  content: string,
  formatter: (link: WikiLink) => string
): string {
  const { links } = parseWikiLinks(content);

  // Sort links by startIndex in reverse order to replace from end to start
  // This preserves indices during replacement
  const sortedLinks = [...links].sort((a, b) => b.startIndex - a.startIndex);

  let result = content;
  for (const link of sortedLinks) {
    const before = result.slice(0, link.startIndex);
    const after = result.slice(link.endIndex);
    result = before + formatter(link) + after;
  }

  return result;
}
