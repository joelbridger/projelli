import type { AuditSourceIdentity } from '@/platform/types/audit';

type SourceCaptureLike = {
  path?: string | null;
  sourceId?: string;
  label?: string;
  sourceType?: string;
  matterId?: string;
  locator?: string;
  pageNumber?: number;
  paragraphIndex?: number;
  id?: string;
};

function basename(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? path;
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || clean;
}

function extension(path: string): string | undefined {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot >= name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

function inferSourceType(source: SourceCaptureLike, path: string): string | undefined {
  if (source.sourceType) return source.sourceType;
  if (path.startsWith('mail:')) return 'mail';
  const ext = extension(path);
  return ext;
}

function defaultLabel(path: string, sourceType: string | undefined): string {
  if (sourceType === 'mail' || path.startsWith('mail:')) return 'Email';
  if (sourceType === 'crm' || path.startsWith('crm:')) return 'CRM';
  if (sourceType === 'meeting' || path.startsWith('meeting:')) return 'Meeting';
  if (sourceType === 'onedrive') return `OneDrive - ${basename(path)}`;
  if (sourceType === 'box') return `Box - ${basename(path)}`;
  if (sourceType === 'sharefile') return `ShareFile - ${basename(path)}`;
  if (sourceType === 'zocks') return `Zocks - ${basename(path)}`;
  if (sourceType === 'addepar') return `Addepar - ${basename(path)}`;
  return basename(path);
}

function locatorFor(source: SourceCaptureLike, sourceType: string | undefined): string | undefined {
  if (source.locator?.trim()) return source.locator.trim();
  if (source.pageNumber !== undefined) {
    if (sourceType === 'pdf') return `p. ${String(source.pageNumber)}`;
    if (sourceType === 'xlsx') return `sheet ${String(source.pageNumber)}`;
    if (sourceType === 'pptx') return `slide ${String(source.pageNumber)}`;
    if (sourceType === 'transcript') return `Tr. ${String(source.pageNumber)}`;
  }
  if (source.paragraphIndex !== undefined) return `paragraph ${String(source.paragraphIndex)}`;
  return undefined;
}

function identityKey(source: SourceCaptureLike): string {
  return source.sourceId ?? source.path ?? source.label ?? source.id ?? 'unknown-source';
}

export function sourceIdentitiesFromSources(
  sources: ReadonlyArray<SourceCaptureLike>,
): AuditSourceIdentity[] {
  const byKey = new Map<string, AuditSourceIdentity>();
  for (const source of sources) {
    const rawPath = source.sourceId ?? source.path ?? source.label ?? source.id;
    if (!rawPath) continue;
    const path = rawPath;
    const key = identityKey(source);
    const sourceType = inferSourceType(source, path);
    const locator = locatorFor(source, sourceType);
    const existing = byKey.get(key);
    if (existing) {
      existing.chunkCount += 1;
      if (locator) {
        const locators = existing.locators ?? [];
        if (!locators.includes(locator)) {
          existing.locators = [...locators, locator];
        }
      }
      continue;
    }

    const identity: AuditSourceIdentity = {
      id: key,
      label: source.label?.trim() || defaultLabel(path, sourceType),
      path,
      chunkCount: 1,
    };
    if (sourceType !== undefined) identity.sourceType = sourceType;
    if (source.matterId !== undefined) identity.matterId = source.matterId;
    if (locator !== undefined) identity.locators = [locator];
    byKey.set(key, identity);
  }
  return [...byKey.values()];
}

export function sourceIdentitiesFromSourceRefs(
  refs: ReadonlyArray<{
    kind: string;
    ref: string;
    locator?: string;
    citationId?: string;
  }>,
): AuditSourceIdentity[] {
  return sourceIdentitiesFromSources(
    refs.map((ref) => {
      const source: SourceCaptureLike = {
        path: ref.ref,
        sourceId: ref.ref,
        sourceType: ref.kind === 'email' ? 'mail' : ref.kind === 'document' ? extension(ref.ref) ?? 'document' : ref.kind,
      };
      if (ref.locator !== undefined) source.locator = ref.locator;
      if (ref.citationId !== undefined) source.id = ref.citationId;
      return source;
    }),
  );
}

export function formatSourceIdentity(source: AuditSourceIdentity): string {
  const locator = source.locators?.[0];
  return locator ? `${source.label} (${locator})` : source.label;
}

export function countSourcesByKind(sources: ReadonlyArray<AuditSourceIdentity>): {
  emails: number;
  pdfs: number;
} {
  let emails = 0;
  let pdfs = 0;
  for (const source of sources) {
    const type = source.sourceType?.toLowerCase();
    const ext = extension(source.path);
    if (type === 'mail' || type === 'email' || source.path.startsWith('mail:')) emails += 1;
    if (type === 'pdf' || ext === 'pdf') pdfs += 1;
  }
  return { emails, pdfs };
}
