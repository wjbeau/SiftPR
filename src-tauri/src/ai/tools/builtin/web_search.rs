//! web_search tool - Search the web using SerpAPI

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::BuiltinTool;
use crate::ai::tools::{ToolContext, ToolDefinition, ToolResult, ToolSource};
use crate::db::Database;
use crate::error::{AppError, AppResult};

const MAX_RESULTS: usize = 10;
const SERPAPI_URL: &str = "https://serpapi.com/search";

#[derive(Debug, Deserialize)]
struct WebSearchArgs {
    query: String,
    num_results: Option<usize>,
}

#[derive(Debug, Serialize)]
struct SearchResultItem {
    title: String,
    link: String,
    snippet: String,
}

#[derive(Debug, Serialize)]
struct WebSearchOutput {
    results: Vec<SearchResultItem>,
    total_results: usize,
}

#[derive(Debug, Deserialize)]
struct SerpApiResponse {
    organic_results: Option<Vec<SerpApiResult>>,
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SerpApiResult {
    title: String,
    link: String,
    snippet: Option<String>,
}

pub struct WebSearchTool {
    client: reqwest::Client,
}

impl WebSearchTool {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    async fn get_api_key(&self, context: &ToolContext) -> AppResult<Option<String>> {
        // Try to get the SerpAPI key from the database
        let db = Database::new()?;
        db.get_service_key(&context.user_id, "serpapi")
    }

    async fn search_serpapi(
        &self,
        query: &str,
        api_key: &str,
        num_results: usize,
    ) -> AppResult<Vec<SearchResultItem>> {
        let response = self
            .client
            .get(SERPAPI_URL)
            .query(&[
                ("q", query),
                ("api_key", api_key),
                ("engine", "google"),
                ("num", &num_results.to_string()),
            ])
            .send()
            .await
            .map_err(|e| AppError::ToolExecution(format!("SerpAPI request failed: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::ToolExecution(format!(
                "SerpAPI error {}: {}",
                status, body
            )));
        }

        let data: SerpApiResponse = response
            .json()
            .await
            .map_err(|e| AppError::ToolExecution(format!("Failed to parse SerpAPI response: {}", e)))?;

        if let Some(error) = data.error {
            return Err(AppError::ToolExecution(format!("SerpAPI error: {}", error)));
        }

        let results = data
            .organic_results
            .unwrap_or_default()
            .into_iter()
            .map(|r| SearchResultItem {
                title: r.title,
                link: r.link,
                snippet: r.snippet.unwrap_or_default(),
            })
            .collect();

        Ok(results)
    }
}

impl Default for WebSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl BuiltinTool for WebSearchTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "web_search".to_string(),
            description: "Search the web for information. Useful for finding documentation, best practices, understanding unfamiliar libraries, or researching error messages.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    },
                    "num_results": {
                        "type": "integer",
                        "description": "Number of results to return (default: 5, max: 10)"
                    }
                },
                "required": ["query"]
            }),
            source: ToolSource::Builtin,
        }
    }

    fn is_available(&self, _context: &ToolContext) -> bool {
        // Web search is available if we have a SerpAPI key
        // We'll check at execution time since we need async
        true
    }

    async fn execute(
        &self,
        arguments: serde_json::Value,
        context: &ToolContext,
    ) -> AppResult<ToolResult> {
        let call_id = uuid::Uuid::new_v4().to_string();

        let args: WebSearchArgs = serde_json::from_value(arguments).map_err(|e| {
            AppError::ToolExecution(format!("Invalid arguments: {}", e))
        })?;

        // Get API key
        let api_key = match self.get_api_key(context).await? {
            Some(key) => key,
            None => {
                return Ok(ToolResult::error(
                    call_id,
                    "SerpAPI key not configured. Please add your SerpAPI key in Settings > Services.".to_string(),
                ));
            }
        };

        let num_results = args.num_results.unwrap_or(5).min(MAX_RESULTS);

        // Perform search
        let results = self.search_serpapi(&args.query, &api_key, num_results).await?;

        let output = WebSearchOutput {
            total_results: results.len(),
            results,
        };

        let json_output = serde_json::to_string_pretty(&output)
            .map_err(|e| AppError::ToolExecution(format!("Failed to serialize output: {}", e)))?;

        Ok(ToolResult::success(call_id, json_output))
    }
}
