// Workflow chain persistence (M7)
//
// Chains are saved as JSON files under `<workspace>/.projelli/chains/<id>.json`
// in Tauri builds; in the browser prototype we fall back to localStorage so
// the same UI works without needing a workspace selected.
//
// This module mirrors `userTemplates.ts` — swap-in storage adapter, JSON
// on the wire, tiny API — so the two feel alike in code reviews.

import type { WorkflowChain } from '@/types/workflow';
import { deserializeChain, serializeChain } from './WorkflowChainEngine';

export const CHAIN_STORAGE_KEY = 'projelli:workflowChains';

export interface ChainStorage {
  read(): string | null;
  write(value: string): void;
  clear(): void;
}

function defaultStorage(): ChainStorage {
  if (typeof localStorage === 'undefined') {
    const mem = new Map<string, string>();
    return {
      read: () => mem.get(CHAIN_STORAGE_KEY) ?? null,
      write: (v) => mem.set(CHAIN_STORAGE_KEY, v),
      clear: () => mem.delete(CHAIN_STORAGE_KEY),
    };
  }
  return {
    read: () => localStorage.getItem(CHAIN_STORAGE_KEY),
    write: (v) => localStorage.setItem(CHAIN_STORAGE_KEY, v),
    clear: () => localStorage.removeItem(CHAIN_STORAGE_KEY),
  };
}

let adapter: ChainStorage = defaultStorage();

export function setChainStorage(s: ChainStorage): void {
  adapter = s;
}

export function resetChainStorage(): void {
  adapter = defaultStorage();
}

function readAll(): WorkflowChain[] {
  const raw = adapter.read();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChain);
  } catch {
    return [];
  }
}

function writeAll(chains: WorkflowChain[]): void {
  adapter.write(JSON.stringify(chains));
}

function isChain(value: unknown): value is WorkflowChain {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<WorkflowChain>;
  return (
    v.schemaVersion === 1 &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.steps)
  );
}

export function listChains(): WorkflowChain[] {
  return readAll().sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
}

export function getChain(id: string): WorkflowChain | undefined {
  return readAll().find((c) => c.id === id);
}

export function saveChain(chain: WorkflowChain): WorkflowChain {
  const chains = readAll();
  const idx = chains.findIndex((c) => c.id === chain.id);
  const stamped: WorkflowChain = {
    ...chain,
    updatedAt: new Date().toISOString(),
  };
  if (idx === -1) {
    chains.push(stamped);
  } else {
    chains[idx] = stamped;
  }
  writeAll(chains);
  return stamped;
}

export function deleteChain(id: string): void {
  const chains = readAll().filter((c) => c.id !== id);
  writeAll(chains);
}

/**
 * Convenience for importing a chain JSON string (e.g. pasted into the UI).
 * Round-trips through the engine deserializer for schema validation.
 */
export function importChainJson(json: string): WorkflowChain {
  return deserializeChain(json);
}

export function exportChainJson(chain: WorkflowChain): string {
  return serializeChain(chain);
}
