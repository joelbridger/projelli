# Sub-lane 1 evidence fix 3 work log

## Spec echo — before edit

For the dark-path proof, **complete capture** means taking a new snapshot for
every subscriber emission and for the final current-store state. The snapshot
must explicitly include every field in `ClientContextState`: `client`, `scope`,
`followerStatus`, `selectionRevision`, `setClient`, and `clearClient`.

The proof must compare the whole snapshot, not only `client`. This makes a
temporary dark-path change to scope, follower status, or revision visible at
the emission where it happened, even if a later transition restores the final
state. The snapshot helper is typed as the whole state interface, so a future
field added to that interface requires this test to capture it before the test
can compile.
