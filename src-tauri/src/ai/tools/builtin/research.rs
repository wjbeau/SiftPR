//! research_agent tool - Spawn a research sub-agent to explore the codebase

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

use super::BuiltinTool;
use crate::ai::client::AIClient;
use crate::ai::prompts;
use crate::ai::tools::formatter::get_formatter;
use crate::ai::tools::{ToolContext, ToolDefinition, ToolExecutionConfig, ToolResult, ToolSource};
use crate::ai::types::AgentType;
use crate::db::Database;
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
struct ResearchArgs {
    question: String,
    context: Option<String>,
    search_hints: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
struct ResearchSource {
    file: String,
    relevance: String,
    key_findings: String,
}

#[derive(Debug, Serialize)]
struct ResearchOutput {
    answer: String,
    confidence: f32,
    sources: Vec<ResearchSource>,
    additional_context: Option<String>,
}

pub struct ResearchAgentTool {
    client: Arc<AIClient>,
}

impl ResearchAgentTool {
    pub fn new() -> Self {
        Self {
            client: Arc::new(AIClient::new()),
        }
    }

    async fn get_research_config(&self, context: &ToolContext) -> AppResult<ResearchConfig> {
        let db = Database::new()?;

        // Check if the research agent is disabled via agent_settings
        let agent_settings = db.get_agent_settings(&context.user_id)?;
        let research_setting = agent_settings.iter().find(|s| s.agent_type == "research");

        if let Some(setting) = research_setting {
            if !setting.enabled {
                return Err(AppError::ToolExecution(
                    "Research agent is disabled. Enable it in Settings > Agents.".to_string(),
                ));
            }
        }

        // Get research agent settings (legacy table for iterations/timeout)
        let settings = db.get_research_agent_settings(&context.user_id)?;

        // Use shared internal agent config first, fall back to active AI provider
        let (provider, api_key, model) = if let Some(config) = db.get_internal_agent_config(&context.user_id)? {
            config
        } else {
            let (ai_settings, key) = db
                .get_active_ai_setting(&context.user_id)?
                .ok_or_else(|| AppError::NotFound("No active AI provider".to_string()))?;
            (ai_settings.provider, key, ai_settings.model_preference)
        };

        // Use custom prompt from agent_settings if available
        let custom_prompt = research_setting
            .and_then(|s| s.custom_prompt.clone());

        let max_iterations = settings
            .as_ref()
            .map(|s| s.max_iterations)
            .unwrap_or(5);

        let timeout_seconds = settings
            .as_ref()
            .map(|s| s.timeout_seconds)
            .unwrap_or(120);

        // Check if semantic search is available (embedding provider configured)
        let has_embeddings = db.get_embedding_provider(&context.user_id)?
            .is_some();

        Ok(ResearchConfig {
            provider,
            api_key,
            model,
            max_iterations,
            timeout_seconds,
            custom_prompt,
            has_embeddings,
        })
    }

