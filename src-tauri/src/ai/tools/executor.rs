//! Tool execution loop for AI agents
//!
//! This module handles the iterative process of:
//! 1. Sending a request to the AI with available tools
//! 2. Parsing tool calls from the response
//! 3. Executing the tools
//! 4. Sending results back to the AI
//! 5. Repeating until the AI returns a final response

use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::timeout;

use super::builtin::BuiltinToolRegistry;
use super::formatter::{get_formatter, ToolFormatter};
use super::{ToolCall, ToolContext, ToolDefinition, ToolExecutionConfig, ToolResult};
use crate::ai::client::AIClient;
use crate::ai::mcp::MCPManager;
use crate::ai::types::SharedDiagnostics;
use crate::error::{AppError, AppResult};

/// Executes tools for an AI agent in an iterative loop
pub struct ToolExecutor {
    builtin_tools: BuiltinToolRegistry,
    config: ToolExecutionConfig,
    mcp_manager: Option<Arc<MCPManager>>,
    agent_type: Option<String>,
    diagnostics: Option<SharedDiagnostics>,
    diag_agent: Option<String>,
}

impl ToolExecutor {
    pub fn new(config: ToolExecutionConfig) -> Self {
        Self {
            builtin_tools: BuiltinToolRegistry::new(),
            config,
            mcp_manager: None,
            agent_type: None,
            diagnostics: None,
            diag_agent: None,
        }
    }

    pub fn with_default_config() -> Self {
        Self::new(ToolExecutionConfig::default())
    }

    /// Set the MCP manager for MCP tool support
    pub fn with_mcp(mut self, mcp_manager: Arc<MCPManager>, agent_type: &str) -> Self {
        self.mcp_manager = Some(mcp_manager);
        self.agent_type = Some(agent_type.to_string());
        self
    }

    /// Attach diagnostics for logging tool execution events
    pub fn with_diagnostics(mut self, diag: SharedDiagnostics, agent_name: &str) -> Self {
        self.diagnostics = Some(diag);
        self.diag_agent = Some(agent_name.to_string());
        self
    }

    fn diag_log(&self, event: &str, data: serde_json::Value) {
        if let Some(diag) = &self.diagnostics {
            diag.log(self.diag_agent.as_deref(), event, data);
        }
    }

    /// Get available tools for the given context (builtin + MCP)
    pub fn get_available_tools(&self, context: &ToolContext) -> Vec<ToolDefinition> {
        let mut tools = self.builtin_tools.get_available_tools(context);

        // Add MCP tools if available
        if let (Some(mcp), Some(agent_type)) = (&self.mcp_manager, &self.agent_type) {
            if let Ok(mcp_tools) = mcp.get_tools_for_agent(agent_type) {
                tools.extend(mcp_tools);
            }
        }

        tools
    }

