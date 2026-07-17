# Cross-context isolation test harness

Use `assertCrossContextIsolation` for every surface that keeps dirty input or
derives a draft from async data. Import it only from
`@/testing/cross-context-isolation` and provide every required callback.

The helper owns all three mandatory proofs: same-context dirty preservation,
successful A-to-B isolation with deliberately reused record and field IDs, and
failed-B fail-closed behaviour. A surface may add its own async/cancellation
checks, but must not recreate a smaller local A-to-B probe.

For private React state, `assertNoAContentInUnderlyingState` must read the
state-owning store/hook or prove a save boundary cannot serialize A's draft.
