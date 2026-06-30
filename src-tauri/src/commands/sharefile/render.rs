use crate::commands::sharefile::model::{is_pending_pdf, is_supported_office_or_text};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RenderedDocument {
    Text(String),
    PendingPdf,
    Unsupported,
}

pub fn downloaded_document_bytes_to_text(
    filename: &str,
    bytes: &[u8],
) -> anyhow::Result<RenderedDocument> {
    let lower = filename.to_ascii_lowercase();
    if !is_supported_office_or_text(&lower) {
        return Ok(if is_pending_pdf(&lower) {
            RenderedDocument::PendingPdf
        } else {
            RenderedDocument::Unsupported
        });
    }

    let ext = lower.rsplit_once('.').map(|(_, ext)| ext).unwrap_or("");
    let text = match ext {
        "docx" => lantern_docx::parse_docx_bytes(bytes)
            .map(|doc| lantern_docx::extract_paragraph_texts(&doc).join("\n\n"))
            .map_err(anyhow::Error::from)?,
        "xlsx" => crate::commands::rag::office::extract_xlsx_sections(bytes)?
            .into_iter()
            .map(|s| format!("Sheet {} - {}\n{}", s.number, s.label, s.text))
            .collect::<Vec<_>>()
            .join("\n\n"),
        "pptx" => crate::commands::rag::office::extract_pptx_sections(bytes)?
            .into_iter()
            .map(|s| format!("Slide {} - {}\n{}", s.number, s.label, s.text))
            .collect::<Vec<_>>()
            .join("\n\n"),
        "rtf" => crate::commands::rag::office::extract_rtf_text(bytes)?,
        "txt" | "text" | "md" | "markdown" => String::from_utf8(bytes.to_vec())
            .map_err(|_| anyhow::anyhow!("downloaded text document is not valid UTF-8"))?,
        _ => return Ok(RenderedDocument::Unsupported),
    };

    Ok(RenderedDocument::Text(text))
}
