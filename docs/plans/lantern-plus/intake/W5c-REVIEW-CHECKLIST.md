# W5c (intake key sharing / escrow) — deepest-review checklist

The E2EE-critical lane. Run this AFTER independent verify + BEFORE merge, in addition to one adversarial `codex-review --base lp/intake-w56` with a key-sharing attack prompt. Anchored in ARCHITECTURE §2 "Multi-advisor firms", §8 T1/T2, RISKS §2/§3, and the matter-key precedent it mirrors.

## A. Crypto correctness (read the code, not just the tests)
- [ ] The wrapped payload is the intake PRIVATE key (JWK), wrapped via `keyWrap.ts` construction to each device pubkey. The relay stores ONLY wrapped ciphertext — grep the new table writes; confirm no raw JWK / no decryptable field is ever persisted server-side.
- [ ] HKDF info + GCM AAD bind BOTH the epoch AND an intake-distinct context string. Confirm an intake-context wrap cannot unwrap under a matter-context and vice versa — the test exists AND the context strings actually differ in code.
- [ ] Wrong-member: a device outside the matter roster + not an admin is issued NO blob; if handed another member's blob, unwrap fails (auth tag / ECDH mismatch). Verify both halves.
- [ ] Ex-member epoch: on epoch bump, re-wrap goes to remaining members + admins ONLY; the removed member's old-epoch blob does NOT unwrap new-epoch material (wrong-epoch AAD → fail). Mirror `bumpMatterKeyEpoch` exactly — no subtly different epoch rule.
- [ ] The intake KEYPAIR itself never rotates (submissions are sealed to it) — only the wrapping epoch advances. Confirm code does not regenerate the intake keypair on member-remove (that would orphan already-received submissions).
- [ ] Escrow: org-admin device (non-member) can obtain + unwrap → recovers a departed advisor's in-flight intake. Uses the SAME `eligibleDevices` roster+escrow logic as matter keys (not a fork).
- [ ] Tamper: byte-flip in a wrapped blob → fail; transplant blob from intake A onto intake B → fail; replay an old-epoch blob after bump → fail.

## B. Relay (backend)
- [ ] `POST/GET /intake/:id/keys` reuse existing seat+JWT auth; only the intake's org may publish/fetch; foreign-org caller gets UNIFORM 404/410 (no existence oracle) — mirror the uniform-410 discipline, constant-time where a token compare is involved.
- [ ] New `intake_wrapped_keys` table stores only (intake_id, user_id, device_id, epoch, wrapped_key_b64) — nothing decryptable, no client PII, nothing beyond ARCHITECTURE §3's honest list (wrapped-key routing ids are ciphertext-adjacent by design).
- [ ] GET returns ONLY the calling device's blob (not the whole set) — a member can't enumerate other members' wrapped material.

## C. Integration / no-regression
- [ ] A second advisor's sync path: `obtainIntakeKey` runs, installs the JWK into `intakeKeychain`, then `IntakeSyncClient` decrypts unchanged — end-to-end two-advisor decrypt of ONE intake works (the bench target).
- [ ] Solo / non-firm user: unchanged single-machine behavior, no sharing attempted, no error. Firm-tier gate reuses the existing entitlement predicate (not a new one).
- [ ] Publish triggers on create + roster/epoch change (mirrors `autoRepublishHeldMatterKeys`); `deviceSetFingerprint` drift detection present.
- [ ] Intent/outcome audit row for the advisor-visible "shared this intake's key with the team" action (if surfaced), refuse-if-audit-fails pattern.
- [ ] ARCHITECTURE §10 "advisor machine lost (pre-Wave-5)" caveat softened/removed where code now covers it — and the copy stays HONEST (escrow depends on the admin device being enrolled; don't overclaim recoverability if no admin device exists).

## D. Claims / honesty (RISKS)
- [ ] No new marketing/UI claim that overstates the sharing security (still "only [Firm] can unlock", now truthfully across firm devices — not "zero-knowledge").
- [ ] The escrow story is stated honestly: firm-tier, admin-device-dependent.

## E. STOP conditions (escalate, do not merge)
- Any path where the relay could obtain a key that decrypts content.
- Any wrong-member or ex-member unwrap that SUCCEEDS.
- Roster/epoch logic that diverges from the matter-key precedent in a way that changes who can decrypt.
- If any of these appear: `COORDINATOR:` escalate with the exact code path, do not merge.

Bench (coordinator-gated, post-merge): two advisors on two machines decrypt one intake; a removed member loses access after epoch bump.
