use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::github::GitHubFile;

use super::prompts::{build_files_context, truncate_patch};
use super::types::TokenUsage;

/// Response from AI provider including token usage
#[derive(Debug, Clone)]
pub struct AIResponse {
    pub content: String,
    pub token_usage: Option<TokenUsage>,
}

/// Model information returned from providers
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_length: Option<u32>,
    pub description: Option<String>,
}

/// Legacy PR Analysis structure (for backwards compatibility)
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
            client: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(30))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    /// Send an HTTP request with retry logic for transient failures (429, 500, 502, 503, 504).
    /// Uses exponential backoff: 1s, 2s, 4s with max 2 retries.
    /// The `build_request` closure is called on each attempt since `RequestBuilder` isn't Clone.
    async fn send_with_retry<F>(&self, build_request: F) -> Result<reqwest::Response, reqwest::Error>
    where
        F: Fn() -> reqwest::RequestBuilder,
    {
        self.send_with_retry_diag(build_request, None).await
    }

    async fn send_with_retry_diag<F>(
        &self,
        build_request: F,
        _diag: Option<(&super::types::SharedDiagnostics, &str)>,
    ) -> Result<reqwest::Response, reqwest::Error>
    where
        F: Fn() -> reqwest::RequestBuilder,
    {
        let max_retries = 2u32;
        let mut last_response = build_request().send().await?;

        for attempt in 0..max_retries {
            let status = last_response.status().as_u16();
            if status != 429 && status != 500 && status != 502 && status != 503 && status != 504 {
                return Ok(last_response);
            }

            let delay_ms = (1u64 << attempt) * 1000;
            let delay = std::time::Duration::from_millis(delay_ms);
            println!(
                "[AIClient] Retrying after {} error (attempt {}/{}), waiting {:?}",
                status,
                attempt + 1,
                max_retries,
                delay
            );
            if let Some((diag, agent)) = &_diag {
                diag.log(Some(agent), "retry", serde_json::json!({
                    "status_code": status,
                    "attempt": attempt + 1,
                    "delay_ms": delay_ms,
                }));
            }
            tokio::time::sleep(delay).await;
            last_response = build_request().send().await?;
        }

        Ok(last_response)
    }

    /// Analyze a PR using the specified AI provider (legacy method)
    pub async fn analyze_pr(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files: &[GitHubFile],
    ) -> AppResult<PRAnalysis> {
        let prompt = build_legacy_analysis_prompt(pr_title, pr_body, files);
        let system = "You are an expert code reviewer. Analyze pull requests and provide structured feedback in JSON format.";

        let response = self.call_provider(provider, api_key, model, system, &prompt).await?;
        parse_legacy_analysis_response(&response)
    }

    /// Call AI provider with custom system prompt (for agent system)
    pub async fn call_with_system(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        user_prompt: &str,
    ) -> AppResult<String> {
        self.call_provider(provider, api_key, model, system_prompt, user_prompt).await
    }

    /// Call AI provider with tools support
    /// Returns the raw JSON response for tool parsing
    pub async fn call_with_tools(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        messages: &[serde_json::Value],
        tools: &serde_json::Value,
    ) -> AppResult<serde_json::Value> {
        match provider {
            "openai" | "openrouter" => {
                self.call_openai_with_tools(provider, api_key, model, system_prompt, messages, tools).await
            }
            "anthropic" => {
                self.call_anthropic_with_tools(api_key, model, system_prompt, messages, tools).await
            }
            "google" => {
                self.call_google_with_tools(api_key, model, system_prompt, messages, tools).await
            }
            "ollama" | "lmstudio" | "openai-compatible" => {
                // For local providers, use OpenAI-compatible format
                self.call_openai_compatible_with_tools(api_key, model, system_prompt, messages, tools).await
            }
            _ => Err(AppError::AIProvider(format!(
                "Provider {} does not support tool calling",
                provider
            ))),
        }
    }

    async fn call_openai_with_tools(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        messages: &[serde_json::Value],
        tools: &serde_json::Value,
    ) -> AppResult<serde_json::Value> {
        let api_key = api_key.trim();

        let (url, headers) = if provider == "openrouter" {
            (
                "https://openrouter.ai/api/v1/chat/completions".to_string(),
                vec![
                    ("HTTP-Referer", "https://siftpr.app"),
                    ("X-Title", "SiftPR"),
                ],
            )
        } else {
            ("https://api.openai.com/v1/chat/completions".to_string(), vec![])
        };

        // Build messages array with system prompt
        let mut all_messages = vec![serde_json::json!({
            "role": "system",
            "content": system_prompt
        })];
        all_messages.extend(messages.iter().cloned());

        let body = serde_json::json!({
            "model": model,
            "messages": all_messages,
            "tools": tools,
            "temperature": 0.3
        });

        let url_clone = url.clone();
        let api_key_owned = api_key.to_string();
        let headers_owned: Vec<(String, String)> = headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();

        let response = self.send_with_retry(|| {
            let mut req = self.client
                .post(&url_clone)
                .header("Authorization", format!("Bearer {}", api_key_owned));
            for (key, value) in &headers_owned {
                req = req.header(key.as_str(), value.as_str());
            }
            req.json(&body)
        }).await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "API error {}: {}",
                status, body
            )));
        }

        response.json().await.map_err(|e| {
            AppError::AIProvider(format!("Failed to parse response: {}", e))
        })
    }

    async fn call_anthropic_with_tools(
        &self,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        messages: &[serde_json::Value],
        tools: &serde_json::Value,
    ) -> AppResult<serde_json::Value> {
        let api_key = api_key.trim();

        // Convert messages to Anthropic format
        let anthropic_messages: Vec<serde_json::Value> = messages
            .iter()
            .filter_map(|m| {
                let role = m.get("role")?.as_str()?;
                match role {
                    "user" => Some(serde_json::json!({
                        "role": "user",
                        "content": m.get("content")
                    })),
                    "assistant" => Some(m.clone()),
                    "tool" => {
                        // Convert tool results to Anthropic format
                        Some(serde_json::json!({
                            "role": "user",
                            "content": m.get("content")
                        }))
                    }
                    _ => None,
                }
            })
            .collect();

        let body = serde_json::json!({
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": anthropic_messages,
            "tools": tools
        });

        let api_key_owned = api_key.to_string();
        let body_clone = body.clone();

        let response = self.send_with_retry(|| {
            self.client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key_owned)
                .header("anthropic-version", "2023-06-01")
                .json(&body_clone)
        }).await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Anthropic API error {}: {}",
                status, body
            )));
        }

        response.json().await.map_err(|e| {
            AppError::AIProvider(format!("Failed to parse response: {}", e))
        })
    }

    async fn call_google_with_tools(
        &self,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        messages: &[serde_json::Value],
        tools: &serde_json::Value,
    ) -> AppResult<serde_json::Value> {
        let api_key = api_key.trim();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );

        // Convert messages to Google format
        let contents: Vec<serde_json::Value> = messages
            .iter()
            .filter_map(|m| {
                let role = m.get("role")?.as_str()?;
                let google_role = match role {
                    "user" | "tool" => "user",
                    "assistant" | "model" => "model",
                    _ => return None,
                };

                // Check if this message already has structured parts (e.g. functionResponse or model parts)
                if let Some(parts) = m.get("parts") {
                    return Some(serde_json::json!({
                        "role": google_role,
                        "parts": parts
                    }));
                }

                let content = m.get("content")?;
                Some(serde_json::json!({
                    "role": google_role,
                    "parts": [{"text": content}]
                }))
            })
            .collect();

        let body = serde_json::json!({
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "contents": contents,
            "tools": tools,
            "generationConfig": {
                "temperature": 0.3
            }
        });

        let url_clone = url.clone();
        let body_clone = body.clone();

        let response = self.send_with_retry(|| {
            self.client.post(&url_clone).json(&body_clone)
        }).await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Google AI API error {}: {}",
                status, body
            )));
        }

        response.json().await.map_err(|e| {
            AppError::AIProvider(format!("Failed to parse response: {}", e))
        })
    }

    async fn call_openai_compatible_with_tools(
        &self,
        api_key_or_url: &str,
        model: &str,
        system_prompt: &str,
        messages: &[serde_json::Value],
        tools: &serde_json::Value,
    ) -> AppResult<serde_json::Value> {
        let (base_url, api_key) = if api_key_or_url.contains('|') {
            let parts: Vec<&str> = api_key_or_url.splitn(2, '|').collect();
            (parts[0], parts.get(1).copied().unwrap_or(""))
        } else if api_key_or_url.starts_with("http") {
            (api_key_or_url, "")
        } else {
            ("http://localhost:1234", api_key_or_url)
        };

        let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

        let mut all_messages = vec![serde_json::json!({
            "role": "system",
            "content": system_prompt
        })];
        all_messages.extend(messages.iter().cloned());

        let body = serde_json::json!({
            "model": model,
            "messages": all_messages,
            "tools": tools,
            "temperature": 0.3
        });

        let url_clone = url.clone();
        let api_key_owned = api_key.to_string();
        let body_clone = body.clone();

        let response = self.send_with_retry(|| {
            let mut req = self.client.post(&url_clone);
            if !api_key_owned.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", api_key_owned));
            }
            req.json(&body_clone)
        }).await.map_err(|e| {
            AppError::AIProvider(format!("Failed to connect to {}: {}", url, e))
        })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "API error {}: {}",
                status, body
            )));
        }

        response.json().await.map_err(|e| {
            AppError::AIProvider(format!("Failed to parse response: {}", e))
        })
    }

    /// Internal method to route to the appropriate provider
    async fn call_provider(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        user_prompt: &str,
    ) -> AppResult<String> {
        match provider {
            "openai" => self.call_openai(api_key, model, system_prompt, user_prompt).await,
            "anthropic" => self.call_anthropic(api_key, model, system_prompt, user_prompt).await,
            "google" => self.call_google(api_key, model, system_prompt, user_prompt).await,
            "openrouter" => self.call_openrouter(api_key, model, system_prompt, user_prompt).await,
            "ollama" => self.call_ollama(api_key, model, system_prompt, user_prompt).await,
            "lmstudio" => self.call_openai_compatible(api_key, "", model, system_prompt, user_prompt).await,
            "openai-compatible" => {
                let (base_url, actual_key) = if api_key.contains('|') {
                    let parts: Vec<&str> = api_key.splitn(2, '|').collect();
                    (parts[0], *parts.get(1).unwrap_or(&""))
                } else {
                    (api_key, "")
                };
                self.call_openai_compatible(base_url, actual_key, model, system_prompt, user_prompt).await
            }
            _ => Err(AppError::AIProvider(format!("Unknown provider: {}", provider))),
        }
    }

    async fn call_openai(&self, api_key: &str, model: &str, system_prompt: &str, user_prompt: &str) -> AppResult<String> {
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

        let api_key_owned = api_key.to_string();
        let body = serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            "temperature": 0.3,
            "response_format": { "type": "json_object" }
        });

        let response = self.send_with_retry(|| {
            self.client
                .post("https://api.openai.com/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key_owned))
                .json(&body)
        }).await?;

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

    async fn call_anthropic(&self, api_key: &str, model: &str, system_prompt: &str, user_prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct AnthropicResponse {
            content: Vec<AnthropicContent>,
        }

        #[derive(Deserialize)]
        struct AnthropicContent {
            text: String,
        }

        let api_key_owned = api_key.to_string();
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": [
                {
                    "role": "user",
                    "content": user_prompt
                }
            ]
        });

        let response = self.send_with_retry(|| {
            self.client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key_owned)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
        }).await?;

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

    async fn call_openrouter(&self, api_key: &str, model: &str, system_prompt: &str, user_prompt: &str) -> AppResult<String> {
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

        // Trim API key to avoid authentication issues from whitespace
        let api_key_owned = api_key.trim().to_string();

        let body = serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ]
        });

        let response = self.send_with_retry(|| {
            self.client
                .post("https://openrouter.ai/api/v1/chat/completions")
                .header("Authorization", format!("Bearer {}", api_key_owned))
                .header("HTTP-Referer", "https://siftpr.app")
                .header("X-Title", "SiftPR")
                .json(&body)
        }).await?;

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

    async fn call_google(&self, api_key: &str, model: &str, system_prompt: &str, user_prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct GoogleResponse {
            candidates: Vec<GoogleCandidate>,
        }

        #[derive(Deserialize)]
        struct GoogleCandidate {
            content: GoogleContent,
        }

        #[derive(Deserialize)]
        struct GoogleContent {
            parts: Vec<GooglePart>,
        }

        #[derive(Deserialize)]
        struct GooglePart {
            text: String,
        }

        // Trim API key to avoid authentication issues from whitespace
        let api_key = api_key.trim();

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            model, api_key
        );

        let body = serde_json::json!({
            "systemInstruction": {
                "parts": [{ "text": system_prompt }]
            },
            "contents": [
                {
                    "role": "user",
                    "parts": [{ "text": user_prompt }]
                }
            ],
            "generationConfig": {
                "temperature": 0.3,
                "responseMimeType": "application/json"
            }
        });

        let url_clone = url.clone();
        let response = self.send_with_retry(|| {
            self.client.post(&url_clone).json(&body)
        }).await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Google AI API error {}: {}",
                status, body
            )));
        }

        let data: GoogleResponse = response.json().await?;
        data.candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .ok_or_else(|| AppError::AIProvider("No response from Google AI".to_string()))
    }

    async fn call_ollama(&self, base_url: &str, model: &str, system_prompt: &str, user_prompt: &str) -> AppResult<String> {
        #[derive(Deserialize)]
        struct OllamaResponse {
            message: OllamaMessage,
        }

        #[derive(Deserialize)]
        struct OllamaMessage {
            content: String,
        }

        let url = format!("{}/api/chat", base_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            "stream": false,
            "format": "json"
        });

        let url_clone = url.clone();
        let response = self.send_with_retry(|| {
            self.client.post(&url_clone).json(&body)
        }).await
            .map_err(|e| AppError::AIProvider(format!("Failed to connect to Ollama at {}: {}", url, e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Ollama API error {}: {}",
                status, body
            )));
        }

        let data: OllamaResponse = response.json().await?;
        Ok(data.message.content)
    }

    async fn call_openai_compatible(
        &self,
        base_url: &str,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        user_prompt: &str,
    ) -> AppResult<String> {
        #[derive(Deserialize)]
        struct OpenAICompatResponse {
            choices: Vec<OpenAICompatChoice>,
        }

        #[derive(Deserialize)]
        struct OpenAICompatChoice {
            message: OpenAICompatMessage,
        }

        #[derive(Deserialize)]
        struct OpenAICompatMessage {
            content: String,
        }

        let url = format!("{}/v1/chat/completions", base_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt
                },
                {
                    "role": "user",
                    "content": user_prompt
                }
            ],
            "temperature": 0.3
        });

        let url_clone = url.clone();
        let api_key_owned = api_key.to_string();
        let response = self.send_with_retry(|| {
            let mut req = self.client.post(&url_clone).json(&body);
            if !api_key_owned.is_empty() {
                req = req.header("Authorization", format!("Bearer {}", api_key_owned));
            }
            req
        }).await
            .map_err(|e| AppError::AIProvider(format!("Failed to connect to {}: {}", url, e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "API error {}: {}",
                status, body
            )));
        }

        let data: OpenAICompatResponse = response.json().await?;
        data.choices
            .first()
            .map(|c| c.message.content.clone())
            .ok_or_else(|| AppError::AIProvider("No response from API".to_string()))
    }

    /// Fetch available models from a provider
    pub async fn fetch_models(&self, provider: &str, api_key_or_url: &str) -> AppResult<Vec<ModelInfo>> {
        match provider {
            "openai" => self.fetch_openai_models(api_key_or_url).await,
            "anthropic" => self.fetch_anthropic_models(api_key_or_url).await,
            "google" => self.fetch_google_models(api_key_or_url).await,
            "openrouter" => self.fetch_openrouter_models(api_key_or_url).await,
            "ollama" => self.fetch_ollama_models(api_key_or_url).await,
            "lmstudio" => self.fetch_openai_compatible_models(api_key_or_url, "").await,
            "openai-compatible" => {
                let (base_url, actual_key) = if api_key_or_url.contains('|') {
                    let parts: Vec<&str> = api_key_or_url.splitn(2, '|').collect();
                    (parts[0], *parts.get(1).unwrap_or(&""))
                } else {
                    (api_key_or_url, "")
                };
                self.fetch_openai_compatible_models(base_url, actual_key).await
            }
            _ => Err(AppError::AIProvider(format!("Unknown provider: {}", provider))),
        }
    }

    async fn fetch_openai_models(&self, api_key: &str) -> AppResult<Vec<ModelInfo>> {
        #[derive(Deserialize)]
        struct OpenAIModelsResponse {
            data: Vec<OpenAIModel>,
        }

        #[derive(Deserialize)]
        struct OpenAIModel {
            id: String,
        }

        let response = self
            .client
            .get("https://api.openai.com/v1/models")
            .header("Authorization", format!("Bearer {}", api_key))
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

        let data: OpenAIModelsResponse = response.json().await?;

        // Filter to chat models and sort by relevance
        let chat_model_prefixes = ["gpt-4", "gpt-3.5", "o1", "o3", "chatgpt"];
        let mut models: Vec<ModelInfo> = data
            .data
            .into_iter()
            .filter(|m| {
                let id = m.id.to_lowercase();
                chat_model_prefixes.iter().any(|prefix| id.starts_with(prefix))
                    && !id.contains("vision")
                    && !id.contains("audio")
                    && !id.contains("realtime")
                    && !id.contains("embedding")
                    && !id.contains("tts")
                    && !id.contains("whisper")
                    && !id.contains("dall-e")
                    && !id.contains("davinci")
                    && !id.contains("babbage")
                    && !id.contains("instruct")
            })
            .map(|m| ModelInfo {
                id: m.id.clone(),
                name: format_openai_model_name(&m.id),
                provider: "openai".to_string(),
                context_length: get_openai_context_length(&m.id),
                description: None,
            })
            .collect();

        // Sort by model generation/capability
        models.sort_by(|a, b| {
            let a_score = get_openai_model_priority(&a.id);
            let b_score = get_openai_model_priority(&b.id);
            b_score.cmp(&a_score)
        });

        Ok(models)
    }

    async fn fetch_anthropic_models(&self, api_key: &str) -> AppResult<Vec<ModelInfo>> {
        #[derive(Deserialize)]
        struct AnthropicModelsResponse {
            data: Vec<AnthropicModel>,
        }

        #[derive(Deserialize)]
        struct AnthropicModel {
            id: String,
            display_name: String,
        }

        let response = self
            .client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
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

        let data: AnthropicModelsResponse = response.json().await?;

        let mut models: Vec<ModelInfo> = data
            .data
            .into_iter()
            .map(|m| ModelInfo {
                id: m.id.clone(),
                name: m.display_name,
                provider: "anthropic".to_string(),
                context_length: get_anthropic_context_length(&m.id),
                description: None,
            })
            .collect();

        // Sort by model capability (opus > sonnet > haiku)
        models.sort_by(|a, b| {
            let a_score = get_anthropic_model_priority(&a.id);
            let b_score = get_anthropic_model_priority(&b.id);
            b_score.cmp(&a_score)
        });

        Ok(models)
    }

    async fn fetch_google_models(&self, api_key: &str) -> AppResult<Vec<ModelInfo>> {
        #[derive(Deserialize)]
        struct GoogleModelsResponse {
            models: Vec<GoogleModel>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct GoogleModel {
            name: String,
            display_name: Option<String>,
            description: Option<String>,
            input_token_limit: Option<u32>,
            supported_generation_methods: Option<Vec<String>>,
        }

        let api_key = api_key.trim();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models?key={}",
            api_key
        );

        let response = self.client.get(&url).send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Google AI API error {}: {}",
                status, body
            )));
        }

        let data: GoogleModelsResponse = response.json().await?;

        // Filter to models that support generateContent (chat/generation)
        let mut models: Vec<ModelInfo> = data
            .models
            .into_iter()
            .filter(|m| {
                m.supported_generation_methods
                    .as_ref()
                    .map(|methods| methods.iter().any(|method| method == "generateContent"))
                    .unwrap_or(false)
            })
            .map(|m| {
                // Extract model ID from full name (e.g., "models/gemini-2.0-flash" -> "gemini-2.0-flash")
                let id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_string();
                ModelInfo {
                    id: id.clone(),
                    name: m.display_name.unwrap_or_else(|| id.clone()),
                    provider: "google".to_string(),
                    context_length: m.input_token_limit,
                    description: m.description,
                }
            })
            .collect();

        // Sort by model capability
        models.sort_by(|a, b| {
            let a_score = get_google_model_priority(&a.id);
            let b_score = get_google_model_priority(&b.id);
            b_score.cmp(&a_score)
        });

        Ok(models)
    }

    async fn fetch_openrouter_models(&self, api_key: &str) -> AppResult<Vec<ModelInfo>> {
        #[derive(Deserialize)]
        struct OpenRouterModelsResponse {
            data: Vec<OpenRouterModel>,
        }

        #[derive(Deserialize)]
        struct OpenRouterModel {
            id: String,
            name: String,
            context_length: Option<u32>,
            description: Option<String>,
        }

        let api_key = api_key.trim();
        let mut request = self.client.get("https://openrouter.ai/api/v1/models");

        if !api_key.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request.send().await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "OpenRouter API error {}: {}",
                status, body
            )));
        }

        let data: OpenRouterModelsResponse = response.json().await?;

        // Filter to popular/relevant models and sort
        let mut models: Vec<ModelInfo> = data
            .data
            .into_iter()
            .filter(|m| {
                let id = m.id.to_lowercase();
                // Include major providers' chat models
                id.contains("anthropic/claude") ||
                id.contains("openai/gpt") ||
                id.contains("openai/o1") ||
                id.contains("openai/o3") ||
                id.contains("google/gemini") ||
                id.contains("meta-llama/llama") ||
                id.contains("deepseek/") ||
                id.contains("qwen/") ||
                id.contains("mistral")
            })
            .map(|m| ModelInfo {
                id: m.id.clone(),
                name: m.name,
                provider: "openrouter".to_string(),
                context_length: m.context_length,
                description: m.description,
            })
            .collect();

        // Sort by provider then model quality
        models.sort_by(|a, b| {
            let a_score = get_openrouter_model_priority(&a.id);
            let b_score = get_openrouter_model_priority(&b.id);
            b_score.cmp(&a_score)
        });

        // Limit to top 50 most relevant
        models.truncate(50);

        Ok(models)
    }

    async fn fetch_ollama_models(&self, base_url: &str) -> AppResult<Vec<ModelInfo>> {
        #[derive(Deserialize)]
        struct OllamaTagsResponse {
            models: Vec<OllamaModel>,
        }

        #[derive(Deserialize)]
        struct OllamaModel {
            name: String,
            #[serde(default)]
            details: OllamaModelDetails,
        }

        #[derive(Deserialize, Default)]
        struct OllamaModelDetails {
            parameter_size: Option<String>,
        }

        let url = format!("{}/api/tags", base_url.trim_end_matches('/'));

        let response = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::AIProvider(format!("Failed to connect to Ollama at {}: {}", url, e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "Ollama API error {}: {}",
                status, body
            )));
        }

        let data: OllamaTagsResponse = response.json().await?;

        let models: Vec<ModelInfo> = data
            .models
            .into_iter()
            .map(|m| {
                let description = m.details.parameter_size.map(|s| format!("{} parameters", s));
                ModelInfo {
                    id: m.name.clone(),
                    name: m.name,
                    provider: "ollama".to_string(),
                    context_length: None,
                    description,
                }
            })
            .collect();

        Ok(models)
    }

    async fn fetch_openai_compatible_models(&self, base_url: &str, api_key: &str) -> AppResult<Vec<ModelInfo>> {
        #[derive(Deserialize)]
        struct ModelsResponse {
            data: Vec<Model>,
        }

        #[derive(Deserialize)]
        struct Model {
            id: String,
        }

        let url = format!("{}/v1/models", base_url.trim_end_matches('/'));

        let mut request = self.client.get(&url);

        if !api_key.is_empty() {
            request = request.header("Authorization", format!("Bearer {}", api_key));
        }

        let response = request
            .send()
            .await
            .map_err(|e| AppError::AIProvider(format!("Failed to connect to {}: {}", url, e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::AIProvider(format!(
                "API error {}: {}",
                status, body
            )));
        }

        let data: ModelsResponse = response.json().await?;

        let models: Vec<ModelInfo> = data
            .data
            .into_iter()
            .map(|m| ModelInfo {
                id: m.id.clone(),
                name: m.id,
                provider: "openai-compatible".to_string(),
                context_length: None,
                description: None,
            })
            .collect();

        Ok(models)
    }
}

