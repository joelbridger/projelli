use lantern_lib::commands::crm::core_store::CrmCoreStore;
use serde_json::json;

fn manifest() -> serde_json::Value {
    json!({
      "version": "hendricks-review-capability-v1",
      "lineage": "hendricks-sample-capability",
      "staticDigest": "e8d6c5e662def2548d39dc225e6f8beea47fc688da56860e50b3eefbc708fa3a",
      "workspaceRoot": "/sample-workspace",
      "workspaceGeneration": 1,
      "matterId": "matter-hendricks",
      "householdRef": "sample-hendricks-household",
      "meetingId": "canonical-hendricks-meeting",
      "eventId": "sample-hendricks-annual-review",
      "startedAt": "2026-07-02T14:00:00.000Z",
      "endedAt": "2026-07-02T14:42:00.000Z",
      "proposals": [
        {"id":"hendricks-review-task-v1","kind":"task","title":"Confirm beneficiaries","detail":"Confirm beneficiaries","ownerRef":null,"dueDate":null,"transcriptRef":"meeting:sample-hendricks-annual-review:transcript"},
        {"id":"hendricks-review-crm-v1","kind":"crm-update","title":"Record follow-up","detail":"Record follow-up","transcriptRef":"meeting:sample-hendricks-annual-review:transcript","entityRef":"sample-hendricks-household","fields":[{"field":"annualReviewFollowUp","valueType":"text","before":null,"proposed":"Confirm Robert's consulting 401(k) beneficiary designations."}]}
      ]
    })
}

#[test]
fn native_core_seals_only_the_exact_two_hendricks_proposals_and_recovers_the_same_envelope() {
    let directory = tempfile::tempdir().unwrap();
    let store = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
    let first = store.seal_hendricks_review_capability(&manifest()).unwrap();
    let reopened = CrmCoreStore::open_with_key(directory.path(), &[7; 32]).unwrap();
    assert_eq!(
        reopened
            .seal_hendricks_review_capability(&manifest())
            .unwrap(),
        first
    );

    let mut extra = manifest();
    extra["proposals"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"extra"}));
    assert!(reopened.seal_hendricks_review_capability(&extra).is_err());

    let mut cross_client = manifest();
    cross_client["householdRef"] = json!("other-household");
    assert!(reopened
        .seal_hendricks_review_capability(&cross_client)
        .is_err());
}
