# Phase 4: Solo-to-Firm Bridge + Matter Carry-Over — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Read first, in order:** [`../specs/2026-06-18-bottoms-up-wedge/04-phase4-solo-to-firm-bridge-design.md`](../specs/2026-06-18-bottoms-up-wedge/04-phase4-solo-to-firm-bridge-design.md) (the approved design), then `~/keepance/CLAUDE.md` (model/effort + voice rules) and `~/keepance/ARCHITECTURE.md` (the 5-layer DAG). Jameson is **not a developer** — never surface raw stack traces to him.
>
> **Sequencing:** This plan edits files in `src/features/matters/` and `src/features/account/`. It MUST be built on a branch off `keepance-3.0` **after** the parallel Client Map (matters) and Trial (account) work has merged, to avoid conflicts. Branch off the updated `keepance-3.0` at build time.

**Goal:** Let a solo user click "Use this with my firm," create or join a firm, and bring their existing matters over one by one (private or shared), reusing the existing share machinery.

**Architecture:** Extract the proven per-matter promote-to-shared routine into a standalone function; wrap it in a bulk carry-over function; build a guided UI (get-into-firm choice + per-matter carry-over step) in `src/features/firm/`; reuse the existing `FirmSignIn`/`claimOrg`/`activateSeat` flows for auth. No new sync or crypto. Sharing moves only the collaboration layer (notes + co-edited docs); files/email/RAG stay local.

**Tech Stack:** React 18 + TypeScript (strict) + Zustand + Tailwind + shadcn/ui; Tauri 2; Vitest + React Testing Library.

## Global Constraints

Every task implicitly includes these (from the spec §6):

- **Matter isolation:** never widen matter scope; `matterScopeGuard` rules unchanged; one client's data never crosses matters.
- **E2EE-only relay:** sharing only ever puts ciphertext on the relay. Reuse the existing key wrapping/escrow/epoch rotation; never add a relay-readable path.
- **Reuse, don't re-implement:** carry-over goes through the extracted `promoteMatterToShared` (which wraps `linkFirmMatter` + `matterKeyService`). Do not hand-roll firm-matter creation or key publishing.
- **Firm installs unchanged;** **solo stays accountless** (introduce no login for solo).
- **Privileged matters:** sharing one requires an explicit informed-consent confirm; never silently relay a privileged matter.
- **Locked tier codes** `personal | professional | practice` — never rename.
- **Voice:** NO em dashes in any user-facing string (a test enforces this). No AI tells ("leverage/seamless/transform/empower/elevate/unlock"). First-person, concrete nouns. Never claim "compliant"/"guaranteed".
- **Gates per task:** `npm run typecheck` = 0 · scoped `npx vitest run` green · `node scripts/eslint-gate.mjs` adds ZERO new findings (NEVER run it with `--update-baseline`). `npm run gate` before any merge.
- **No build/deploy** without Jameson's explicit go.

---

## Phase A — Reusable promote-to-shared routine

### Task A1: Extract `promoteMatterToShared` from `MatterManagerDialog` and reuse it there

**Files:**
- Create: `src/features/matters/logic/promoteMatterToShared.ts`
- Create: `tests/unit/matters/promoteMatterToShared.test.ts`
- Modify: `src/features/matters/MatterManagerDialog.tsx` (`handleShare`, lines ~198-253 — replace its body with a call to the new function)

**Interfaces:**
- Produces: `promoteMatterToShared(matterId: string, clientName: string, client: FirmApiClient): Promise<PromoteMatterResult>` where
  `type PromoteMatterResult = { status: 'shared'; matterId: string; firmMatterId: string; orgId: string } | { status: 'failed'; matterId: string; error: string }`

- [ ] **Step 1: Read the current routine.** Read `MatterManagerDialog.tsx` lines ~198-253 (the `handleShare` body) and note the EXACT import statements it relies on: `getClient`, `getOrCreateMatterKey`, `registerDevice`, `publishMatterKeyToMembers`, the `audit` service, and the `FirmApiClient` type. You will copy those same import paths into the new file.

- [ ] **Step 2: Write the failing test**

