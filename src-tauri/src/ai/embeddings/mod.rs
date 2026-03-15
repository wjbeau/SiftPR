//! Embedding generation for semantic code search
//!
//! This module provides an abstraction over different embedding providers
//! (OpenAI, Google, Anthropic via Voyage, etc.) for generating vector embeddings.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Trait for embedding providers
#[async_trait]
pub trait EmbeddingProvider: Send + Sync {
    /// Get the provider name
    fn provider_name(&self) -> &'static str;

    /// Get the default embedding model for this provider
    fn default_model(&self) -> &'static str;

    /// Get the embedding dimensions for a given model
    fn dimensions(&self, model: &str) -> usize;

    /// Generate embeddings for a batch of texts
    async fn embed_texts(
        &self,
        api_key: &str,
        model: &str,
        texts: &[String],
    ) -> AppResult<Vec<Vec<f32>>>;
}

/// OpenAI embedding provider
pub struct OpenAIEmbeddings;

#[async_trait]
impl EmbeddingProvider for OpenAIEmbeddings {
    fn provider_name(&self) -> &'static str {
        "openai"
    }

    fn default_model(&self) -> &'static str {
        "text-embedding-3-small"
    }

    fn dimensions(&self, model: &str) -> usize {
        match model {
            "text-embedding-3-large" => 3072,
            "text-embedding-3-small" => 1536,
            "text-embedding-ada-002" => 1536,
            _ => 1536,
        }
    }

    async fn embed_texts(
        &self,
        api_key: &str,
        model: &str,
        texts: &[String],
    ) -> AppResult<Vec<Vec<f32>>> {
        let client = reqwest::Client::new();

        #[derive(Serialize)]
        struct EmbeddingRequest<'a> {
            input: &'a [String],
            model: &'a str,
        }

        #[derive(Deserialize)]
        struct EmbeddingResponse {
            data: Vec<EmbeddingData>,
        }

        #[derive(Deserialize)]
        struct EmbeddingData {
            embedding: Vec<f32>,
        }

        let response = client
            .post("https://api.openai.com/v1/embeddings")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&EmbeddingRequest { input: texts, model })
            .send()
            .await
            .map_err(|e| AppError::Embedding(format!("HTTP error: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Embedding(format!(
                "OpenAI API error {}: {}",
                status, body
            )));
        }

        let result: EmbeddingResponse = response
            .json()
            .await
            .map_err(|e| AppError::Embedding(format!("JSON parse error: {}", e)))?;

        Ok(result.data.into_iter().map(|d| d.embedding).collect())
    }
}

/// Google AI embedding provider
pub struct GoogleEmbeddings;

#[async_trait]
impl EmbeddingProvider for GoogleEmbeddings {
    fn provider_name(&self) -> &'static str {
        "google"
    }

    fn default_model(&self) -> &'static str {
        "gemini-embedding-001"
    }

    fn dimensions(&self, model: &str) -> usize {
        match model {
            "gemini-embedding-001" => 768,
            "text-embedding-004" => 768,
            _ => 768,
        }
    }

    async fn embed_texts(
        &self,
        api_key: &str,
        model: &str,
        texts: &[String],
    ) -> AppResult<Vec<Vec<f32>>> {
        let client = reqwest::Client::new();
        let mut all_embeddings = Vec::new();

        // Use batchEmbedContents to send up to 100 texts per request
        const BATCH_SIZE: usize = 100;

        for batch in texts.chunks(BATCH_SIZE) {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:batchEmbedContents?key={}",
                model, api_key
            );

            let requests: Vec<serde_json::Value> = batch.iter().map(|text| {
                serde_json::json!({
                    "model": format!("models/{}", model),
                    "content": {
                        "parts": [{ "text": text }]
                    }
                })
            }).collect();

            let body = serde_json::json!({ "requests": requests });

            // Retry with exponential backoff for rate limiting (429/503)
            let mut last_error = String::new();
            let mut success = false;

            for attempt in 0..5 {
                if attempt > 0 {
                    let delay = std::time::Duration::from_millis(1000 * 2u64.pow(attempt as u32));
                    println!("[Embeddings] Rate limited, retrying in {:?} (attempt {})", delay, attempt + 1);
                    tokio::time::sleep(delay).await;
                }

                let response = client
                    .post(&url)
                    .header("Content-Type", "application/json")
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| AppError::Embedding(format!("HTTP error: {}", e)))?;

                let status = response.status();
                if status.is_success() {
                    #[derive(Deserialize)]
                    struct BatchEmbedResponse {
                        embeddings: Vec<EmbeddingValues>,
                    }
                    #[derive(Deserialize)]
                    struct EmbeddingValues {
                        values: Vec<f32>,
                    }

                    let result: BatchEmbedResponse = response
                        .json()
                        .await
                        .map_err(|e| AppError::Embedding(format!("JSON parse error: {}", e)))?;

                    all_embeddings.extend(result.embeddings.into_iter().map(|e| e.values));
                    success = true;
                    break;
                }

                let status_code = status.as_u16();
                let response_body = response.text().await.unwrap_or_default();

                if status_code == 429 || status_code == 503 {
                    last_error = format!("Google API error {}: {}", status, response_body);
                    continue; // retry
                }

                // Non-retryable error
                return Err(AppError::Embedding(format!(
                    "Google API error {}: {}",
                    status, response_body
                )));
            }

            if !success {
                return Err(AppError::Embedding(format!(
                    "Google API rate limit exceeded after 5 retries: {}",
                    last_error
                )));
            }
        }

        Ok(all_embeddings)
    }
}

