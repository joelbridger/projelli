import { invoke, isTauri } from '@tauri-apps/api/core';

import type { ClientFact, FactKind, FactValue, Sensitivity } from './types';

/**
 * The deliberately value-free fact shape used by request composition.
 *
 * This is separate from the advisor fact list because the composer only needs
 * to know whether a matching active fact exists. It must never receive a fact
 * value, an identifier, provenance, or sensitivity metadata.
 */
export interface FactMatchEntry {
  subject: string;
  kind: FactKind;
  status: ClientFact['status'];
}

export interface IntakeFactUpsertInput extends Omit<
  ClientFact,
  'fact_id' | 'status' | 'superseded_by'
> {
  fact_id?: string;
}

export interface MaskedClientFact {
  fact_id: string;
  matter_id: string;
  subject: string;
  kind: FactKind;
  sensitivity: Sensitivity;
  display_value: string;
  provenance: ClientFact['provenance'];
  verification: ClientFact['verification'];
  status: ClientFact['status'];
  superseded_by?: string;
}

export interface RevealedClientFact extends MaskedClientFact {
  value: FactValue;
}

let browserFacts = new Map<string, ClientFact>();

function newFactId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `fact_${crypto.randomUUID()}`;
  }
  return `fact_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function valueToPlainText(value: FactValue): string {
  switch (value.t) {
    case 'date':
    case 'string':
      return value.v;
    case 'money':
      return `${value.v.currency} ${String(value.v.amount)}`;
    case 'range': {
      const min = value.v.min == null ? '' : String(value.v.min);
      const max = value.v.max == null ? '' : String(value.v.max);
      return `${min}${min && max ? ' to ' : ''}${max}${value.v.unit ? ` ${value.v.unit}` : ''}`.trim();
    }
    case 'doc_ref':
      return value.v.path;
  }
}

export function maskFactValue(
  kind: FactKind,
  value: FactValue,
  sensitivity: Sensitivity
): string {
  const plain = valueToPlainText(value);
  if (sensitivity !== 'restricted') return plain;
  const digits = plain.replace(/\D/gu, '');
  const last4 = digits.slice(-4).padStart(4, '•');
  if (kind === 'ssn') return `•••-••-${last4}`;
  return `••••${last4}`;
}

function toMasked(fact: ClientFact): MaskedClientFact {
  return {
    fact_id: fact.fact_id,
    matter_id: fact.matter_id,
    subject: fact.subject,
    kind: fact.kind,
    sensitivity: fact.sensitivity,
    display_value: maskFactValue(fact.kind, fact.value, fact.sensitivity),
    provenance: fact.provenance,
    verification: fact.verification,
    status: fact.status,
    ...(fact.superseded_by ? { superseded_by: fact.superseded_by } : {}),
  };
}

function normalizeInput(input: IntakeFactUpsertInput): ClientFact {
  return {
    ...input,
    fact_id: input.fact_id ?? newFactId(),
    status: 'active',
  };
}

function upsertBrowserFact(input: IntakeFactUpsertInput): MaskedClientFact {
  const next = normalizeInput(input);
  for (const current of browserFacts.values()) {
    if (
      current.status === 'active' &&
      current.matter_id === next.matter_id &&
      current.subject === next.subject &&
      current.kind === next.kind &&
      current.fact_id !== next.fact_id
    ) {
      browserFacts.set(current.fact_id, {
        ...current,
        status: 'superseded',
        superseded_by: next.fact_id,
      });
    }
  }
  browserFacts.set(next.fact_id, next);
  return toMasked(next);
}

export async function setIntakeFactsWorkspace(
  workspaceRoot: string
): Promise<void> {
  if (!isTauri()) return;
  await invoke('intake_set_workspace', { path: workspaceRoot });
}

export async function intakeFactUpsert(
  input: IntakeFactUpsertInput
): Promise<MaskedClientFact> {
  if (isTauri()) {
    return invoke<MaskedClientFact>('intake_fact_upsert', { input });
  }
  return upsertBrowserFact(input);
}

export async function intakeFactList(
  matterId: string
): Promise<MaskedClientFact[]> {
  if (isTauri()) {
    return invoke<MaskedClientFact[]>('intake_fact_list', { matterId });
  }
  return Array.from(browserFacts.values())
    .filter((fact) => fact.matter_id === matterId && fact.status === 'active')
    .map(toMasked);
}

/**
 * List only active fact mappings for ask-once request composition.
 *
 * Do not implement this in terms of intakeFactList: that accessor exposes
 * display_value for normal-sensitivity facts. This function deliberately
 * reads the underlying source and projects only the three safe fields.
 */
export async function intakeFactMatchList(
  matterId: string
): Promise<FactMatchEntry[]> {
  if (isTauri()) {
    const facts = await invoke<Array<Pick<ClientFact, 'subject' | 'kind' | 'status'>>>(
      'intake_fact_list',
      { matterId },
    );
    return facts
      .filter((fact) => fact.status === 'active')
      .map((fact) => ({
        subject: fact.subject,
        kind: fact.kind,
        status: fact.status,
      }));
  }

  return Array.from(browserFacts.values())
    .filter((fact) => fact.matter_id === matterId && fact.status === 'active')
    .map((fact) => ({
      subject: fact.subject,
      kind: fact.kind,
      status: fact.status,
    }));
}

export async function intakeFactReveal(
  matterId: string,
  factId: string
): Promise<RevealedClientFact> {
  if (isTauri()) {
    return invoke<RevealedClientFact>('intake_fact_reveal', {
      matterId,
      factId,
    });
  }
  const fact = browserFacts.get(factId);
  if (!fact || fact.matter_id !== matterId) throw new Error('Fact not found.');
  return { ...toMasked(fact), value: fact.value };
}

export async function intakeFactPurge(
  matterId: string,
  factId: string
): Promise<string[]> {
  if (isTauri()) {
    return invoke<string[]>('intake_fact_purge', { matterId, factId });
  }
  const fact = browserFacts.get(factId);
  if (!fact || fact.matter_id !== matterId) throw new Error('Fact not found.');
  browserFacts.delete(factId);
  return [factId];
}

export function clearInMemoryFactsForTests(): void {
  browserFacts = new Map<string, ClientFact>();
}
