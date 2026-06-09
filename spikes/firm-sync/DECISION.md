# Architecture Decision — Keepance 3.0 Firm Platform (WS-F)

**Program gate:** P0 spike 3 of 3. Decide and de-risk the firm-platform architecture:
collaboration/sync, identity/auth, per-org licensing, ethical walls/ACL, and the assured
zero-retention inference backend.

**Verdict: GO.** The riskiest assumption — conflict-free collaborative editing that
coexists with the OOXML-DOM document model and track changes from Spike 1, while staying
local-first and offline-capable — is **proven** by the prototype in this folder (5/5
convergence tests pass, including the last-write-wins conflict case and tracked-change
attribution surviving a concurrent merge). The other four areas are tractable extensions
of code that already exists in the app; none is an architectural blocker. The single
highest-stakes design decision in this whole document is **#5 (the assured backend), and
specifically how we *prove* the no-logging claim** — that is the firm-facing moat, and it
must be designed as an auditable boundary, not a promise.

Decisions already settled and not relitigated here: in-house build (OSS libs fine, no SaaS
in the confidential data path, the assured backend is a service **we** operate); documents
are OOXML with track changes via the in-house Rust DOM engine (Spike 1); retrieval is
matter-scoped with isolation enforced at the vector store and a first-class Client/Matter
concept (Spike 2).

---

## 1. Collaboration / sync model

### Decision: **CRDT (Yjs/`yrs`), document-tree-as-CRDT, local-first by default.** Not OT, not server-authoritative.

**Recommendation:** make the structured document tree itself CRDT-backed. The
paragraphs→runs tree from Spike 1 becomes a `yrs` (Yjs) document where every node is a
CRDT node; concurrent edits converge by construction; we **serialize to OOXML on save**
exactly as Spike 1 already does, from the converged tree. The prototype here implements
precisely this and proves it.

**Why CRDT over OT / server-authoritative:**

