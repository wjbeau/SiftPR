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
        "text-embedding-004"
    }

    fn dimensions(&self, model: &str) -> usize {
        match model {
            "text-embedding-004" => 768,
            "text-embedding-005" => 768,
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
        let mut embeddings = Vec::new();

        // Google's API processes one text at a time for embedContent
        for text in texts {
            #[derive(Serialize)]
            struct Content {
                parts: Vec<Part>,
            }

            #[derive(Serialize)]
            struct Part {
                text: String,
            }

            #[derive(Serialize)]
            struct EmbedRequest {
                content: Content,
            }

            #[derive(Deserialize)]
            struct EmbedResponse {
                embedding: EmbeddingValues,
            }

            #[derive(Deserialize)]
            struct EmbeddingValues {
                values: Vec<f32>,
            }

            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:embedContent?key={}",
                model, api_key
            );

            let request = EmbedRequest {
                content: Content {
                    parts: vec![Part { text: text.clone() }],
                },
            };

            let response = client
                .post(&url)
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .map_err(|e| AppError::Embedding(format!("HTTP error: {}", e)))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Embedding(format!(
                    "Google API error {}: {}",
                    status, body
                )));
            }

            let result: EmbedResponse = response
                .json()
                .await
                .map_err(|e| AppError::Embedding(format!("JSON parse error: {}", e)))?;

            embeddings.push(result.embedding.values);
        }

        Ok(embeddings)
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

/// Get an embedding provider by name
pub fn get_provider(name: &str) -> Option<Box<dyn EmbeddingProvider>> {
    match name.to_lowercase().as_str() {
        "openai" => Some(Box::new(OpenAIEmbeddings)),
        "google" => Some(Box::new(GoogleEmbeddings)),
        "voyage" | "anthropic" => Some(Box::new(VoyageEmbeddings)),
        _ => None,
    }
}

/// Get embedding dimensions for a provider and model
pub fn get_dimensions(provider: &str, model: &str) -> usize {
    match provider.to_lowercase().as_str() {
        "openai" => OpenAIEmbeddings.dimensions(model),
        "google" => GoogleEmbeddings.dimensions(model),
        "voyage" | "anthropic" => VoyageEmbeddings.dimensions(model),
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
