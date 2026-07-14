#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { readFlagRegistry } from './flag-registry.mjs';

export function ageInDays(createdAt, now = new Date()) {
  return Math.max(
    0,
    Math.floor(
      (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        Date.parse(`${createdAt}T00:00:00.000Z`)) /
        86_400_000
    )
  );
}

export function formatInventory(flags, now = new Date()) {
  const rows = flags.map((flag) => [
    flag.id,
    flag.ownerLane,
    `${ageInDays(flag.createdAt, now)}d`,
    flag.expiresAt,
  ]);
  const widths = ['ID', 'OWNER', 'AGE', 'EXPIRY'].map((heading, index) =>
    Math.max(heading.length, ...rows.map((row) => row[index].length))
  );
  const format = (row) =>
    row
      .map((cell, index) => cell.padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  return [
    format(['ID', 'OWNER', 'AGE', 'EXPIRY']),
    format(widths.map((width) => '-'.repeat(width))),
    ...rows.map(format),
  ].join('\n');
}

export function main() {
  console.log(formatInventory(readFlagRegistry()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
