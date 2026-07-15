# Command-results correction

The prior version of this note incorrectly said the full gate was red only for
environment resources. That was not true: this branch also had lint failures in
the CRM Home registry test and the Internal projects surface. The Piper sidecar
gap was environmental, but it was not the only red condition.

This note deliberately does not preserve a stale pass/fail summary. The final
verification is run again after the corrective commit, and its exact results are
reported with that commit's handoff.
