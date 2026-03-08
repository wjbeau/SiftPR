use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::github::GitHubFile;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRAnalysis {
    pub summary: String,
    pub risk_level: String,
    pub categories: Vec<PRCategory>,
    pub key_changes: Vec<KeyChange>,
    pub suggested_review_order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PRCategory {
    pub name: String,
    pub description: String,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyChange {
    pub file: String,
    pub line: Option<i64>,
    pub description: String,
    pub importance: String,
}

pub struct AIClient {
    client: reqwest::Client,
}

impl AIClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// Analyze a PR using the specified AI provider
    pub async fn analyze_pr(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files: &[GitHubFile],
    ) -> AppResult<PRAnalysis> {
        // Build the prompt
        let prompt = build_analysis_prompt(pr_title, pr_body, files);

        // Call the appropriate provider
        let response = match provider {
            "openai" => self.call_openai(api_key, model, &prompt).await?,
            "anthropic" => self.call_anthropic(api_key, model, &prompt).await?,
            "openrouter" => self.call_openrouter(api_key, model, &prompt).await?,
            _ => return Err(AppError::AIProvider(format!("Unknown provider: {}", provider))),
        };

        // Parse the response
        parse_analysis_response(&response)
    }

    async fn call_openai(&self, api_key: &str, model: &str, prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct OpenAIResponse {
            choices: Vec<OpenAIChoice>,
        }

        #[derive(Deserialize)]
        struct OpenAIChoice {
            message: OpenAIMessage,
        }

        #[derive(Deserialize)]
        struct OpenAIMessage {
            content: String,
        }

        let response = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&serde_json::json!({
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert code reviewer. Analyze pull requests and provide structured feedback in JSON format."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                "temperature": 0.3,
                "response_format": { "type": "json_object" }
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "OpenAI API error {}: {}",
                status, body
            )));
        }

        let data: OpenAIResponse = response.json().await?;
        data.choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| AppError::AIProvider("No response from OpenAI".to_string()))
    }

    async fn call_anthropic(&self, api_key: &str, model: &str, prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct AnthropicResponse {
            content: Vec<AnthropicContent>,
        }

        #[derive(Deserialize)]
        struct AnthropicContent {
            text: String,
        }

        let response = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&serde_json::json!({
                "model": model,
                "max_tokens": 4096,
                "system": "You are an expert code reviewer. Analyze pull requests and provide structured feedback in JSON format.",
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Anthropic API error {}: {}",
                status, body
            )));
        }

        let data: AnthropicResponse = response.json().await?;
        data.content
            .first()
            .map(|c| c.text.clone())
            .ok_or_else(|| AppError::AIProvider("No response from Anthropic".to_string()))
    }

    async fn call_openrouter(&self, api_key: &str, model: &str, prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct OpenRouterResponse {
            choices: Vec<OpenRouterChoice>,
        }

        #[derive(Deserialize)]
        struct OpenRouterChoice {
            message: OpenRouterMessage,
        }

        #[derive(Deserialize)]
        struct OpenRouterMessage {
            content: String,
        }

        let response = self
            .client
            .post("https://openrouter.ai/api/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("HTTP-Referer", "https://reviewboss.app")
            .json(&serde_json::json!({
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are an expert code reviewer. Analyze pull requests and provide structured feedback in JSON format."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "OpenRouter API error {}: {}",
                status, body
            )));
        }

        let data: OpenRouterResponse = response.json().await?;
        data.choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| AppError::AIProvider("No response from OpenRouter".to_string()))
    }
}

fn build_analysis_prompt(title: &str, body: Option<&str>, files: &[GitHubFile]) -> String {
    let files_summary: String = files
        .iter()
        .map(|f| {
            format!(
                "- {} ({}, +{} -{}){}",
                f.filename,
                f.status,
                f.additions,
                f.deletions,
                f.patch
                    .as_ref()
                    .map(|p| format!("\n```diff\n{}\n```", truncate_patch(p, 500)))
                    .unwrap_or_default()
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        r#"Analyze this pull request and provide a structured review.

## PR Title
{}

## PR Description
{}

## Changed Files
{}

Please respond with a JSON object containing:
{{
  "summary": "Brief 2-3 sentence summary of what this PR does",
  "risk_level": "low" | "medium" | "high",
  "categories": [
    {{
      "name": "Category name (e.g., 'Core Logic', 'UI Changes', 'Tests')",
      "description": "What this category covers",
      "files": ["list", "of", "files"]
    }}
  ],
  "key_changes": [
    {{
      "file": "path/to/file",
      "line": null,
      "description": "What changed and why it matters",
      "importance": "critical" | "important" | "minor"
    }}
  ],
  "suggested_review_order": ["file1.ts", "file2.ts"]
}}

Focus on:
1. Grouping files by logical purpose
2. Identifying the most important changes to review carefully
3. Suggesting an efficient review order (usually: understand context first, then core changes, then tests)
"#,
        title,
        body.unwrap_or("No description provided"),
        files_summary
    )
}

fn truncate_patch(patch: &str, max_lines: usize) -> &str {
    let lines: Vec<&str> = patch.lines().collect();
    if lines.len() <= max_lines {
        patch
    } else {
        // Find the byte position after max_lines
        let end_pos = lines[..max_lines]
            .iter()
            .map(|l| l.len() + 1)
            .sum::<usize>();
        &patch[..end_pos.min(patch.len())]
    }
}

fn parse_analysis_response(response: &str) -> AppResult<PRAnalysis> {
    // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
    let json_str = if response.contains("```json") {
        response
            .split("```json")
            .nth(1)
            .and_then(|s| s.split("```").next())
            .unwrap_or(response)
    } else if response.contains("```") {
        response
            .split("```")
            .nth(1)
            .unwrap_or(response)
    } else {
        response
    };

    serde_json::from_str(json_str.trim())
        .map_err(|e| AppError::AIProvider(format!("Failed to parse AI response: {}", e)))
}
