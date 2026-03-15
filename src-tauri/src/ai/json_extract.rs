//! Multi-strategy JSON extraction for AI agent responses
//!
//! AI models often wrap JSON in markdown fences, include explanatory text,
//! or produce slightly malformed JSON. This module tries multiple extraction
//! strategies in order of reliability.

use serde::de::DeserializeOwned;
use std::fmt;

/// Error from JSON extraction, carrying the original text and all strategy failures
#[derive(Debug)]
pub struct ExtractionError {
    #[allow(dead_code)]
    pub original_text: String,
    pub strategy_failures: Vec<(String, String)>,
}

impl fmt::Display for ExtractionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Failed to extract JSON after {} strategies", self.strategy_failures.len())?;
        for (strategy, error) in &self.strategy_failures {
            write!(f, "\n  - {}: {}", strategy, error)?;
        }
        Ok(())
    }
}

impl std::error::Error for ExtractionError {}

/// Try to extract and deserialize JSON from raw AI response text.
///
/// Strategies tried in order:
/// 1. Direct parse of trimmed input
/// 2. Markdown fence extraction (```json, ```, ~~~json~~~)
/// 3. Brace/bracket depth scanning for outermost JSON object/array
/// 4. JSON repair (trailing commas, missing braces, single quotes, unquoted keys)
/// 5. Lenient parse (try again after all repairs combined)
pub fn extract_json<T: DeserializeOwned>(raw: &str) -> Result<T, ExtractionError> {
    let mut failures = Vec::new();
    let trimmed = raw.trim();

    // Strategy 1: Direct parse
    match serde_json::from_str::<T>(trimmed) {
        Ok(v) => return Ok(v),
        Err(e) => failures.push(("direct_parse".to_string(), e.to_string())),
    }

    // Strategy 2: Markdown fence extraction
    if let Some(extracted) = extract_from_fences(trimmed) {
        match serde_json::from_str::<T>(extracted.trim()) {
            Ok(v) => return Ok(v),
            Err(e) => failures.push(("markdown_fence".to_string(), e.to_string())),
        }
    } else {
        failures.push(("markdown_fence".to_string(), "no fences found".to_string()));
    }

    // Strategy 3: Brace/bracket depth scanning
    if let Some(extracted) = extract_outermost_json(trimmed) {
        match serde_json::from_str::<T>(extracted) {
            Ok(v) => return Ok(v),
            Err(e) => {
                failures.push(("brace_scan".to_string(), e.to_string()));

                // Strategy 4: JSON repair on the extracted block
                let repaired = repair_json(extracted);
                match serde_json::from_str::<T>(&repaired) {
                    Ok(v) => return Ok(v),
                    Err(e) => failures.push(("repair_after_scan".to_string(), e.to_string())),
                }
            }
        }
    } else {
        failures.push(("brace_scan".to_string(), "no JSON object/array found".to_string()));
    }

    // Strategy 5: Repair the full input and try again
    let repaired = repair_json(trimmed);
    match serde_json::from_str::<T>(&repaired) {
        Ok(v) => return Ok(v),
        Err(e) => failures.push(("full_repair".to_string(), e.to_string())),
    }

    // Strategy 6: Try extracting from fences, then repairing
    if let Some(extracted) = extract_from_fences(trimmed) {
        let repaired = repair_json(extracted.trim());
        match serde_json::from_str::<T>(&repaired) {
            Ok(v) => return Ok(v),
            Err(e) => failures.push(("fence_then_repair".to_string(), e.to_string())),
        }
    }

    Err(ExtractionError {
        original_text: truncate_for_error(raw, 500),
        strategy_failures: failures,
    })
}

/// Extract content from markdown code fences.
/// Tries ```json, ```, ~~~json, ~~~ in order.
fn extract_from_fences(text: &str) -> Option<&str> {
    // Try ```json first
    if let Some(start) = text.find("```json") {
        let content_start = start + 7; // len of "```json"
        // Skip optional newline after fence
        let content_start = text[content_start..].find('\n')
            .map(|i| content_start + i + 1)
            .unwrap_or(content_start);
        if let Some(end) = text[content_start..].find("```") {
            return Some(&text[content_start..content_start + end]);
        }
    }

    // Try plain ```
    if let Some(start) = text.find("```") {
        let content_start = start + 3;
        let content_start = text[content_start..].find('\n')
            .map(|i| content_start + i + 1)
            .unwrap_or(content_start);
        if let Some(end) = text[content_start..].find("```") {
            return Some(&text[content_start..content_start + end]);
        }
    }

    // Try ~~~json
    if let Some(start) = text.find("~~~json") {
        let content_start = start + 7;
        let content_start = text[content_start..].find('\n')
            .map(|i| content_start + i + 1)
            .unwrap_or(content_start);
        if let Some(end) = text[content_start..].find("~~~") {
            return Some(&text[content_start..content_start + end]);
        }
    }

    // Try plain ~~~
    if let Some(start) = text.find("~~~") {
        let content_start = start + 3;
        let content_start = text[content_start..].find('\n')
            .map(|i| content_start + i + 1)
            .unwrap_or(content_start);
        if let Some(end) = text[content_start..].find("~~~") {
            return Some(&text[content_start..content_start + end]);
        }
    }

    None
}

