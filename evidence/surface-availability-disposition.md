# Surface availability: existing flag disposition

`shared-client-bar` and `v1-shell-frame` remain deferred from this registry
seam. They choose shell chrome (the shared client bar and the whole v1 frame),
not an `AppSurfaceDescriptor` top-level destination. Moving either into the
surface registry would require changing their owning shell mounts, which is
outside this lane's grant.

For a future top-level surface, its availability flag belongs in
`AppSurfaceDescriptor.availabilityFlag`. It must not also be checked by an
ad-hoc `useFlag` gate at a router or shell mount. One surface gets one
availability decision: registry filtering and tri-state resolution.
