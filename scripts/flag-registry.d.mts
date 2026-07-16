/**
 * Type contract for the plain-Node registry reader. Keeping the return value
 * tied to the runtime registry's descriptor prevents script consumers from
 * drifting into a second flag shape.
 */
import type { FlagDescriptor } from '../src/platform/flags/registry';

export const registryPath: string;

export function readFlagRegistrySource(
  sourceText: string,
  filePath?: string
): FlagDescriptor[];

export function readFlagRegistry(filePath?: string): FlagDescriptor[];