// Helper functions for model formatting and sorting

fn format_openai_model_name(id: &str) -> String {
    // Convert model ID to a more readable name
    let name = id.replace("-", " ").replace("_", " ");
    // Capitalize first letter of each word
    name.split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => first.to_uppercase().chain(chars).collect(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn get_openai_context_length(id: &str) -> Option<u32> {
    if id.contains("gpt-4o") || id.contains("gpt-4-turbo") {
        Some(128000)
    } else if id.contains("gpt-4") {
        Some(8192)
    } else if id.contains("gpt-3.5-turbo") {
        Some(16385)
    } else if id.starts_with("o1") || id.starts_with("o3") {
        Some(128000)
    } else {
        None
    }
}

fn get_openai_model_priority(id: &str) -> u32 {
    if id.starts_with("o3") { 100 }
    else if id.starts_with("o1") && !id.contains("mini") { 95 }
    else if id.starts_with("o1-mini") { 90 }
    else if id.contains("gpt-4o") && !id.contains("mini") { 85 }
    else if id.contains("gpt-4o-mini") { 80 }
    else if id.contains("gpt-4-turbo") { 75 }
    else if id.contains("gpt-4") && !id.contains("turbo") { 70 }
    else if id.contains("gpt-3.5") { 50 }
    else { 10 }
}

fn get_anthropic_context_length(id: &str) -> Option<u32> {
    if id.contains("claude-3") || id.contains("claude-sonnet-4") || id.contains("claude-opus-4") {
        Some(200000)
    } else {
        Some(100000)
    }
}

fn get_anthropic_model_priority(id: &str) -> u32 {
    if id.contains("opus-4") { 100 }
    else if id.contains("sonnet-4") { 95 }
    else if id.contains("claude-3-7-sonnet") { 90 }
    else if id.contains("claude-3-5-sonnet") { 85 }
    else if id.contains("claude-3-opus") { 80 }
    else if id.contains("claude-3-5-haiku") { 75 }
    else if id.contains("haiku") { 70 }
    else { 10 }
}

fn get_google_model_priority(id: &str) -> u32 {
    let id = id.to_lowercase();
    if id.contains("gemini-2.5-pro") { 100 }
    else if id.contains("gemini-2.0-flash-thinking") { 95 }
    else if id.contains("gemini-2.0-flash") { 90 }
    else if id.contains("gemini-2.0") { 85 }
    else if id.contains("gemini-1.5-pro") { 80 }
    else if id.contains("gemini-1.5-flash") { 75 }
    else if id.contains("gemini-pro") { 70 }
    else if id.contains("gemini") { 50 }
    else { 10 }
}

fn get_openrouter_model_priority(id: &str) -> u32 {
    let id = id.to_lowercase();
    if id.contains("anthropic/claude-opus-4") { 100 }
    else if id.contains("anthropic/claude-sonnet-4") { 98 }
    else if id.contains("anthropic/claude-3.7") { 95 }
    else if id.contains("anthropic/claude-3.5-sonnet") { 93 }
    else if id.contains("openai/o3") { 90 }
    else if id.contains("openai/o1") && !id.contains("mini") { 88 }
    else if id.contains("openai/gpt-4o") && !id.contains("mini") { 85 }
    else if id.contains("google/gemini-2") { 80 }
    else if id.contains("deepseek/deepseek-r1") { 75 }
    else if id.contains("meta-llama/llama-3.3") { 70 }
    else if id.contains("qwen/") { 65 }
    else { 10 }
}

fn build_legacy_analysis_prompt(title: &str, body: Option<&str>, files: &[GitHubFile]) -> String {
    let files_summary = build_files_context(files);

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
3. Suggesting an efficient review order (usually: understand context first, then core changes, then tests)"#,
        title,
        body.unwrap_or("No description provided"),
        files_summary
    )
}

fn parse_legacy_analysis_response(response: &str) -> AppResult<PRAnalysis> {
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