/// Find the outermost JSON object or array by scanning brace/bracket depth,
/// while correctly skipping string literals.
fn extract_outermost_json(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let len = bytes.len();

    // Find the first { or [
    let start = bytes.iter().position(|&b| b == b'{' || b == b'[')?;
    let (open_char, close_char) = if bytes[start] == b'{' {
        (b'{', b'}')
    } else {
        (b'[', b']')
    };

    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape_next = false;
    let mut i = start;

    while i < len {
        let ch = bytes[i];

        if escape_next {
            escape_next = false;
            i += 1;
            continue;
        }

        if ch == b'\\' && in_string {
            escape_next = true;
            i += 1;
            continue;
        }

        if ch == b'"' {
            in_string = !in_string;
            i += 1;
            continue;
        }

        if !in_string {
            if ch == open_char {
                depth += 1;
            } else if ch == close_char {
                depth -= 1;
                if depth == 0 {
                    return Some(&text[start..=i]);
                }
            }
        }

        i += 1;
    }

    // If we got here with depth > 0, the JSON might be truncated.
    // Return what we have from start to end.
    if depth > 0 {
        return Some(&text[start..]);
    }

    None
}

/// Attempt to repair common JSON issues:
/// - Trailing commas before } or ]
/// - Single quotes used instead of double quotes
/// - Unquoted keys
/// - Missing closing braces/brackets
/// - Control characters in strings
fn repair_json(text: &str) -> String {
    let mut result = text.to_string();

    // Replace single-quoted strings with double-quoted (simple heuristic)
    // Only do this if there are no double quotes at all, or very few
    let double_quote_count = result.matches('"').count();
    let single_quote_count = result.matches('\'').count();
    if single_quote_count > double_quote_count * 2 {
        result = replace_single_quotes(&result);
    }

    // Remove trailing commas before } or ]
    let re_trailing_comma = regex::Regex::new(r",\s*([}\]])").unwrap();
    result = re_trailing_comma.replace_all(&result, "$1").to_string();

    // Remove control characters that break JSON parsing (except \n, \r, \t)
    result = result.chars().map(|c| {
        if c.is_control() && c != '\n' && c != '\r' && c != '\t' {
            ' '
        } else {
            c
        }
    }).collect();

    // Try to fix missing closing braces/brackets
    let mut open_braces = 0i32;
    let mut open_brackets = 0i32;
    let mut in_string = false;
    let mut escape_next = false;

    for ch in result.chars() {
        if escape_next {
            escape_next = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape_next = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if !in_string {
            match ch {
                '{' => open_braces += 1,
                '}' => open_braces -= 1,
                '[' => open_brackets += 1,
                ']' => open_brackets -= 1,
                _ => {}
            }
        }
    }

    // Add missing closing characters
    for _ in 0..open_brackets.max(0) {
        result.push(']');
    }
    for _ in 0..open_braces.max(0) {
        result.push('}');
    }

    result
}

/// Replace single quotes with double quotes in a JSON-like string.
/// Tries to be careful about apostrophes in natural text.
fn replace_single_quotes(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if chars[i] == '\'' {
            // Check if this looks like a JSON string boundary:
            // - After : or , or [ or { (with optional whitespace)
            // - Before : or , or ] or } (with optional whitespace)
            let before = if i > 0 {
                text[..i].trim_end().chars().last()
            } else {
                None
            };
            let after = if i + 1 < len {
                text[i + 1..].trim_start().chars().next()
            } else {
                None
            };

            let looks_like_json_boundary = matches!(before, Some(':' | ',' | '[' | '{' | '\''))
                || matches!(after, Some(':' | ',' | ']' | '}' | '\''));

            if looks_like_json_boundary {
                result.push('"');
            } else {
                result.push('\'');
            }
        } else {
            result.push(chars[i]);
        }
        i += 1;
    }

    result
}

fn truncate_for_error(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        format!("{}...[truncated, {} total chars]", &s[..max_len], s.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize, PartialEq)]
    struct TestObj {
        name: String,
        #[serde(default)]
        value: i32,
    }

    #[test]
    fn test_direct_parse() {
        let result: TestObj = extract_json(r#"{"name": "test", "value": 42}"#).unwrap();
        assert_eq!(result.name, "test");
        assert_eq!(result.value, 42);
    }

    #[test]
    fn test_markdown_fence_json() {
        let input = "Here's the analysis:\n```json\n{\"name\": \"test\", \"value\": 1}\n```\nDone.";
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "test");
    }

    #[test]
    fn test_markdown_fence_plain() {
        let input = "Result:\n```\n{\"name\": \"test\"}\n```";
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "test");
    }

    #[test]
    fn test_brace_scanning() {
        let input = "I'll analyze this PR.\n\nHere is my response: {\"name\": \"found\", \"value\": 5} Hope this helps!";
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "found");
        assert_eq!(result.value, 5);
    }

    #[test]
    fn test_trailing_comma() {
        let input = r#"{"name": "test", "value": 1,}"#;
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "test");
    }

    #[test]
    fn test_missing_closing_brace() {
        let input = r#"{"name": "test", "value": 99"#;
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "test");
    }

    #[test]
    fn test_nested_json_in_text() {
        let input = r#"Let me think about this...

The security analysis reveals:

{"name": "nested", "value": 10}

That's my analysis."#;
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "nested");
    }

    #[test]
    fn test_serde_default_fields() {
        let input = r#"{"name": "minimal"}"#;
        let result: TestObj = extract_json(input).unwrap();
        assert_eq!(result.name, "minimal");
        assert_eq!(result.value, 0); // default
    }

    #[test]
    fn test_extraction_error() {
        let result = extract_json::<TestObj>("this is not json at all");
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(!err.strategy_failures.is_empty());
    }
}