/// Anthropic doesn't have a direct embedding API, but users can use Voyage AI
/// which is recommended by Anthropic for embeddings
pub struct VoyageEmbeddings;

#[async_trait]
impl EmbeddingProvider for VoyageEmbeddings {
    fn provider_name(&self) -> &'static str {
        "voyage"
    }

    fn default_model(&self) -> &'static str {
        "voyage-code-3"
    }

    fn dimensions(&self, model: &str) -> usize {
        match model {
            "voyage-code-3" => 1024,
            "voyage-3" => 1024,
            "voyage-3-lite" => 512,
            _ => 1024,
        }
    }

    async fn embed_texts(
        &self,
        api_key: &str,
        model: &str,
        texts: &[String],
    ) -> AppResult<Vec<Vec<f32>>> {
        let client = reqwest::Client::new();

        #[derive(Serialize)]
        struct EmbedRequest<'a> {
            input: &'a [String],
            model: &'a str,
            input_type: &'a str,
        }

        #[derive(Deserialize)]
        struct EmbedResponse {
            data: Vec<EmbedData>,
        }

        #[derive(Deserialize)]
        struct EmbedData {
            embedding: Vec<f32>,
        }

        let response = client
            .post("https://api.voyageai.com/v1/embeddings")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Content-Type", "application/json")
            .json(&EmbedRequest {
                input: texts,
                model,
                input_type: "document",
            })
            .send()
            .await
            .map_err(|e| AppError::Embedding(format!("HTTP error: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Embedding(format!(
                "Voyage API error {}: {}",
                status, body
            )));
        }

        let result: EmbedResponse = response
            .json()
            .await
            .map_err(|e| AppError::Embedding(format!("JSON parse error: {}", e)))?;

        Ok(result.data.into_iter().map(|d| d.embedding).collect())
    }
}

/// OpenRouter embedding provider
/// Uses OpenRouter's OpenAI-compatible embeddings API.
/// Supports models like openai/text-embedding-3-small routed through OpenRouter.
pub struct OpenRouterEmbeddings;

#[async_trait]
impl EmbeddingProvider for OpenRouterEmbeddings {
    fn provider_name(&self) -> &'static str {
        "openrouter"
    }

    fn default_model(&self) -> &'static str {
        "openai/text-embedding-3-small"
    }

    fn dimensions(&self, model: &str) -> usize {
        match model {
            "openai/text-embedding-3-large" => 3072,
            "openai/text-embedding-3-small" => 1536,
            "openai/text-embedding-ada-002" => 1536,
            _ => 1536,
        }
    }

    async fn embed_texts(
        &self,
        api_key: &str,
        model: &str,
        texts: &[String],
    ) -> AppResult<Vec<Vec<f32>>> {
        let client = reqwest::Client::new();

        #[derive(Serialize)]
        struct EmbeddingRequest<'a> {
            input: &'a [String],
            model: &'a str,
        }

        #[derive(Deserialize)]
        struct EmbeddingResponse {
            data: Vec<EmbeddingData>,
        }

        #[derive(Deserialize)]
        struct EmbeddingData {
            embedding: Vec<f32>,
        }

        let response = client
            .post("https://openrouter.ai/api/v1/embeddings")
            .header("Authorization", format!("Bearer {}", api_key.trim()))
            .header("HTTP-Referer", "https://siftpr.app")
            .header("X-Title", "SiftPR")
            .header("Content-Type", "application/json")
            .json(&EmbeddingRequest { input: texts, model })
            .send()
            .await
            .map_err(|e| AppError::Embedding(format!("HTTP error: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Embedding(format!(
                "OpenRouter API error {}: {}",
                status, body
            )));
        }

        let result: EmbeddingResponse = response
            .json()
            .await
            .map_err(|e| AppError::Embedding(format!("JSON parse error: {}", e)))?;

        Ok(result.data.into_iter().map(|d| d.embedding).collect())
    }
}