- **Local-first is the product, and it's non-negotiable for solos.** A server-authoritative
  or OT model requires a central sequencer to assign a total order; edits can't be safely
  applied until the server blesses them. That breaks the offline-first promise (works
  offline except for AI calls) and breaks the assured-zero-retention story (the
  confidential document would have to pass through a coordinating server to merge). CRDTs
  merge **peer-to-peer with no coordinator** — proven in test `p5` (a late joiner applies
  everyone's deltas in any order, twice, and converges). The relay becomes a *dumb pipe*
  that never has to understand or decrypt the payload.
- **Offline-then-merge is a first-class operation, not a recovery path.** Two attorneys on
  a flight both edit the same MSA, reconnect, and merge with zero data loss (test `p2`).
  OT's transform functions are notoriously hard to get right for rich trees and generally
  assume a live server; CRDT convergence is a mathematical property of the data type.
- **The structured tree maps cleanly onto a CRDT.** `yrs` gives `Map`/`Array`/`Text`/`Xml`
  types. The prototype models the body as `Array<Map>` (ordered paragraphs), each paragraph
  a `Map` with a `runs` `Array<Map>`, each run a `Map` with a `Text` body — the direct
  analog of Spike 1's `Document { paragraphs: Vec<Paragraph { inlines: Vec<Inline> }> }`.
  Concurrent *character* edits in the same paragraph and concurrent *structural* edits
  (insert/delete paragraphs and runs) both converge (tests `p2`, `p3`).
- **`yrs` is in-house-compatible.** It's the Rust port of Yjs, a battle-tested OSS CRDT
  (the most widely deployed CRDT in production editors). We compile it into our binary; it
  is a library we control, not a SaaS. This sits naturally beside the Spike 1 Rust engine.

**How collaboration coexists with the OOXML-DOM model + track changes (the crux):**

- **Two layers, one tree.** The CRDT is the *concurrency/merge* layer; OOXML is the
  *serialization* layer. We do NOT make `.docx`/XML the live edit format (XML diff/merge is
  exactly what loses data). The CRDT tree is the source of truth while a doc is open;
  `import_docx` builds the CRDT tree from OOXML, `export_docx`/save serializes the converged
  CRDT tree back to OOXML using Spike 1's serializer. Round-trip fidelity is unchanged
  because the node shapes are the same; the CRDT just adds identity + merge to each node.
- **Tracked changes are attributed CRDT nodes.** Spike 1 represents a tracked insertion as
  `Inline::Insertion { meta: { author, date }, runs }` and a deletion as `Inline::Deletion
  { … }`. In the CRDT these are run `Map`s with `kind ∈ {text, ins, del}` plus `author` and
  `date` fields. Because the attribution lives *on the CRDT node*, it is part of the merged
  state and **survives concurrent editing unchanged** — proven in test `p4` (A's tracked
  insertion keeps `author="attorney-a"`, B's tracked deletion keeps `author="attorney-b"`,
  both present after a concurrent merge). On save these map straight back to `w:ins` /
  `w:del`+`w:delText` with `w:author`/`w:date`, and each gets a fresh unique `w:id`
  (Spike 1's monotonic id rule still applies — see "id allocation" below).
- **Author/date never get clobbered by a merge** because they're written once, by the
  authoring replica, as immutable scalar fields on the run node. A second author editing
  the *same paragraph* concurrently adds their own run node; it does not (and cannot) rewrite
  the first author's attribution. "Accept/reject this revision" is still the Spike 1
  operation (drop the `del` wrapper / unwrap the `ins`) — now it's a CRDT mutation that
  itself syncs, so accept/reject also converges across replicas.
- **The `Origin` hook gives us audit + attribution for plain edits too.** Every transaction
  in the prototype is opened with `transact_mut_with(Origin::from(author))`. That stamps the
  author onto the update; the production engine reads `txn.origin()` to feed the existing
  append-only audit log, so "who changed what" is answerable even for untracked edits.

**Sync transport (production sketch, beyond the prototype's in-memory exchange):**

- The wire primitive is three calls: `state_vector()` (compact "what I have"),
  `diff_since(remote_sv)` (the bytes the peer lacks), `apply(bytes)`. The prototype's
  `sync_pair` is the whole protocol in symmetric form.
- **Local-first default (solos):** no transport at all; the CRDT doc persists to disk in
  the workspace next to the `.docx`. Optional LAN/peer sync for a two-person office.
- **Firm default (multi-seat):** a thin relay we operate stores **opaque, client-side-
  encrypted CRDT update blobs** keyed by `(matter_id, doc_id)` and fans them out to seats
  with access. The relay is the *same trust class as the assured backend* (§5): it sees
  ciphertext only and is designed to be unable to read document content. Updates are
  end-to-end encrypted under a per-matter key held in each member's OS keychain (§2/§4);
  the relay cannot merge or read, it only stores+forwards — which is all CRDTs need.
- **Awareness/presence** (cursors, "who's here") rides a separate ephemeral channel (Yjs
  "awareness"), never persisted, never authoritative.

**Id allocation under concurrency.** Two risks to manage in the real build (not blockers):
(a) OOXML `w:id`s for revisions must stay unique across replicas — allocate them at *save*
time from the serializing replica (single-writer at serialization), or namespace by CRDT
client id, so concurrent authoring can't mint colliding `w:id`s; (b) paragraph/run ids in
the CRDT use uuids (prototype does this) so concurrent inserts never collide.

**Cost noted honestly:** CRDT documents carry metadata overhead (per-character identity)
and grow with edit history; large docs need periodic GC/compaction (`yrs` supports state
compaction and snapshots). This is a known, bounded engineering cost — not a correctness
risk — and is in the WS-F risk list below.

---

## 2. Identity & auth

### Decision: **Optional firm identity layered on top of the existing accountless local model. Solos keep zero-account local-first; firm users get an org account used only for licensing, sync access, and ethical-wall membership — never to hold or see client data.**

Today (verified in `src/hooks/useLicense.ts`, `src-tauri/src/commands/keychain.rs`):
Keepance is per-machine and accountless. License = a JWT in `localStorage`; "identity" =
a random `machine_id` uuid; API keys live in the OS keychain under a single shared service
`com.keepance.app`. There is no user concept and no org concept.

**Target model:**

- **Three identity tiers, additive:**
  1. **Accountless local (unchanged default).** Solo users never make an account. Local-
     first, BYOK, machine_id only. 3.0 must not regress this.
  2. **Firm member.** Authenticates to the firm's Keepance org to (a) prove a seat for
     licensing, (b) get access to shared-matter CRDT sync, (c) carry ethical-wall
     membership. This is an *authorization* identity, not a data custodian — the org auth
     server never receives document content or AI prompts.
  3. **(Optional) assured-backend principal.** If the firm uses the assured inference proxy
     (§5), the same firm identity authorizes the proxy (one bill + a DPA). Still no content
     retention.
- **Auth mechanism:** OIDC. Support (a) email+password with the org via our identity service
  for small firms, and (b) **SSO via the firm's existing IdP (SAML/OIDC — Okta, Entra ID,
  Google Workspace)** for larger firms, which is table stakes for legal IT buyers. The
  desktop app does a standard OAuth device/PKCE flow in the system browser; it receives a
  short-lived access token + a refresh token. **Tokens, not passwords, ever touch disk**,
  and they go in the OS keychain, not `localStorage` (the current license-token-in-
  localStorage is called out as a weakness in the code's own comments — fix it here).
- **Per-user keychain namespacing (replaces shared `com.keepance.app`).** The keychain
  service already supports an override arg (there's a `com.keepance.sync` precedent in
  `keychain.rs`). Namespace secrets per identity:
  - `com.keepance.app` — machine/solo BYOK keys (back-compat).
  - `com.keepance.user.<user_id>` — firm member's own BYOK keys + auth/refresh tokens.
  - `com.keepance.matter.<matter_id>` — the per-matter content-encryption key (for E2EE
    CRDT sync + encrypted matter store), released only to members past the ethical wall (§4).
  This keeps a shared machine (two attorneys, one workstation) from cross-contaminating
  secrets, and makes "deprovision attorney X" a matter of revoking their tokens + not
  re-releasing matter keys to them.
- **Coexistence:** identity is resolved at startup. No firm account ⇒ behave exactly as
  today. Firm account present ⇒ unlock shared matters, seat enforcement, and (if enabled)
  the assured backend. The two modes share all local-first machinery; firm mode only *adds*
  sync + authz.

**Non-goal:** Keepance identity is never a data-bearing cloud account. We authenticate
*people to entitlements*, not *documents to a server*.

---

## 3. Per-org licensing

### Decision: **Introduce an Org as the license holder; seats are user+machine bindings under the org; replace the honor-system per-machine check with org-scoped, signed, revocable seat tokens. Extend (don't replace) the existing `licenses.keepance.com` service.**

Today (from `useLicense.ts`): a license key activates on a `machine_id`, the server returns
a signed JWT with `{ tier, packs, seats, exp }`, the app trusts it and re-validates weekly
against a revocation list. `seats` exists in the payload but nothing actually *binds* or
*counts* seats — it's honor-system. There is no org entity, no per-seat identity, no
machine binding enforcement, and no deprovision flow.

**License-server data model (sketch):**

```
Org           { org_id, name, billing_customer_id, tier, packs[], seat_limit,
                created_at, status }                       # status: active|suspended
User          { user_id, org_id, email, role, status }     # role: admin|member; status: active|deprovisioned
Seat          { seat_id, org_id, user_id, machine_id,
                machine_label, bound_at, last_seen,
                status }                                    # status: active|revoked
LicenseKey    { key_id, org_id, key_hash, tier, packs[],
                seat_limit, issued_at }                     # one or more keys per org
Revocation    { token_id|seat_id, reason, revoked_at }
AuditEvent    { id, org_id, actor_user_id, action, target, ts }   # activate/revoke/seat-bind/deprovision
```

**Endpoints (extends the existing `/activate` + `/validate`):**

```
POST /org/activate        { license_key, user_token, machine_id, machine_label }
                          -> binds a Seat if under seat_limit; returns a signed *seat token*
                             { org_id, user_id, machine_id, tier, packs, seat_limit, exp }
                          -> 409 if seat_limit exceeded (with current seat list for the admin)
POST /seat/validate       { seat_token }   -> { valid, reason? }  # checks revocation + org status
POST /seat/heartbeat      { seat_token }   -> updates last_seen (drives "inactive seat" reclaim)
POST /org/seats           (admin)          -> list seats (who/what machine/last seen)
POST /org/seat/revoke     (admin) { seat_id }   -> revoke a single machine binding
POST /org/user/deprovision(admin) { user_id }   -> revoke all the user's seats + tokens;
                                                   stop releasing matter keys to them (§4)
POST /org/seats/transfer  (admin) { from_seat, to_user, to_machine }  # reassign a seat
```

**Key properties:**

- **Org is the unit of purchase**; seats are allocated within `seat_limit`. Activation past
  the limit fails closed and tells the admin which machines are consuming seats (so they can
  revoke/transfer). This makes the current Practice "up to 5 seats" tier actually enforced.
- **Machine binding** is the `(user_id, machine_id)` pair recorded on the Seat. Same user on
  a new laptop = a new seat-bind request (re-uses a seat if one is free, else 409).
- **Revoke / deprovision are first-class** and audited. Revoking a seat invalidates its seat
  token on next `/seat/validate`; deprovisioning a user revokes all their seats *and* is the
  signal to the matter-key release service (§4) to stop handing that user per-matter keys —
  so deprovision actually cuts data access, not just licensing.
- **Offline grace:** seat tokens are short-lived JWTs (e.g., 30-day `exp` like today) checked
  locally by signature + expiry; periodic online `/seat/validate` catches revocations.
  Offline beyond grace ⇒ degrade to free tier (today's behavior), never hard-lock mid-work.
- **Signing:** seat tokens are asymmetrically signed (server private key; app embeds the
  public key) so the client verifies authenticity offline and can never mint its own.
- **Migration:** existing single-machine licenses map to an implicit one-user org with one
  seat; no user-visible disruption for solos.

---

## 4. Ethical walls / ACL

### Decision: **Matter is the ACL unit (built on Spike 2's first-class Matter). Access = explicit per-matter membership; ethical walls = explicit deny that overrides any allow. Enforce at FOUR layers: membership, key release, sync, and retrieval — defense in depth, fail-closed.**

This is legal-specific and load-bearing: "attorney X cannot see client Y" is a professional-
responsibility requirement (a screened lawyer must be *provably* walled off, not just told
not to look). It must be **enforced**, not advisory. Today the app only has *advisory*
cross-client detection (`src/utils/client-boundary.ts` warns when AI context spans >1
top-level folder) — useful UX, not an enforcement boundary. Spike 2 added the real
enforcement primitive: `matter_id` with vector-store **prefilter** isolation.

**Model:**

```
Matter        { matter_id, org_id, client_name, status }        # from Spike 2
MatterMember  { matter_id, user_id, role }                       # role: owner|editor|viewer
EthicalWall   { matter_id, user_id, reason, created_by, created_at }   # explicit DENY (screen)
```

- **Default deny.** A firm user can see a matter only if there is a `MatterMember` row for
  them. No membership ⇒ no access. (Solos: every matter is implicitly theirs.)
- **Ethical wall = explicit deny that wins.** An `EthicalWall` row for `(matter, user)`
  overrides any membership or admin role — the screened attorney is blocked even if someone
  mistakenly adds them as a member. Deny-overrides-allow is the only safe default for
  screening. Walls are audited (who screened whom, when, why) because that audit trail is
  itself a compliance artifact.

**Four enforcement layers (all must hold; each fails closed):**

1. **Membership/authz (server).** The org server is the source of truth for `MatterMember`
   and `EthicalWall`. Every access-granting action checks `allowed = member ∧ ¬walled`.
2. **Key release (the real teeth).** The per-matter content-encryption key
   (`com.keepance.matter.<matter_id>`, §2) is released to a user's keychain **only if**
   `allowed`. A walled or non-member user never receives the key, so even if they obtain the
   encrypted CRDT blobs or the encrypted matter store off disk or off the relay, the content
   is unreadable. This makes the wall **cryptographic**, not just a UI gate — the standard a
   skeptical firm will demand. Deprovision/wall ⇒ stop releasing the key (and rotate it for
   the matter so future updates are under a key the removed user never had).
3. **Sync (relay).** The relay only fans out a matter's CRDT updates to `allowed` members'
   seats. A walled user's client never even receives the blobs. (Belt-and-suspenders with
   layer 2: they couldn't read them anyway.)
4. **Retrieval (Spike 2).** Matter-scoped RAG already isolates at the vector store via
   mandatory `only_if` prefilter (proven exact in Spike 2). Wire scope to membership: a
   user can only open a matter scope they're `allowed` for; `AllMatters` (the audited cross-
   matter path) excludes any matter the user is walled from. Spike 2's "never `postfilter`"
   guard stands.

**Why four layers:** authz can be bypassed by a stolen disk; encryption can't. Encryption
can be bypassed by a leaked key; membership rotation + deprovision close that. Each layer
covers a different threat (insider misconfig, disk theft, relay compromise, AI leakage).
The combination is what lets us tell a firm "screened means screened" with a straight face.

---

## 5. Assured zero-retention inference backend (design only)

### Decision: **Build an optional, in-house, stateless inference *proxy* that forwards prompts to the AI provider and is architecturally incapable of persisting request/response bodies. Treat "prove the no-logging claim" as the primary design requirement, not an afterthought. BYOK-direct stays the default and the strongest story; the assured proxy is the "one bill + a DPA + we-operate-it" option for firms that want it.**

**Why it exists.** Today's moat is BYOK-direct: prompts go straight from the user's machine
to Anthropic/OpenAI/Google, Keepance servers never in the path. That's the cleanest
confidentiality story and it stays the default. But some firms want (a) a single vendor
relationship + invoice instead of each attorney holding provider keys, and (b) a **DPA with
Keepance** covering inference. The assured backend serves them *without* giving up the
confidentiality posture — by being a proxy that provably retains nothing.

**Design (the proxy we operate):**

- **Stateless forwarding only.** The proxy accepts an authenticated request from a firm
  seat, attaches the firm's provider credential (held only in the proxy's secret manager,
  never logged), streams the request to the provider, streams the response straight back,
  and **holds the body only in transient memory for the duration of the stream**. No request
  body, no response body, no prompt, no completion is ever written to disk, a database, a
  log line, an APM trace, or a queue.
- **Logs are metadata-only and body-blind by construction.** It may log
  `{ request_id, org_id, seat_id, provider, model, token_counts, latency, status, ts }` for
  billing + abuse — never content, never even content hashes (a hash of a short privileged
  prompt is itself sensitive). The logging library is given a struct that has *no field*
  capable of holding a body; the body type is a streaming pipe that is never `Debug`/
  serialized. "Can't log it" is enforced by the type system, not by remembering not to.
- **No buffering middleware.** No request-logging middleware, no full-body parsing, no WAF
  that captures bodies, no reverse-proxy access log with POST bodies. The body is a pass-
  through stream end to end. (Optionally TLS-terminate as late as possible, or pass through
  to the provider over an upgraded connection, to shrink the plaintext window.)
- **Encryption in transit on both legs**; the only plaintext exposure is transient RAM
  during forwarding, which is the irreducible minimum for a proxy that has to speak to the
  provider at all. (If a firm won't accept *any* plaintext exposure, the honest answer is
  BYOK-direct + their own provider DPA — we say so.)
- **Stateless + ephemeral compute.** Run on instances with no persistent disk for request
  data; ephemeral filesystem; crash = nothing to recover because nothing was stored.

**How we PROVE the no-logging claim to a skeptical law firm (this is the point):**

1. **Open the design.** Publish the proxy's source (or the data-path core of it) and the
   exact deployment config. The claim shouldn't require trusting our word — it should be
   *readable*. "Here is the code; there is no write path for bodies" is far stronger than a
   marketing line.
2. **Make "no body write path" a type-level invariant + a test.** The body is a streaming
   type with no serialization; a CI test asserts no logger/serializer is ever called on it.
   Ship that test publicly so a firm's IT can run it.
3. **Audited boundary, not self-attestation.** Commission an independent audit (e.g.,
   SOC 2 Type II scoped to the proxy + a targeted pen-test/code audit of the data path) and
   share the report under NDA. The audit's job is precisely to confirm the absence of
   retention. (Briefs for SOC 2 / DPA already exist on the business side; this is where they
   pay off.)
4. **Transparency artifacts.** Provider-side configuration showing zero-data-retention /
   no-training on the upstream account (Anthropic/OpenAI both offer ZDR terms), surfaced to
   the firm; signed deployment attestations; optionally reproducible builds so the running
   binary matches the published source.
5. **Contract backs the architecture.** A DPA with explicit no-retention + no-training-on-
   firm-data + breach-notification terms. The architecture makes the contract *credible*
   rather than aspirational.
6. **Customer-verifiable runtime signal.** Per-request `X-Keepance-No-Retention: true` plus
   a documented way for the firm to confirm (e.g., the metadata-only log schema is published
   and the firm can request their own audit log to see it contains no bodies).

**Stance:** the assured backend's value is *trust you can verify*. We design it so the
honest sentence is "we **can't** retain your prompts, and here's the code, the test, and the
audit that show it" — not "we promise we don't." That sentence, backed by an open + audited
boundary, is the firm-facing moat. (Prototype intentionally out of scope for this gate.)

---

## Top risks for WS-F + mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | **CRDT ↔ OOXML fidelity drift.** The CRDT tree and the OOXML serializer could disagree on edge cases (unmodeled elements, paragraph-mark revisions, moves — Spike 1's known-hard items), or a merge could produce a tree that serializes to something Word renders oddly. | High | Keep Spike 1's **preserve-by-default** rule: unmodeled parts/elements ride as opaque CRDT nodes, re-emitted verbatim. Add a round-trip property test (import → concurrent edits → merge → export → re-import is stable). Lead the design-partner program with redline-heavy real docs opened in **real Word**. |
| R2 | **Tracked-change attribution corrupted by a merge** (the legal nightmare: a revision shows the wrong author). | High | Attribution is immutable scalar fields written once by the authoring replica on the run node (proven in `p4`); a concurrent author can only add their own node, never rewrite another's. Add a fuzz test that hammers concurrent tracked edits and asserts every revision keeps its original author/date. |
| R3 | **`w:id` collisions across replicas** breaking Word's accept/reject grouping. | Medium | Allocate OOXML `w:id`s at serialization time (single-writer) or namespace by CRDT client id; uuid-based node ids in the CRDT. Covered as a build task; not a correctness risk for convergence itself. |
| R4 | **CRDT document growth / GC.** Edit history metadata bloats long-lived matter docs; unbounded growth hurts load time + sync size. | Medium | Use `yrs` state compaction + periodic snapshots; cap awareness/ephemeral data; benchmark a year-long redline. Bounded engineering cost, not a blocker. |
| R5 | **Ethical wall enforced only in UI** (advisory, like today's cross-client banner) → a screened attorney actually reads client Y. | High | Make the wall **cryptographic**: per-matter key released only to `member ∧ ¬walled`; deny-overrides-allow; rotate key on removal; enforce at all four layers (§4), each fail-closed. Audit every wall + membership change. |
| R6 | **Seat/license bypass or over-allocation** (honor-system today). | Medium | Org-scoped, asymmetrically-signed, revocable seat tokens; server-enforced `seat_limit` with fail-closed activation; heartbeat-driven inactive-seat reclaim; deprovision wired to key release (§3/§4). |
| R7 | **Identity coexistence regresses the accountless local default** (solos forced into accounts). | Medium | Identity resolved at startup; no firm account ⇒ behave exactly as today; firm mode only *adds* authz + sync. Keep machine_id path. Regression test the no-account flow. |
| R8 | **Sync relay or assured proxy becomes a confidentiality liability** (the thing we built to protect data leaks it). | High | E2EE CRDT blobs under per-matter keys — relay/proxy see ciphertext only; assured proxy has no body write path (type-enforced) + open design + independent audit + DPA (§5). Both are the same trust class and are designed to be unable to read content. |
| R9 | **Key management complexity** (per-matter keys, rotation, recovery, shared workstations). | Medium | Lean on OS keychain with per-identity/per-matter namespacing (§2); define rotation + recovery + admin-escrow policy explicitly (a firm admin must be able to recover a matter if an attorney leaves — escrow the matter key to an org master key the admin controls, itself in a keychain/HSM). Design task, flagged early. |
| R10 | **Concurrent accept/reject of the same revision** (two people resolve the same tracked change at once). | Low | Accept/reject is a CRDT mutation (unwrap/drop the node), so it converges; double-resolution is idempotent (the node is already gone/plain). Add a test; low risk given CRDT semantics. |

---

## What this gate proves and what it defers

**Proven now (this folder):** conflict-free convergence of a shared matter document under
concurrent offline edits with no coordinator, including the last-write-wins conflict case
and tracked-change attribution surviving a concurrent merge (5/5 tests + an asserted demo).
This was the riskiest, least-certain assumption; it holds.

**Designed, not prototyped (this doc):** identity/auth layering, the per-org licensing
data model + endpoints, the four-layer ethical-wall enforcement, and the assured zero-
retention proxy with its proof strategy. Each is an extension of code that already exists
(`useLicense.ts`, `keychain.rs`, `client-boundary.ts`, Spike 2's matter scoping) or a new
service in the same trust class — none is an architectural unknown.

**Recommended next step:** stand up the design-partner firm program (already task #14) and
validate R1/R2/R5 against real redlines in real Word with a real screened-attorney scenario,
since those three are the high-severity items that only a real firm can fully exercise.