```ts
// tests/unit/matters/promoteMatterToShared.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the matter store so we can assert link/unlink calls and matter lookups.
const linkFirmMatter = vi.fn();
const unlinkFirmMatter = vi.fn();
let storeMatters: Array<{ id: string; firmMatterId?: string }> = [];
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: { getState: () => ({ linkFirmMatter, unlinkFirmMatter, matters: storeMatters }) },
}));

// Mock the key service (the crypto/relay side) — we assert it is called, not its internals.
const getOrCreateMatterKey = vi.fn().mockResolvedValue(undefined);
const registerDevice = vi.fn().mockResolvedValue(undefined);
const publishMatterKeyToMembers = vi.fn().mockResolvedValue(undefined);
vi.mock('@/platform/firm/matterKeyService', () => ({
  getOrCreateMatterKey: (...a: unknown[]) => getOrCreateMatterKey(...a),
  registerDevice: (...a: unknown[]) => registerDevice(...a),
  publishMatterKeyToMembers: (...a: unknown[]) => publishMatterKeyToMembers(...a),
}));

// Mock the audit service with the SAME import path MatterManagerDialog uses (confirm in Step 1).
const append = vi.fn();
vi.mock('@/platform/audit/auditService', () => ({ audit: { append } }));

import { promoteMatterToShared } from '@/features/matters/logic/promoteMatterToShared';

const makeClient = () => ({
  createMatter: vi.fn().mockResolvedValue({ matter: { matter_id: 'fm_1', org_id: 'org_1', key_epoch: 3 } }),
});

beforeEach(() => {
  vi.clearAllMocks();
  storeMatters = [{ id: 'm1' }];
});

describe('promoteMatterToShared', () => {
  it('shares a matter: creates the firm shell, links, publishes the key once, audits', async () => {
    const client = makeClient();
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'shared', matterId: 'm1', firmMatterId: 'fm_1', orgId: 'org_1' });
    expect(client.createMatter).toHaveBeenCalledWith('Acme');
    expect(linkFirmMatter).toHaveBeenCalledWith('m1', { firmMatterId: 'fm_1', orgId: 'org_1', role: 'owner' });
    expect(getOrCreateMatterKey).toHaveBeenCalledWith('fm_1');
    expect(publishMatterKeyToMembers).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ type: 'matter_shared' }));
  });

  it('rolls back the link on failure and returns a failed result', async () => {
    const client = makeClient();
    publishMatterKeyToMembers.mockRejectedValueOnce(new Error('relay down'));
    storeMatters = [{ id: 'm1', firmMatterId: 'fm_1' }]; // link was set before the failure
    const r = await promoteMatterToShared('m1', 'Acme', client as never);
    expect(r).toEqual({ status: 'failed', matterId: 'm1', error: 'relay down' });
    expect(unlinkFirmMatter).toHaveBeenCalledWith('m1');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/matters/promoteMatterToShared.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the function** (body is the exact logic lifted from `handleShare`; use the import paths confirmed in Step 1):

```ts
// src/features/matters/logic/promoteMatterToShared.ts
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  getOrCreateMatterKey,
  registerDevice,
  publishMatterKeyToMembers,
} from '@/platform/firm/matterKeyService';
import { audit } from '@/platform/audit/auditService'; // <-- use the path confirmed in Step 1
import type { FirmApiClient } from '@/platform/firm/FirmApiClient'; // <-- use the path confirmed in Step 1

export type PromoteMatterResult =
  | { status: 'shared'; matterId: string; firmMatterId: string; orgId: string }
  | { status: 'failed'; matterId: string; error: string };

/**
 * Promote one LOCAL matter to a firm-SHARED matter, in place. Reuses the proven
 * 6-step routine from MatterManagerDialog. Only the collaboration layer (notes +
 * co-edited docs) ever syncs; the matter's files/email/RAG stay local.
 */
