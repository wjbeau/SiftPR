//! Tool format conversion for different AI providers
//!
//! Each AI provider has a different format for tool definitions and tool calls.
//! This module provides the abstraction to convert between our internal format
//! and provider-specific formats.

use super::{ToolCall, ToolDefinition, ToolResult};
use serde_json::json;

/// Trait for converting tool definitions to/from provider-specific formats
pub trait ToolFormatter: Send + Sync {
    /// Format tool definitions for the provider's API request
    fn format_tools(&self, tools: &[ToolDefinition]) -> serde_json::Value;

    /// Parse tool calls from the provider's API response
    fn parse_tool_calls(&self, response: &serde_json::Value) -> Vec<ToolCall>;

    /// Format tool results for the continuation request
    fn format_tool_results(
        &self,
        results: &[ToolResult],
        assistant_response: &serde_json::Value,
    ) -> serde_json::Value;

    /// Check if the response contains tool calls
    fn has_tool_calls(&self, response: &serde_json::Value) -> bool;

    /// Extract the final text response (after all tool calls complete)
    fn extract_final_response(&self, response: &serde_json::Value) -> Option<String>;

    /// Get the provider name
    fn provider_name(&self) -> &'static str;
}

/// OpenAI tool format implementation
pub struct OpenAIFormatter;

impl ToolFormatter for OpenAIFormatter {
    fn provider_name(&self) -> &'static str {
        "openai"
    }

    fn format_tools(&self, tools: &[ToolDefinition]) -> serde_json::Value {
        json!(tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    }
                })
            })
            .collect::<Vec<_>>())
    }

    fn parse_tool_calls(&self, response: &serde_json::Value) -> Vec<ToolCall> {
        let mut calls = Vec::new();

        // OpenAI format: response.choices[0].message.tool_calls
        if let Some(choices) = response.get("choices").and_then(|c| c.as_array()) {
            if let Some(choice) = choices.first() {
                if let Some(tool_calls) = choice
                    .get("message")
                    .and_then(|m| m.get("tool_calls"))
                    .and_then(|tc| tc.as_array())
                {
                    for tc in tool_calls {
                        if let (Some(id), Some(function)) =
                            (tc.get("id").and_then(|i| i.as_str()), tc.get("function"))
                        {
                            let name = function
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string();
                            let arguments = function
                                .get("arguments")
                                .and_then(|a| a.as_str())
                                .and_then(|s| serde_json::from_str(s).ok())
                                .unwrap_or(json!({}));

                            calls.push(ToolCall {
                                id: id.to_string(),
                                name,
                                arguments,
                            });
                        }
                    }
                }
            }
        }

        calls
    }

    fn format_tool_results(
        &self,
        results: &[ToolResult],
        _assistant_response: &serde_json::Value,
    ) -> serde_json::Value {
        // OpenAI expects tool results as separate messages with role: "tool"
        json!(results
            .iter()
            .map(|r| {
                json!({
                    "role": "tool",
                    "tool_call_id": r.call_id,
                    "content": if r.success {
                        r.output.clone()
                    } else {
                        format!("Error: {}", r.error.as_deref().unwrap_or("Unknown error"))
                    }
                })
            })
            .collect::<Vec<_>>())
    }

    fn has_tool_calls(&self, response: &serde_json::Value) -> bool {
        response
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("tool_calls"))
            .and_then(|tc| tc.as_array())
            .map(|tc| !tc.is_empty())
            .unwrap_or(false)
    }

    fn extract_final_response(&self, response: &serde_json::Value) -> Option<String> {
        response
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("message"))
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .map(|s| s.to_string())
    }
}

/// Anthropic tool format implementation
pub struct AnthropicFormatter;

