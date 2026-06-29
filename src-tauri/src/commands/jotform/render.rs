//! Render Jotform submissions into searchable text records.

use crate::commands::jotform::model::{JotformAnswer, JotformSubmission};

fn append_line(buf: &mut String, label: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    buf.push_str(label);
    buf.push_str(": ");
    buf.push_str(value);
    buf.push('\n');
}

pub fn submission_source_id(form_id: &str, submission_id: &str) -> String {
    format!("jotform:{form_id}:{submission_id}")
}

pub fn render_submission(form_title: &str, submission: &JotformSubmission) -> (String, String) {
    let source_id = submission_source_id(&submission.form_id, &submission.id);
    let mut text = String::new();
    text.push_str("Jotform intake submission\n");
    append_line(&mut text, "Form", form_title);
    append_line(&mut text, "Form id", &submission.form_id);
    append_line(&mut text, "Submission id", &submission.id);
    append_line(&mut text, "Created", &submission.created_at);
    append_line(&mut text, "Updated", &submission.updated_at);
    append_line(&mut text, "Status", &submission.status);

    let answers = sorted_answers(submission);
    if !answers.is_empty() {
        text.push_str("Answers:\n");
        for answer in answers {
            let question = answer_label(answer);
            let value = answer_value(answer);
            if question.is_empty() && value.is_empty() {
                continue;
            }
            if question.is_empty() {
                text.push_str("- ");
                text.push_str(&value);
            } else if value.is_empty() {
                text.push_str("- ");
                text.push_str(&question);
            } else {
                text.push_str("- ");
                text.push_str(&question);
                text.push_str(": ");
                text.push_str(&value);
            }
            text.push('\n');
        }
    }

    (source_id, text)
}

pub fn answer_label(answer: &JotformAnswer) -> String {
    let text = answer.text.trim();
    if !text.is_empty() {
        return text.to_string();
    }
    answer.name.trim().to_string()
}

pub fn answer_value(answer: &JotformAnswer) -> String {
    stringify_answer_value(&answer.answer)
}

pub fn stringify_answer_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => String::new(),
        serde_json::Value::Bool(v) => v.to_string(),
        serde_json::Value::Number(v) => v.to_string(),
        serde_json::Value::String(v) => v.trim().to_string(),
        serde_json::Value::Array(items) => items
            .iter()
            .map(stringify_answer_value)
            .filter(|s| !s.trim().is_empty())
            .collect::<Vec<_>>()
            .join(", "),
        serde_json::Value::Object(map) => {
            let mut parts = Vec::new();
            for (key, value) in map {
                let rendered = stringify_answer_value(value);
                if rendered.trim().is_empty() {
                    continue;
                }
                parts.push(format!("{key}: {rendered}"));
            }
            parts.join(", ")
        }
    }
}

fn sorted_answers(submission: &JotformSubmission) -> Vec<&JotformAnswer> {
    submission.answers.values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::jotform::model::JotformSubmission;

    #[test]
    fn renders_question_answer_pairs_from_submission_json() {
        let json = r#"{
          "id": "sub-1",
          "formID": "form-9",
          "created_at": "2026-06-27 10:15:00",
          "answers": {
            "1": { "text": "Full Name", "type": "control_fullname", "answer": { "first": "Avery", "last": "Stone" } },
            "2": { "text": "Email", "type": "control_email", "answer": "avery@example.com" },
            "3": { "text": "Primary concern", "type": "control_textarea", "answer": "I need help with rollover risk." }
          }
        }"#;
        let submission: JotformSubmission = serde_json::from_str(json).unwrap();

        let (source_id, text) = render_submission("New client intake", &submission);

        assert_eq!(source_id, "jotform:form-9:sub-1");
        assert!(text.contains("Jotform intake submission"));
        assert!(text.contains("Form: New client intake"));
        assert!(text.contains("Full Name: first: Avery, last: Stone"));
        assert!(text.contains("Email: avery@example.com"));
        assert!(text.contains("Primary concern: I need help with rollover risk."));
    }
}