    /// Execute an agent with tool support
    ///
    /// This runs the iterative tool-calling loop until either:
    /// - The AI returns a final response without tool calls
    /// - Max iterations is reached
    /// - Total timeout is exceeded
    /// - Max total tool calls is reached
    pub async fn execute(
        &self,
        client: &AIClient,
        provider: &str,
        api_key: &str,
        model: &str,
        system_prompt: &str,
        initial_message: &str,
        context: &ToolContext,
    ) -> AppResult<ExecutionResult> {
        let start_time = Instant::now();
        let formatter = get_formatter(provider);
        let available_tools = self.get_available_tools(context);

        let tool_names: Vec<&str> = available_tools.iter().map(|t| t.name.as_str()).collect();
        self.diag_log("tools_available", serde_json::json!({
            "tool_count": available_tools.len(),
            "tool_names": tool_names,
        }));

        if available_tools.is_empty() {
            // No tools available, fall back to regular call
            self.diag_log("tools_fallback", serde_json::json!({
                "reason": "no_tools_available",
            }));
            self.diag_log("llm_request", serde_json::json!({
                "iteration": 0,
                "provider": provider,
                "model": model,
                "system_prompt_len": system_prompt.len(),
                "system_prompt_preview": system_prompt.chars().take(500).collect::<String>(),
                "user_message_len": initial_message.len(),
                "user_message_preview": initial_message.chars().take(500).collect::<String>(),
                "note": "no-tools fallback, using call_with_system",
            }));
            let response = client
                .call_with_system(provider, api_key, model, system_prompt, initial_message)
                .await?;
            self.diag_log("llm_response", serde_json::json!({
                "response_len": response.len(),
                "has_tool_calls": false,
                "response_preview": response.chars().take(1000).collect::<String>(),
            }));
            return Ok(ExecutionResult {
                response,
                tool_calls_made: 0,
                iterations: 0,
                total_time_ms: start_time.elapsed().as_millis() as u64,
            });
        }

        let tools_json = formatter.format_tools(&available_tools);

        // Build initial messages
        let mut messages: Vec<serde_json::Value> = vec![serde_json::json!({
            "role": "user",
            "content": initial_message
        })];

        let mut iterations = 0;
        let mut total_tool_calls = 0;

        loop {
            // Check limits
            if iterations >= self.config.max_iterations {
                return Err(AppError::ToolExecution(format!(
                    "Max iterations ({}) reached",
                    self.config.max_iterations
                )));
            }

            if total_tool_calls >= self.config.max_total_tool_calls {
                return Err(AppError::ToolExecution(format!(
                    "Max tool calls ({}) reached",
                    self.config.max_total_tool_calls
                )));
            }

            let elapsed = start_time.elapsed().as_millis() as u64;
            if elapsed > self.config.total_timeout_ms {
                return Err(AppError::ToolExecution(format!(
                    "Total timeout ({} ms) exceeded",
                    self.config.total_timeout_ms
                )));
            }

            // Make API call with tools
            self.diag_log("llm_request", serde_json::json!({
                "iteration": iterations + 1,
                "provider": provider,
                "model": model,
                "system_prompt_len": system_prompt.len(),
                "system_prompt_preview": system_prompt.chars().take(500).collect::<String>(),
                "message_count": messages.len(),
                "messages": messages.iter().map(|m| {
                    let content_str = m.get("content")
                        .and_then(|c| c.as_str())
                        .unwrap_or("");
                    serde_json::json!({
                        "role": m.get("role").and_then(|r| r.as_str()).unwrap_or("unknown"),
                        "content_len": content_str.len(),
                        "content_preview": content_str.chars().take(500).collect::<String>(),
                    })
                }).collect::<Vec<_>>(),
            }));

            let response = client
                .call_with_tools(provider, api_key, model, system_prompt, &messages, &tools_json)
                .await?;

            // Check if response contains tool calls
            if !formatter.has_tool_calls(&response) {
                // No more tool calls, extract and return final response
                let final_response = formatter
                    .extract_final_response(&response)
                    .ok_or_else(|| AppError::AIProvider("No response content".to_string()))?;

                self.diag_log("llm_response", serde_json::json!({
                    "response_len": final_response.len(),
                    "has_tool_calls": false,
                    "response_preview": final_response.chars().take(1000).collect::<String>(),
                    "raw_response": truncate_json(&response, 2000),
                }));

                return Ok(ExecutionResult {
                    response: final_response,
                    tool_calls_made: total_tool_calls,
                    iterations,
                    total_time_ms: start_time.elapsed().as_millis() as u64,
                });
            }

            self.diag_log("llm_response", serde_json::json!({
                "has_tool_calls": true,
                "raw_response": truncate_json(&response, 2000),
            }));

            // Parse tool calls
            let tool_calls = formatter.parse_tool_calls(&response);
            let call_count = tool_calls.len() as u32;
            total_tool_calls += call_count;

            println!(
                "[ToolExecutor] Iteration {}: {} tool calls",
                iterations + 1,
                call_count
            );

            self.diag_log("tool_calls", serde_json::json!({
                "iteration": iterations + 1,
                "calls": tool_calls.iter().map(|tc| serde_json::json!({
                    "name": tc.name,
                    "arguments": tc.arguments,
                })).collect::<Vec<_>>(),
            }));

            // Execute each tool call
            let mut results = Vec::new();
            for call in &tool_calls {
                let tool_start = Instant::now();
                let result = self
                    .execute_single_tool(call, context)
                    .await;
                let tool_duration_ms = tool_start.elapsed().as_millis() as u64;
                println!(
                    "[ToolExecutor] Tool {} result: success={}",
                    call.name, result.success
                );
                self.diag_log("tool_result", serde_json::json!({
                    "tool_name": call.name,
                    "success": result.success,
                    "output_len": result.output.len(),
                    "duration_ms": tool_duration_ms,
                    "error": result.error,
                }));
                results.push(result);
            }

            // Add assistant response to messages (provider-specific format)
            messages.push(self.format_assistant_message(provider, &response, &tool_calls));

            // Add tool results to messages
            let results_messages = self.format_tool_results_messages(provider, &results, formatter.as_ref());
            messages.extend(results_messages);

            iterations += 1;
        }
    }

