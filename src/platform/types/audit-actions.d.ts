/**
 * Shared inventory of durable audit action ids.
 *
 * This declaration intentionally lives in platform/types rather than the
 * audit screen's registry. Platform code and focused contract projects use
 * AuditActionType without loading UI feature modules, so the closed action
 * vocabulary must be present in every TypeScript configuration.
 */
export {};

declare module '@/platform/types/audit' {
  interface AuditActionMap {
    file_create: true;
    file_update: true;
    file_delete: true;
    file_move: true;
    file_rename: true;
    file_export: true;
    workflow_start: true;
    workflow_complete: true;
    workflow_fail: true;
    model_call: true;
    prompt_preparation: true;
    context_compressed: true;
    user_action: true;
    retrieval_executed: true;
    citation_verified: true;
    privilege_evaluated: true;
    scope_active: true;
    egress: true;
    network_egress: true;
    mcp_blocked: true;
    mcp_list: true;
    mcp_read: true;
    mcp_search: true;
    mcp_write_requested: true;
    mcp_write_approved: true;
    mcp_write_denied: true;
    mcp_matter_access_granted: true;
    mcp_matter_access_revoked: true;
    matter_shared: true;
    matter_unshared: true;
    member_invited: true;
    member_removed: true;
    wall_set_from_manager: true;
    key_published: true;
    seat_revoked: true;
    'wealthbox.connect': true;
    'wealthbox.sync': true;
    'wealthbox.disconnect': true;
    'onedrive.sync': true;
    'mail.sync': true;
    'box.sync': true;
    'calendly.sync': true;
    'calendar.sync': true;
    'addepar.sync': true;
    'salesforce.connect': true;
    'salesforce.sync': true;
    'salesforce.disconnect': true;
    'email.send': true;
    'email.draft_saved': true;
    intake_nudge: true;
    intake_email_reply: true;
    intake_doc_extraction: true;
    external_export_consent: true;
    'acats.approve': true;
    'acats.export': true;
    template_installed_from_marketplace: true;
    template_uninstalled: true;
    template_updated: true;
    template_install_failed: true;
    beneficiary_finding_dismissed: true;
    client_map_bullet_added: true;
    client_map_bullet_edited: true;
    client_map_bullet_removed: true;
    client_map_section_removed: true;
    voiceprint_enrolled: true;
    voiceprint_consent: true;
    voiceprint_deleted: true;
    retention_delete: true;
    retention_swept: true;
    meeting_redaction: true;
    meeting_capture_started: true;
    meeting_auto_join_started: true;
    meeting_recorded: true;
    meeting_audio_deleted: true;
    audit_integrity_reseal: true;
    'redtail.connect': true;
    'redtail.sync': true;
    'redtail.disconnect': true;
    'salesforce.connect_cancelled': true;
    'wealthbox.create_note': true;
    'wealthbox.create_task': true;
    'wealthbox.field_updated': true;
  }
}
