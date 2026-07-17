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
The helper itself also scans the live `.value` of every input and textarea;
`document.body.textContent` is not enough because it omits those values.

For example, a draft screen's adapter keeps its private proof at the mailbox
boundary:

```ts
assertNoAContentInUnderlyingState: async ({ typedA }, phase) => {
  if (phase !== 'B loaded') return;
  fireEvent.click(screen.getByTestId('save-draft'));
  await waitFor(() => expect(saveDraft).toHaveBeenCalled());
  expect(saveDraft.mock.calls.at(-1)?.[0].bodyText).not.toContain(typedA);
},
```