    async fn run_research(
        &self,
        question: &str,
        context_hint: Option<&str>,
        search_hints: Option<&[String]>,
        tool_context: &ToolContext,
        config: &ResearchConfig,
    ) -> AppResult<String> {
        let formatter = get_formatter(&config.provider);

        // Build the research-specific tools
        let mut tools = vec![
            super::search_repo::SearchRepoTool::new().definition(),
            super::read_file::ReadFileTool::new().definition(),
        ];

        // Add semantic_search when embeddings are available and repo is indexed
        if config.has_embeddings && tool_context.repo_full_name.is_some() {
            tools.push(super::semantic_search::SemanticSearchTool::new().definition());
        }

        let tools_json = formatter.format_tools(&tools);

        // Build the user prompt
        let mut user_prompt = format!("## Research Question\n{}\n", question);

        if let Some(ctx) = context_hint {
            user_prompt.push_str(&format!("\n## Additional Context\n{}\n", ctx));
        }

        if let Some(hints) = search_hints {
            if !hints.is_empty() {
                user_prompt.push_str("\n## Search Hints\nConsider searching for:\n");
                for hint in hints {
                    user_prompt.push_str(&format!("- {}\n", hint));
                }
            }
        }

        user_prompt.push_str("\nPlease investigate this question using the available tools and provide your findings.");

        // Build initial messages
        let mut messages: Vec<serde_json::Value> = vec![json!({
            "role": "user",
            "content": user_prompt
        })];

        let execution_config = ToolExecutionConfig {
            max_iterations: config.max_iterations,
            max_total_tool_calls: config.max_iterations * 5,
            timeout_per_tool_ms: 30_000,
            total_timeout_ms: (config.timeout_seconds as u64) * 1000,
        };

        let start_time = std::time::Instant::now();
        let mut iterations = 0;
        let mut total_tool_calls = 0;

        // Use custom prompt if configured, otherwise the shared default from prompts.rs
        let default_prompt = prompts::get_system_prompt(AgentType::Research);
        let system_prompt = config.custom_prompt.as_deref()
            .unwrap_or(default_prompt);

        // Create a mini tool registry with only the allowed tools
        let search_tool = super::search_repo::SearchRepoTool::new();
        let read_tool = super::read_file::ReadFileTool::new();
        let semantic_tool = super::semantic_search::SemanticSearchTool::new();

        loop {
            // Check limits
            if iterations >= execution_config.max_iterations {
                return Err(AppError::ToolExecution(
                    "Research agent reached max iterations".to_string(),
                ));
            }

            if total_tool_calls >= execution_config.max_total_tool_calls {
                return Err(AppError::ToolExecution(
                    "Research agent reached max tool calls".to_string(),
                ));
            }

            let elapsed = start_time.elapsed().as_millis() as u64;
            if elapsed > execution_config.total_timeout_ms {
                return Err(AppError::ToolExecution(
                    "Research agent timed out".to_string(),
                ));
            }

            // Make API call with tools
            let response = self.client
                .call_with_tools(
                    &config.provider,
                    &config.api_key,
                    &config.model,
                    system_prompt,
                    &messages,
                    &tools_json,
                )
                .await?;

            // Check if response contains tool calls
            if !formatter.has_tool_calls(&response) {
                // No more tool calls, extract and return final response
                return formatter
                    .extract_final_response(&response)
                    .ok_or_else(|| AppError::AIProvider("No response content".to_string()));
            }

            // Parse and execute tool calls
            let tool_calls = formatter.parse_tool_calls(&response);
            total_tool_calls += tool_calls.len() as u32;

            println!(
                "[ResearchAgent] Iteration {}: {} tool calls",
                iterations + 1,
                tool_calls.len()
            );

            let mut results = Vec::new();
            for call in &tool_calls {
                let result = match call.name.as_str() {
                    "search_repo" => {
                        search_tool.execute(call.arguments.clone(), tool_context).await
                    }
                    "read_file" => {
                        read_tool.execute(call.arguments.clone(), tool_context).await
                    }
                    "semantic_search" if config.has_embeddings => {
                        semantic_tool.execute(call.arguments.clone(), tool_context).await
                    }
                    _ => Ok(ToolResult::error(
                        call.id.clone(),
                        format!("Unknown tool: {}", call.name),
                    )),
                };

                let mut tool_result = result.unwrap_or_else(|e| {
                    ToolResult::error(call.id.clone(), e.to_string())
                });
                tool_result.call_id = call.id.clone();

                println!(
                    "[ResearchAgent] Tool {} result: success={}",
                    call.name, tool_result.success
                );
                results.push(tool_result);
            }

            // Add assistant response to messages
            messages.push(self.format_assistant_message(&config.provider, &response, &tool_calls));

            // Add tool results to messages
            messages.push(self.format_tool_results_message(&config.provider, &results, formatter.as_ref()));

            iterations += 1;
        }
    }