    async fn execute_single_tool(&self, call: &ToolCall, context: &ToolContext) -> ToolResult {
        let tool_timeout = Duration::from_millis(self.config.timeout_per_tool_ms);

        // Check if this is an MCP tool
        if let Some((server_name, tool_name)) = MCPManager::parse_mcp_tool_name(&call.name) {
            if let (Some(mcp), Some(agent_type)) = (&self.mcp_manager, &self.agent_type) {
                // Execute MCP tool (blocking call wrapped in spawn_blocking)
                let mcp = Arc::clone(mcp);
                let agent_type = agent_type.clone();
                let arguments = call.arguments.clone();
                let call_id = call.id.clone();

                let result = timeout(tool_timeout, async move {
                    tokio::task::spawn_blocking(move || {
                        mcp.execute_tool(&agent_type, &server_name, &tool_name, arguments)
                    })
                    .await
                    .map_err(|e| AppError::MCP(format!("Task join error: {}", e)))?
                })
                .await;

                let tool_name = call.name.clone();
                return match result {
                    Ok(Ok(mut tool_result)) => {
                        tool_result.call_id = call_id;
                        tool_result.tool_name = tool_name;
                        tool_result
                    }
                    Ok(Err(e)) => ToolResult::error(call_id, e.to_string()),
                    Err(_) => ToolResult::error(
                        call_id,
                        format!("MCP tool execution timed out after {} ms", self.config.timeout_per_tool_ms),
                    ),
                };
            }
        }

        // Execute builtin tool with timeout
        let result = timeout(
            tool_timeout,
            self.builtin_tools.execute(&call.name, call.arguments.clone(), context),
        )
        .await;

        match result {
            Ok(Ok(mut tool_result)) => {
                tool_result.call_id = call.id.clone();
                tool_result.tool_name = call.name.clone();
                tool_result
            }
            Ok(Err(e)) => ToolResult::error(call.id.clone(), e.to_string()),
            Err(_) => ToolResult::error(
                call.id.clone(),
                format!("Tool execution timed out after {} ms", self.config.timeout_per_tool_ms),
            ),
        }
    }

    fn format_assistant_message(
        &self,
        provider: &str,
        response: &serde_json::Value,
        tool_calls: &[ToolCall],
    ) -> serde_json::Value {
        match provider {
            "anthropic" => {
                // Anthropic: return the full content array
                serde_json::json!({
                    "role": "assistant",
                    "content": response.get("content").cloned().unwrap_or(serde_json::json!([]))
                })
            }
            "google" => {
                // Google: return the model's content
                let content = response
                    .get("candidates")
                    .and_then(|c| c.as_array())
                    .and_then(|c| c.first())
                    .and_then(|c| c.get("content"))
                    .cloned()
                    .unwrap_or(serde_json::json!({"parts": []}));

                serde_json::json!({
                    "role": "model",
                    "parts": content.get("parts").cloned().unwrap_or(serde_json::json!([]))
                })
            }
            _ => {
                // OpenAI format
                let openai_tool_calls: Vec<serde_json::Value> = tool_calls
                    .iter()
                    .map(|tc| {
                        serde_json::json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": serde_json::to_string(&tc.arguments).unwrap_or_default()
                            }
                        })
                    })
                    .collect();

                serde_json::json!({
                    "role": "assistant",
                    "content": null,
                    "tool_calls": openai_tool_calls
                })
            }
        }
    }

    fn format_tool_results_messages(
        &self,
        provider: &str,
        results: &[ToolResult],
        formatter: &dyn ToolFormatter,
    ) -> Vec<serde_json::Value> {
        match provider {
            "anthropic" => {
                // Anthropic: tool results as user message with tool_result blocks
                vec![serde_json::json!({
                    "role": "user",
                    "content": formatter.format_tool_results(results, &serde_json::json!({}))
                })]
            }
            "google" => {
                // Google: function response as a single message with role
                let parts = formatter.format_tool_results(results, &serde_json::json!({}));
                vec![serde_json::json!({
                    "role": "user",
                    "parts": parts.get("parts").cloned().unwrap_or(serde_json::json!([]))
                })]
            }
            _ => {
                // OpenAI: one tool message per result
                results.iter().map(|result| {
                    serde_json::json!({
                        "role": "tool",
                        "tool_call_id": result.call_id,
                        "content": if result.success {
                            result.output.clone()
                        } else {
                            format!("Error: {}", result.error.as_deref().unwrap_or("Unknown error"))
                        }
                    })
                }).collect()
            }
        }
    }
}

impl Default for ToolExecutor {
    fn default() -> Self {
        Self::with_default_config()
    }
}


/// Truncate a JSON value's string representation to a max length for diagnostics
fn truncate_json(value: &serde_json::Value, max_len: usize) -> serde_json::Value {
    let s = value.to_string();
    if s.len() <= max_len {
        value.clone()
    } else {
        serde_json::Value::String(format!("{}...[truncated, {} total chars]", &s[..max_len], s.len()))
    }
}

/// Result of executing an agent with tools
#[derive(Debug)]
pub struct ExecutionResult {
    /// The final response from the AI
    pub response: String,
    /// Number of tool calls made across all iterations
    pub tool_calls_made: u32,
    /// Number of AI request/response iterations
    pub iterations: u32,
    /// Total execution time in milliseconds
    pub total_time_ms: u64,
}