impl ToolFormatter for AnthropicFormatter {
    fn provider_name(&self) -> &'static str {
        "anthropic"
    }

    fn format_tools(&self, tools: &[ToolDefinition]) -> serde_json::Value {
        json!(tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters
                })
            })
            .collect::<Vec<_>>())
    }

    fn parse_tool_calls(&self, response: &serde_json::Value) -> Vec<ToolCall> {
        let mut calls = Vec::new();

        // Anthropic format: response.content[] where type == "tool_use"
        if let Some(content) = response.get("content").and_then(|c| c.as_array()) {
            for block in content {
                if block.get("type").and_then(|t| t.as_str()) == Some("tool_use") {
                    if let (Some(id), Some(name)) = (
                        block.get("id").and_then(|i| i.as_str()),
                        block.get("name").and_then(|n| n.as_str()),
                    ) {
                        let arguments = block.get("input").cloned().unwrap_or(json!({}));
                        calls.push(ToolCall {
                            id: id.to_string(),
                            name: name.to_string(),
                            arguments,
                        });
                    }
                }
            }
        }

        calls
    }

    fn format_tool_results(
        &self,
        results: &[ToolResult],
        _assistant_response: &serde_json::Value,
    ) -> serde_json::Value {
        // Anthropic expects tool results as content blocks with type: "tool_result"
        json!(results
            .iter()
            .map(|r| {
                json!({
                    "type": "tool_result",
                    "tool_use_id": r.call_id,
                    "content": if r.success {
                        r.output.clone()
                    } else {
                        format!("Error: {}", r.error.as_deref().unwrap_or("Unknown error"))
                    },
                    "is_error": !r.success
                })
            })
            .collect::<Vec<_>>())
    }

    fn has_tool_calls(&self, response: &serde_json::Value) -> bool {
        // Check if stop_reason is "tool_use" or if content contains tool_use blocks
        if response.get("stop_reason").and_then(|r| r.as_str()) == Some("tool_use") {
            return true;
        }

        response
            .get("content")
            .and_then(|c| c.as_array())
            .map(|content| {
                content
                    .iter()
                    .any(|block| block.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
            })
            .unwrap_or(false)
    }

    fn extract_final_response(&self, response: &serde_json::Value) -> Option<String> {
        // Extract text blocks from content
        response
            .get("content")
            .and_then(|c| c.as_array())
            .map(|content| {
                content
                    .iter()
                    .filter_map(|block| {
                        if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                            block.get("text").and_then(|t| t.as_str())
                        } else {
                            None
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("")
            })
            .filter(|s| !s.is_empty())
    }
}

/// Google/Gemini tool format implementation
pub struct GoogleFormatter;

impl ToolFormatter for GoogleFormatter {
    fn provider_name(&self) -> &'static str {
        "google"
    }

    fn format_tools(&self, tools: &[ToolDefinition]) -> serde_json::Value {
        json!([{
            "function_declarations": tools.iter().map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters
                })
            }).collect::<Vec<_>>()
        }])
    }

    fn parse_tool_calls(&self, response: &serde_json::Value) -> Vec<ToolCall> {
        let mut calls = Vec::new();

        // Google format: response.candidates[0].content.parts[] where functionCall exists
        if let Some(candidates) = response.get("candidates").and_then(|c| c.as_array()) {
            if let Some(candidate) = candidates.first() {
                if let Some(parts) = candidate
                    .get("content")
                    .and_then(|c| c.get("parts"))
                    .and_then(|p| p.as_array())
                {
                    for (index, part) in parts.iter().enumerate() {
                        if let Some(function_call) = part.get("functionCall") {
                            let name = function_call
                                .get("name")
                                .and_then(|n| n.as_str())
                                .unwrap_or("")
                                .to_string();
                            let arguments = function_call.get("args").cloned().unwrap_or(json!({}));

                            // Google doesn't provide tool call IDs, so we generate one
                            calls.push(ToolCall {
                                id: format!("call_{}", index),
                                name,
                                arguments,
                            });
                        }
                    }
                }
            }
        }

        calls
    }

    fn format_tool_results(
        &self,
        results: &[ToolResult],
        _assistant_response: &serde_json::Value,
    ) -> serde_json::Value {
        // Google expects functionResponse parts
        json!({
            "parts": results.iter().map(|r| {
                json!({
                    "functionResponse": {
                        "name": r.call_id.replace("call_", ""), // Name, not ID for Google
                        "response": {
                            "result": if r.success {
                                serde_json::from_str::<serde_json::Value>(&r.output)
                                    .unwrap_or(json!({"output": r.output}))
                            } else {
                                json!({"error": r.error.as_deref().unwrap_or("Unknown error")})
                            }
                        }
                    }
                })
            }).collect::<Vec<_>>()
        })
    }

    fn has_tool_calls(&self, response: &serde_json::Value) -> bool {
        response
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
            .map(|parts| parts.iter().any(|p| p.get("functionCall").is_some()))
            .unwrap_or(false)
    }

    fn extract_final_response(&self, response: &serde_json::Value) -> Option<String> {
        response
            .get("candidates")
            .and_then(|c| c.as_array())
            .and_then(|c| c.first())
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
            .and_then(|parts| {
                parts
                    .iter()
                    .find_map(|p| p.get("text").and_then(|t| t.as_str()))
            })
            .map(|s| s.to_string())
    }
}