    fn format_assistant_message(
        &self,
        provider: &str,
        response: &serde_json::Value,
        tool_calls: &[crate::ai::tools::ToolCall],
    ) -> serde_json::Value {
        match provider {
            "anthropic" => {
                json!({
                    "role": "assistant",
                    "content": response.get("content").cloned().unwrap_or(json!([]))
                })
            }
            "google" => {
                let content = response
                    .get("candidates")
                    .and_then(|c| c.as_array())
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("content"))
                    .cloned()
                    .unwrap_or(json!({"parts": []}));

                json!({
                    "role": "model",
                    "parts": content.get("parts").cloned().unwrap_or(json!([]))
                })
            }
            _ => {
                // OpenAI format
                let openai_tool_calls: Vec<serde_json::Value> = tool_calls
                    .iter()
                    .map(|tc| {
                        json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": serde_json::to_string(&tc.arguments).unwrap_or_default()
                            }
                        })
                    })
                    .collect();

                json!({
                    "role": "assistant",
                    "content": null,
                    "tool_calls": openai_tool_calls
                })
            }
        }
    }

    fn format_tool_results_message(
        &self,
        provider: &str,
        results: &[ToolResult],
        formatter: &dyn crate::ai::tools::formatter::ToolFormatter,
    ) -> serde_json::Value {
        match provider {
            "anthropic" => {
                json!({
                    "role": "user",
                    "content": formatter.format_tool_results(results, &json!({}))
                })
            }
            "google" => {
                formatter.format_tool_results(results, &json!({}))
            }
            _ => {
                // OpenAI: tool message for each result
                if let Some(result) = results.first() {
                    json!({
                        "role": "tool",
                        "tool_call_id": result.call_id,
                        "content": if result.success {
                            result.output.clone()
                        } else {
                            format!("Error: {}", result.error.as_deref().unwrap_or("Unknown error"))
                        }
                    })
                } else {
                    json!({
                        "role": "tool",
                        "content": "No results"
                    })
                }
            }
        }
    }
}

impl Default for ResearchAgentTool {
    fn default() -> Self {
        Self::new()
    }
}

struct ResearchConfig {
    provider: String,
    api_key: String,
    model: String,
    max_iterations: u32,
    timeout_seconds: u32,
    custom_prompt: Option<String>,
    has_embeddings: bool,
}

#[async_trait]
impl BuiltinTool for ResearchAgentTool {
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            name: "spawn_research_agent".to_string(),
            description: "Spawn a research sub-agent to explore the codebase and answer a specific question. Use this for complex investigations that require searching multiple files or following code paths.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The specific question to research (be detailed and specific)"
                    },
                    "context": {
                        "type": "string",
                        "description": "Additional context to help the research agent (e.g., what you already know, why you need this info)"
                    },
                    "search_hints": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Suggested file patterns or search terms to start with"
                    }
                },
                "required": ["question"]
            }),
            source: ToolSource::Builtin,
        }
    }

    fn is_available(&self, context: &ToolContext) -> bool {
        // Research agent requires a repo to be linked
        context.repo_path.is_some()
    }

    async fn execute(
        &self,
        arguments: serde_json::Value,
        context: &ToolContext,
    ) -> AppResult<ToolResult> {
        let call_id = uuid::Uuid::new_v4().to_string();

        let args: ResearchArgs = serde_json::from_value(arguments).map_err(|e| {
            AppError::ToolExecution(format!("Invalid arguments: {}", e))
        })?;

        // Get research configuration
        let config = match self.get_research_config(context).await {
            Ok(c) => c,
            Err(e) => {
                return Ok(ToolResult::error(
                    call_id,
                    format!("Failed to get research config: {}", e),
                ));
            }
        };

        println!(
            "[ResearchAgent] Starting research: {} (model: {})",
            &args.question.chars().take(100).collect::<String>(),
            &config.model
        );

        // Run the research
        let result = self.run_research(
            &args.question,
            args.context.as_deref(),
            args.search_hints.as_deref(),
            context,
            &config,
        ).await;

        match result {
            Ok(response) => {
                println!("[ResearchAgent] Research completed successfully");
                Ok(ToolResult::success(call_id, response))
            }
            Err(e) => {
                println!("[ResearchAgent] Research failed: {}", e);
                Ok(ToolResult::error(call_id, e.to_string()))
            }
        }
    }
}