export async function promoteMatterToShared(
  matterId: string,
  clientName: string,
  client: FirmApiClient,
): Promise<PromoteMatterResult> {
  const { linkFirmMatter, unlinkFirmMatter } = useMatterStore.getState();
  let linkedLocalId: string | null = null;
  try {
    const createRes = await client.createMatter(clientName);
    const firmMatterId = createRes.matter.matter_id;
    const orgId = createRes.matter.org_id;
    const epoch = createRes.matter.key_epoch;

    linkFirmMatter(matterId, { firmMatterId, orgId, role: 'owner' });
    linkedLocalId = matterId;

    await getOrCreateMatterKey(firmMatterId);
    await registerDevice(client);
    await publishMatterKeyToMembers(client, firmMatterId, epoch);

    audit.append({
      type: 'matter_shared',
      timestamp: new Date().toISOString(),
      payload: {
        matter_id: matterId,
        firm_matter_id: firmMatterId,
        org_id: orgId,
        detail: `shared as firm matter ${firmMatterId}`,
      },
    });
    return { status: 'shared', matterId, firmMatterId, orgId };
  } catch (err) {
    if (linkedLocalId) {
      const fresh = useMatterStore.getState().matters.find((x) => x.id === linkedLocalId);
      if (fresh?.firmMatterId) unlinkFirmMatter(linkedLocalId);
    }
    return { status: 'failed', matterId, error: err instanceof Error ? err.message : String(err) };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/matters/promoteMatterToShared.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Refactor `MatterManagerDialog.handleShare` to call it** (preserve the existing spinner + i18n error behavior):

```ts
const handleShare = async (matterId: string, clientName: string) => {
  setSharingMatterId(matterId);
  setShareError(null);
  const result = await promoteMatterToShared(matterId, clientName, getClient());
  if (result.status === 'failed') {
    setShareError(t('matter.manager.firm-share-error', { error: result.error }));
  }
  setSharingMatterId(null);
};
```

Remove the now-unused imports from `MatterManagerDialog.tsx` if they are no longer referenced elsewhere in the file (check `getOrCreateMatterKey`, `registerDevice`, `publishMatterKeyToMembers`, `linkFirmMatter`, `unlinkFirmMatter`, `audit` — some are still used by `handleLeave`/`handleOpenShared`, so only remove genuinely-unused ones).

- [ ] **Step 7: Run the dialog's existing tests + typecheck**

Run: `npx vitest run tests/unit/matters` and `npm run typecheck`
Expected: existing MatterManagerDialog tests still PASS; typecheck 0.

- [ ] **Step 8: Commit**

```bash
git add src/features/matters/logic/promoteMatterToShared.ts tests/unit/matters/promoteMatterToShared.test.ts src/features/matters/MatterManagerDialog.tsx
git commit -m "refactor(matters): extract promoteMatterToShared; reuse in MatterManagerDialog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase B — Bulk carry-over logic

### Task B1: `carryMattersToFirm` — run the per-matter routine across a selection

**Files:**
- Create: `src/features/firm/logic/carryMattersToFirm.ts`
- Create: `tests/unit/firm/carryMattersToFirm.test.ts`

**Interfaces:**
- Consumes: `promoteMatterToShared` (Task A1).
- Produces:
  - `type CarrySelection = { matterId: string; clientName: string; action: 'private' | 'share' }`
  - `type CarryMatterOutcome = { matterId: string; status: 'kept-private' } | { matterId: string; status: 'shared'; firmMatterId: string } | { matterId: string; status: 'failed'; error: string }`
  - `carryMattersToFirm(selections: CarrySelection[], client: FirmApiClient, onProgress?: (done: number, total: number) => void): Promise<CarryMatterOutcome[]>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/firm/carryMattersToFirm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const promoteMatterToShared = vi.fn();
vi.mock('@/features/matters/logic/promoteMatterToShared', () => ({
  promoteMatterToShared: (...a: unknown[]) => promoteMatterToShared(...a),
}));

import { carryMattersToFirm } from '@/features/firm/logic/carryMattersToFirm';

beforeEach(() => vi.clearAllMocks());

describe('carryMattersToFirm', () => {
  it('shares only the share-selected matters and leaves private ones untouched', async () => {
    promoteMatterToShared.mockImplementation(async (id: string) => ({
      status: 'shared', matterId: id, firmMatterId: `fm_${id}`, orgId: 'o',
    }));
    const outcomes = await carryMattersToFirm(
      [
        { matterId: 'a', clientName: 'A', action: 'share' },
        { matterId: 'b', clientName: 'B', action: 'private' },
        { matterId: 'c', clientName: 'C', action: 'share' },
      ],
      {} as never,
    );
    expect(promoteMatterToShared).toHaveBeenCalledTimes(2);
    expect(outcomes).toContainEqual({ matterId: 'b', status: 'kept-private' });
    expect(outcomes).toContainEqual({ matterId: 'a', status: 'shared', firmMatterId: 'fm_a' });
    expect(outcomes).toContainEqual({ matterId: 'c', status: 'shared', firmMatterId: 'fm_c' });
  });

  it('isolates a single failure without aborting the rest', async () => {
    promoteMatterToShared
      .mockResolvedValueOnce({ status: 'failed', matterId: 'a', error: 'boom' })
      .mockResolvedValueOnce({ status: 'shared', matterId: 'c', firmMatterId: 'fm_c', orgId: 'o' });
    const outcomes = await carryMattersToFirm(
      [
        { matterId: 'a', clientName: 'A', action: 'share' },
        { matterId: 'c', clientName: 'C', action: 'share' },
      ],
      {} as never,
    );
    expect(outcomes).toContainEqual({ matterId: 'a', status: 'failed', error: 'boom' });
    expect(outcomes).toContainEqual({ matterId: 'c', status: 'shared', firmMatterId: 'fm_c' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/firm/carryMattersToFirm.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the function**

```ts
// src/features/firm/logic/carryMattersToFirm.ts
import { promoteMatterToShared } from '@/features/matters/logic/promoteMatterToShared';
import type { FirmApiClient } from '@/platform/firm/FirmApiClient';

export type CarrySelection = { matterId: string; clientName: string; action: 'private' | 'share' };
export type CarryMatterOutcome =
  | { matterId: string; status: 'kept-private' }
  | { matterId: string; status: 'shared'; firmMatterId: string }
  | { matterId: string; status: 'failed'; error: string };

/**
 * Carry a set of local matters into the firm per the user's per-matter choice.
 * 'private' matters are left exactly as-is. 'share' matters run the proven
 * promote routine, SEQUENTIALLY (never in parallel) to avoid hammering the relay
 * and keychain. One matter failing never aborts the others.
 */
export async function carryMattersToFirm(
  selections: CarrySelection[],
  client: FirmApiClient,
  onProgress?: (done: number, total: number) => void,
): Promise<CarryMatterOutcome[]> {
  const outcomes: CarryMatterOutcome[] = selections
    .filter((s) => s.action === 'private')
    .map((s) => ({ matterId: s.matterId, status: 'kept-private' as const }));

  const toShare = selections.filter((s) => s.action === 'share');
  let done = 0;
  for (const s of toShare) {
    const r = await promoteMatterToShared(s.matterId, s.clientName, client);
    outcomes.push(
      r.status === 'shared'
        ? { matterId: s.matterId, status: 'shared', firmMatterId: r.firmMatterId }
        : { matterId: s.matterId, status: 'failed', error: r.error },
    );
    done += 1;
    onProgress?.(done, toShare.length);
  }
  return outcomes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/firm/carryMattersToFirm.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/firm/logic/carryMattersToFirm.ts tests/unit/firm/carryMattersToFirm.test.ts
git commit -m "feat(firm): bulk carry-matters-to-firm routine (sequential, fault-isolated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase C — The guided carry-over step (UI)

### Task C1: `CarryMattersStep` — per-matter private/shared list with privileged confirm

> UI task: start by reading the exact patterns, then implement against the behavior contract + test. Do not invent component APIs; mirror existing matter-list and dialog components.

**Files:**
- Create: `src/features/firm/CarryMattersStep.tsx`
- Create: `tests/unit/firm/CarryMattersStep.test.tsx`

**Interfaces:**
- Consumes: `carryMattersToFirm`, `CarrySelection`, `CarryMatterOutcome` (Task B1); the matter list from `useMatterStore` (`src/platform/matter/matterStore.ts`); the firm client accessor used by `MatterManagerDialog` (`getClient`).
- Produces: `<CarryMattersStep onDone={(outcomes: CarryMatterOutcome[]) => void} onSkip={() => void} />`

- [ ] **Step 1: Read patterns.** Read `MatterManagerDialog.tsx` (how it lists matters, calls `getClient`, shows per-matter spinners/errors), an existing shadcn confirm/alert dialog in the repo (grep `AlertDialog` under `src/ui/`), and `src/platform/types/matter.ts` (the `Matter` shape, esp. `privileged`, `archived`, `shared`).

- [ ] **Step 2: Write the failing test** (behavior contract):

```tsx
// tests/unit/firm/CarryMattersStep.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const carryMattersToFirm = vi.fn().mockResolvedValue([]);
vi.mock('@/features/firm/logic/carryMattersToFirm', () => ({
  carryMattersToFirm: (...a: unknown[]) => carryMattersToFirm(...a),
}));
// Provide matters: one normal, one privileged, one archived (excluded), one already-shared (excluded).
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: (sel: (s: unknown) => unknown) =>
    sel({
      matters: [
        { id: 'm1', name: 'Acme', client: 'Acme' },
        { id: 'm2', name: 'Secret', client: 'Secret', privileged: true },
        { id: 'm3', name: 'Old', client: 'Old', archived: true },
        { id: 'm4', name: 'Shared', client: 'Shared', shared: true, firmMatterId: 'fm_x' },
      ],
    }),
}));
// getClient: mirror MatterManagerDialog's import (confirm path in Step 1).
vi.mock('@/platform/firm/firmClient', () => ({ getClient: () => ({}) }));

import { CarryMattersStep } from '@/features/firm/CarryMattersStep';

beforeEach(() => vi.clearAllMocks());

describe('CarryMattersStep', () => {
  it('lists only eligible matters (excludes archived + already-shared)', () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Secret')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
  });

  it('requires a confirm before a privileged matter can be set to share', async () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByTestId('carry-share-m2')); // try to set the privileged matter to share
    expect(screen.getByTestId('privileged-share-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('privileged-share-confirm-accept'));
    fireEvent.click(screen.getByTestId('carry-submit'));
    await waitFor(() => expect(carryMattersToFirm).toHaveBeenCalled());
    const selections = carryMattersToFirm.mock.calls[0][0];
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm2', action: 'share' }));
  });

  it('declining the privileged confirm leaves that matter private', async () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByTestId('carry-share-m2'));
    fireEvent.click(screen.getByTestId('privileged-share-confirm-cancel'));
    fireEvent.click(screen.getByTestId('carry-submit'));
    await waitFor(() => expect(carryMattersToFirm).toHaveBeenCalled());
    const selections = carryMattersToFirm.mock.calls[0][0];
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm2', action: 'private' }));
  });

  it('Skip for now calls onSkip and does not carry anything', () => {
    const onSkip = vi.fn();
    render(<CarryMattersStep onDone={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId('carry-skip'));
    expect(onSkip).toHaveBeenCalled();
    expect(carryMattersToFirm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/firm/CarryMattersStep.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `CarryMattersStep`** against this contract:
  - Select eligible matters from the store: `matters.filter(m => !m.archived && !m.shared)`.
  - Local state: `Record<matterId, 'private' | 'share'>`, default every matter to `'private'`.
  - Each matter row: the matter name/client, a control to toggle private vs share with `data-testid={`carry-share-${id}`}` (set-to-share) and a private control; show a clear "Privileged" badge for `m.privileged`.
  - Privileged gate: when the user tries to set a `privileged` matter to `'share'`, open an `AlertDialog` (`data-testid="privileged-share-confirm"`) with plain copy ("Sharing turns on encrypted internet sync for this privileged matter. Continue?"), accept (`...-accept`) sets it to `'share'`, cancel (`...-cancel`) leaves it `'private'`. Non-privileged matters set to share immediately.
  - Submit (`data-testid="carry-submit"`): build `CarrySelection[]` from state (clientName from `m.client ?? m.name`), call `carryMattersToFirm(selections, getClient(), onProgress)`, show progress, then call `onDone(outcomes)`. Render per-matter outcomes (shared / kept private / failed-with-plain-error).
  - Skip (`data-testid="carry-skip"`): call `onSkip()`.
  - All user-facing strings via i18n; NO em dashes.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/firm/CarryMattersStep.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 6: i18n + commit.** Add any new i18n keys (kebab-case) to `en`, `es`, `de` and update `tests/unit/i18n/en-json-snapshot.test.ts` counts (see the QA board note). Then:

```bash
git add src/features/firm/CarryMattersStep.tsx tests/unit/firm/CarryMattersStep.test.tsx src/**/i18n/* tests/unit/i18n/en-json-snapshot.test.ts
git commit -m "feat(firm): guided carry-matters step with per-matter privacy + privileged confirm

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase D — Get-into-firm choice, entry points, and the post-seat trigger

### Task D1: `UseWithFirmFlow` — the two-door choice + reuse existing auth

**Files:**
- Create: `src/features/firm/UseWithFirmFlow.tsx`
- Create: `tests/unit/firm/UseWithFirmFlow.test.tsx`

**Interfaces:**
- Consumes: `FirmSignIn` (`src/features/firm/FirmSignIn.tsx`), `CarryMattersStep` (Task C1), firm session state (`useFirmStore` / `useFirm`).
- Produces: `<UseWithFirmFlow onClose={() => void} />`

- [ ] **Step 1: Read** `FirmSignIn.tsx` (how it exposes claim vs sign-in modes; its props), `AccountWindow.tsx:236` (how the Firm tab mounts `FirmSignIn` + `FirmAdminConsole`), and `useFirm`/`useFirmStore` (`isSignedIn`, `hasActiveSeat`).

- [ ] **Step 2: Write the failing test** asserting: (a) the initial screen shows two doors with `data-testid="firm-door-create"` and `data-testid="firm-door-join"`; (b) clicking each renders `FirmSignIn` in the matching mode (claim vs sign-in) — assert via a `data-testid` you pass through or the mode prop; (c) when firm session becomes `isSignedIn && hasActiveSeat`, the flow advances to render `CarryMattersStep` (mock both children to assert which renders). Mirror the wedge plan's component-test style.

- [ ] **Step 3: Implement** a small state machine: `'choose' → 'auth' (create|join) → 'carry' → done`. "Create/lead" routes to `FirmSignIn` claim mode plus a plain line that the firm plan is a paid plan with a link to get it (no fake "free" claim). "Join" routes to `FirmSignIn` sign-in mode. When `isSignedIn && hasActiveSeat` is first satisfied within this flow, advance to `CarryMattersStep`; on its `onDone`/`onSkip`, finish and `onClose`. NO em dashes; first-person concrete copy.

- [ ] **Step 4: Run test → PASS.** `npx vitest run tests/unit/firm/UseWithFirmFlow.test.tsx`

- [ ] **Step 5: Commit** `feat(firm): "Use this with my firm" two-door flow (create/join) into carry-over` (with the co-author trailer).

### Task D2: Discoverable entry points (Account window + one in-app affordance)

**Files:**
- Modify: `src/features/account/AccountWindow.tsx`
- Create: `src/features/firm/UseWithFirmPrompt.tsx` (a small, dismissible in-app card — its OWN component; do NOT modify `TrialBanner`/`TrialStatusChip`)
- Create: `tests/unit/firm/use-with-firm-entry.test.tsx`

**Interfaces:**
- Consumes: `UseWithFirmFlow` (Task D1), firm session state.

- [ ] **Step 1: Read** `AccountWindow.tsx` (the Firm tab region ~line 236) and how it reads firm session state.

- [ ] **Step 2: Write the failing test:** (a) for a solo user (`!isSignedIn || !hasActiveSeat`), an action `data-testid="use-with-firm-action"` is present in the Account window and opens `UseWithFirmFlow`; (b) for an active-seat firm user it is NOT shown; (c) `UseWithFirmPrompt` is dismissible (after clicking dismiss it does not re-render in the same session — test the local-dismiss state).

- [ ] **Step 3: Implement** the Account-window action (gated on solo) that opens `UseWithFirmFlow`, and the standalone dismissible `UseWithFirmPrompt`. Keep copy honest and short; NO em dashes. Do not touch trial components (KEEPANCE 3's lane).

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Commit** `feat(firm): discoverable "Use this with my firm" entry points` (co-author trailer).

### Task D3: Lock the post-seat trigger + firm-unchanged regression

**Files:**
- Create: `tests/unit/firm/solo-to-firm-bridge.integration.test.tsx`

- [ ] **Step 1: Write a test** that drives `UseWithFirmFlow` end-to-end with mocked auth + `carryMattersToFirm`: choose "create" → simulate `claimOrg`/seat activation flipping `isSignedIn && hasActiveSeat` true → assert `CarryMattersStep` renders → submit one share + one private → assert `carryMattersToFirm` is called with the right selections and the flow closes. Add an assertion that an EXISTING firm user (session already `isSignedIn && hasActiveSeat` before the flow opens) is routed straight past auth and the bridge never alters firm-tier state (no calls to claim/seat). 

- [ ] **Step 2: Run → PASS.** `npx vitest run tests/unit/firm/solo-to-firm-bridge.integration.test.tsx`

- [ ] **Step 3: Commit** `test(firm): lock solo-to-firm bridge flow + firm-unchanged invariant` (co-author trailer).

---

## Phase E — Integration + gate

### Task E1: Whole-feature gate

- [ ] **Step 1:** `npm run typecheck` → expect 0.
- [ ] **Step 2:** `npx vitest run tests/unit/matters tests/unit/firm` → expect all green.
- [ ] **Step 3:** `node scripts/eslint-gate.mjs` → expect ZERO new findings. If any appear, FIX them in code (NEVER `--update-baseline`).
- [ ] **Step 4:** `npm run gate` (full: typecheck + i18n + vitest + ESLint + cargo) → expect green. Coordinate so no other session is compiling Rust at the same time (the box runs one cargo compile at a time).
- [ ] **Step 5:** Whole-branch independent review with Codex (`codex-task --read-only` reviewing `git diff keepance-3.0...HEAD`) — confirm: reuse of `promoteMatterToShared` (no re-implemented crypto), privileged confirm enforced, firm-unchanged, no em dashes, matter isolation intact. Address findings.

---

## Self-review (completed by plan author)

- **Spec coverage:** Decision 1 (both doors) → D1/D3. Decision 2 (per-matter choice) → C1. Decision 3 (collab-layer only) → A1/B1 reuse the existing share routine; no content-transfer task exists (correct). Decision 4 (privileged confirm) → C1 (+ D3). Decision 5 (billing untouched) → no billing task; D1 surfaces the paid-plan reality without auto-conversion. §6 hard rules → Global Constraints + E1 review. §8 testing posture → A1/B1/C1/D3 tests. Success criteria → covered by D3 integration + E1.
- **Placeholder scan:** logic tasks (A1, B1) carry complete code + tests. UI tasks (C1, D1, D2, D3) follow the repo precedent: an explicit "read these files" step + a concrete behavior contract + a full test with `data-testid` assertions (the precise JSX depends on internal shadcn/matter-list patterns not resolvable from outside — this is an accurate instruction, not a TBD).
- **Type consistency:** `PromoteMatterResult`, `CarrySelection`, `CarryMatterOutcome`, `carryMattersToFirm`, `promoteMatterToShared`, `CarryMattersStep`, `UseWithFirmFlow` are named consistently across tasks.

## Landmines / gotchas

- **Build AFTER the parallel matters + account work merges.** This plan edits `MatterManagerDialog.tsx` and `AccountWindow.tsx`; building it concurrently with the Client Map (matters) or Trial (account) lanes will conflict. Branch off the updated `keepance-3.0`.
- **Confirm real import paths in Step 1 of A1/C1/D1** (`audit`, `FirmApiClient`/`getClient`, `AlertDialog`) — the paths shown are best-known but must be verified against the live code before relying on them.
- **i18n:** new keys are kebab-case across `en/es/de` and need the `en-json-snapshot` count bumped (QA board note).
- **eslint-gate runs separately** (the pre-push hook does not run it) and NEVER with `--update-baseline`.
- **Do not cut a build or deploy.**