/// OpenRouter uses OpenAI format
pub type OpenRouterFormatter = OpenAIFormatter;

/// Get the appropriate formatter for a provider
pub fn get_formatter(provider: &str) -> Box<dyn ToolFormatter> {
    match provider {
        "openai" | "openrouter" | "openai-compatible" | "lmstudio" | "ollama" => {
            Box::new(OpenAIFormatter)
        }
        "anthropic" => Box::new(AnthropicFormatter),
        "google" => Box::new(GoogleFormatter),
        _ => Box::new(OpenAIFormatter), // Default to OpenAI format
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_tools() -> Vec<ToolDefinition> {
        vec![ToolDefinition {
            name: "search_repo".to_string(),
            description: "Search for patterns in the repository".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "pattern": {"type": "string", "description": "Regex pattern"}
                },
                "required": ["pattern"]
            }),
            source: super::super::ToolSource::Builtin,
        }]
    }

    #[test]
    fn test_openai_format_tools() {
        let formatter = OpenAIFormatter;
        let tools = sample_tools();
        let formatted = formatter.format_tools(&tools);

        assert!(formatted.is_array());
        let arr = formatted.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "function");
        assert_eq!(arr[0]["function"]["name"], "search_repo");
    }

    #[test]
    fn test_anthropic_format_tools() {
        let formatter = AnthropicFormatter;
        let tools = sample_tools();
        let formatted = formatter.format_tools(&tools);

        assert!(formatted.is_array());
        let arr = formatted.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["name"], "search_repo");
        assert!(arr[0].get("input_schema").is_some());
    }

    #[test]
    fn test_google_format_tools() {
        let formatter = GoogleFormatter;
        let tools = sample_tools();
        let formatted = formatter.format_tools(&tools);

        assert!(formatted.is_array());
        let arr = formatted.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert!(arr[0].get("function_declarations").is_some());
    }

    #[test]
    fn test_openai_parse_tool_calls() {
        let formatter = OpenAIFormatter;
        let response = json!({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "call_123",
                        "function": {
                            "name": "search_repo",
                            "arguments": "{\"pattern\": \"TODO\"}"
                        }
                    }]
                }
            }]
        });

        let calls = formatter.parse_tool_calls(&response);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_123");
        assert_eq!(calls[0].name, "search_repo");
        assert_eq!(calls[0].arguments["pattern"], "TODO");
    }

    #[test]
    fn test_anthropic_parse_tool_calls() {
        let formatter = AnthropicFormatter;
        let response = json!({
            "content": [{
                "type": "tool_use",
                "id": "toolu_123",
                "name": "search_repo",
                "input": {"pattern": "TODO"}
            }]
        });

        let calls = formatter.parse_tool_calls(&response);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "toolu_123");
        assert_eq!(calls[0].name, "search_repo");
        assert_eq!(calls[0].arguments["pattern"], "TODO");
    }
}
