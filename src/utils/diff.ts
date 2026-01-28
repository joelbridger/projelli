// Diff Utility
// Simple line-based diff computation

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
  lineNumber: number | undefined;
  originalLineNumber: number | undefined;
}

export interface DiffResult {
  lines: DiffLine[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
}

/**
 * Compute a simple line-based diff between two strings
 * Uses a basic LCS (Longest Common Subsequence) approach
 */
export function computeDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Build LCS table
  const lcs = buildLCSTable(oldLines, newLines);

  // Backtrack to find diff
  let i = oldLines.length;
  let j = newLines.length;
  let newLineNum = newLines.length;
  let oldLineNum = oldLines.length;

  const result: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      // Lines match - unchanged
      result.unshift({
        type: 'unchanged',
        content: oldLines[i - 1] ?? '',
        lineNumber: newLineNum,
        originalLineNumber: oldLineNum,
      });
      i--;
      j--;
      newLineNum--;
      oldLineNum--;
    } else if (j > 0 && (i === 0 || lcs[i]![j - 1]! >= lcs[i - 1]![j]!)) {
      // Line added in new version
      result.unshift({
        type: 'added',
        content: newLines[j - 1] ?? '',
        lineNumber: newLineNum,
        originalLineNumber: undefined,
      });
      j--;
      newLineNum--;
    } else if (i > 0) {
      // Line removed from old version
      result.unshift({
        type: 'removed',
        content: oldLines[i - 1] ?? '',
        lineNumber: undefined,
        originalLineNumber: oldLineNum,
      });
      i--;
      oldLineNum--;
    }
  }

  let addedCount = 0;
  let removedCount = 0;
  let unchangedCount = 0;

  for (const line of result) {
    if (line.type === 'added') addedCount++;
    else if (line.type === 'removed') removedCount++;
    else unchangedCount++;
  }

  return {
    lines: result,
    addedCount,
    removedCount,
    unchangedCount,
  };
}

/**
 * Build LCS length table
 */
function buildLCSTable(oldLines: string[], newLines: string[]): number[][] {
  const m = oldLines.length;
  const n = newLines.length;

  // Create table with m+1 rows and n+1 columns
  const table: number[][] = [];
  for (let i = 0; i <= m; i++) {
    table[i] = new Array(n + 1).fill(0);
  }

  // Fill the table
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        table[i]![j] = table[i - 1]![j - 1]! + 1;
      } else {
        table[i]![j] = Math.max(table[i - 1]![j]!, table[i]![j - 1]!);
      }
    }
  }

  return table;
}

/**
 * Format diff as unified diff string
 */
export function formatUnifiedDiff(
  diff: DiffResult,
  oldName: string = 'original',
  newName: string = 'modified'
): string {
  const lines: string[] = [
    `--- ${oldName}`,
    `+++ ${newName}`,
  ];

  for (const line of diff.lines) {
    switch (line.type) {
      case 'unchanged':
        lines.push(` ${line.content}`);
        break;
      case 'added':
        lines.push(`+${line.content}`);
        break;
      case 'removed':
        lines.push(`-${line.content}`);
        break;
    }
  }

  return lines.join('\n');
}