/// Ollama local embedding provider
/// Uses the Ollama API (OpenAI-compatible) at a configurable base URL.
/// The `api_key` parameter is used to pass the base URL instead (no auth needed).
pub struct OllamaEmbeddings;

/// Default Ollama base URL
pub const OLLAMA_DEFAULT_URL: &str = "http://localhost:11434";

#[async_trait]
impl EmbeddingProvider for OllamaEmbeddings {
    fn provider_name(&self) -> &'static str {
        "ollama"
    }

    fn default_model(&self) -> &'static str {
        "nomic-embed-text"
    }

    fn dimensions(&self, model: &str) -> usize {
        match model {
            "nomic-embed-text" => 768,
            "mxbai-embed-large" => 1024,
            "all-minilm" => 384,
            "snowflake-arctic-embed" => 1024,
            _ => 768,
        }
    }

    async fn embed_texts(
        &self,
        api_key: &str, // Repurposed: this is the base URL for Ollama
        model: &str,
        texts: &[String],
    ) -> AppResult<Vec<Vec<f32>>> {
        let base_url = if api_key.is_empty() { OLLAMA_DEFAULT_URL } else { api_key };
        let url = format!("{}/api/embed", base_url.trim_end_matches('/'));
        let client = reqwest::Client::new();

        #[derive(Serialize)]
        struct OllamaEmbedRequest<'a> {
            model: &'a str,
            input: &'a [String],
        }

        #[derive(Deserialize)]
        struct OllamaEmbedResponse {
            embeddings: Vec<Vec<f32>>,
        }

        // Truncate texts to stay within the model's context window.
        // Code tokenizes densely (~2 chars/token), so be conservative.
        // nomic-embed-text has 8192 token limit → ~2000 chars for code is safe.
        const MAX_CHARS: usize = 2000;
        let truncated: Vec<String> = texts.iter().map(|t| {
            if t.len() > MAX_CHARS {
                let mut end = MAX_CHARS;
                while end > 0 && !t.is_char_boundary(end) {
                    end -= 1;
                }
                t[..end].to_string()
            } else {
                t.clone()
            }
        }).collect();

        // Send one text at a time to avoid exceeding Ollama's total context limit
        let mut all_embeddings = Vec::with_capacity(truncated.len());
        for text in &truncated {
            let batch = vec![text.clone()];
            let response = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&OllamaEmbedRequest { model, input: &batch })
                .send()
                .await
                .map_err(|e| AppError::Embedding(format!(
                    "Failed to connect to Ollama at {}: {}. Is Ollama running?",
                    base_url, e
                )))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Embedding(format!(
                    "Ollama API error {}: {}",
                    status, body
                )));
            }

            let result: OllamaEmbedResponse = response
                .json()
                .await
                .map_err(|e| AppError::Embedding(format!("JSON parse error: {}", e)))?;

            all_embeddings.extend(result.embeddings);
        }

        Ok(all_embeddings)
    }
}

/// Get an embedding provider by name
pub fn get_provider(name: &str) -> Option<Box<dyn EmbeddingProvider>> {
    match name.to_lowercase().as_str() {
        "openai" => Some(Box::new(OpenAIEmbeddings)),
        "google" => Some(Box::new(GoogleEmbeddings)),
        "voyage" | "anthropic" => Some(Box::new(VoyageEmbeddings)),
        "openrouter" => Some(Box::new(OpenRouterEmbeddings)),
        "ollama" => Some(Box::new(OllamaEmbeddings)),
        _ => None,
    }
}

/// Get embedding dimensions for a provider and model
pub fn get_dimensions(provider: &str, model: &str) -> usize {
    match provider.to_lowercase().as_str() {
        "openai" => OpenAIEmbeddings.dimensions(model),
        "google" => GoogleEmbeddings.dimensions(model),
        "voyage" | "anthropic" => VoyageEmbeddings.dimensions(model),
        "openrouter" => OpenRouterEmbeddings.dimensions(model),
        "ollama" => OllamaEmbeddings.dimensions(model),
        _ => 1536, // Default to OpenAI dimensions
    }
}

/// Compute cosine similarity between two vectors
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot / (norm_a * norm_b)
}
