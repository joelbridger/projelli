# AttachmentService

Foundation skeleton for v2.0 Stream A (chat attachments: multimodal + PDF).

## Status

- `save(bytes, fileName, mimeType)` working with hash-dedup. Tested.
- `read(att)` working. Tested.
- `delete(att)` working. Tested.
- `exists(att)` working. Tested.

Limited to `image/png|jpeg|gif|webp` and `application/pdf` MIME types.

## Storage convention

`media/YYYY-MM/chat-<type>-<hash>.<ext>`

Same convention as existing image-paste in editor.

## Stream A integrates

- Chat input UI: paperclip / paste / drag-drop. On attach, calls `save()`.
- Provider message formatting: each provider implements `formatAttachmentForRequest(att, bytes)` using its API shape.
- Audit logging: emit `attachment_added` on save; `attachment_sent_to_provider` on send.

## Example

```typescript
const svc = new AttachmentService(workspaceService.fs);
const bytes = new Uint8Array(/* image bytes */);
const att = await svc.save(bytes, 'chart.png', 'image/png');
// att.id = SHA-256 hash
// att.pathInWorkspace = 'media/2026-04/chat-image-<hash>.png'
```
