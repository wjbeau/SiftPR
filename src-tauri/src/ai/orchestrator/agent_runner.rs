use super::*;

impl Orchestrator {
    pub(super) async fn run_agent_if_enabled(
        &self,
        config: &AgentConfig,
        provider: &str,
        api_key: &str,
        default_model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files_context: &str,
        codebase_context: Option<&str>,
        tool_config: Option<&ToolConfig>,
        diag: &SharedDiagnostics,
        event_emitter: &Option<EventEmitter>,
    ) -> Option<AppResult<AgentResponse>> {
        if !config.enabled {
            return None;
        }

        // Use model override if provided, otherwise use default
        let model = config.model_override.as_deref().unwrap_or(default_model);

        // Use custom prompt if provided
        let custom_prompt = config.custom_prompt.as_deref();

        // Decide whether to use tools
        let use_tools = config.use_tools && tool_config.is_some();

        let agent_name = config.agent_type.as_str();
        let mode = if use_tools { "tools" } else { "basic" };
        diag.log(Some(agent_name), "agent_start", serde_json::json!({
            "agent_type": agent_name,
            "model": model,
            "mode": mode,
        }));
        if let Some(ref emitter) = event_emitter {
            emitter(AnalysisEvent::AgentStarted {
                agent: agent_name.to_string(),
                mode: mode.to_string(),
            });
        }

        let result = if use_tools {
            let tool_config = tool_config.unwrap();
            self.run_agent_with_tools(
                config.agent_type,
                provider,
                api_key,
                model,
                pr_title,
                pr_body,
                files_context,
                codebase_context,
                custom_prompt,
                tool_config,
                diag,
                event_emitter,
            ).await
        } else {
            self.run_agent(
                config.agent_type,
                provider,
                api_key,
                model,
                pr_title,
                pr_body,
                files_context,
                codebase_context,
                custom_prompt,
                diag,
            ).await
        };

        match &result {
            Ok(resp) => {
                diag.log(Some(agent_name), "agent_complete", serde_json::json!({
                    "processing_time_ms": resp.processing_time_ms,
                    "finding_count": resp.findings.len(),
                    "token_usage": resp.token_usage,
                }));
            }
            Err(e) => {
                diag.log(Some(agent_name), "agent_failed", serde_json::json!({
                    "error": e.to_string(),
                }));
            }
        }

        Some(result)
    }

    pub(super) async fn run_agent(
        &self,
        agent_type: AgentType,
        provider: &str,
        api_key: &str,
        model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files_context: &str,
        codebase_context: Option<&str>,
        custom_system_prompt: Option<&str>,
        diag: &SharedDiagnostics,
    ) -> AppResult<AgentResponse> {
        let start_time = Instant::now();
        let agent_name = agent_type.as_str();

        // Use custom prompt if provided, otherwise use default
        let default_prompt = get_system_prompt(agent_type);
        let system_prompt = custom_system_prompt.unwrap_or(default_prompt);

        let user_prompt = build_agent_prompt_for_model(
            agent_type,
            pr_title,
            pr_body,
            files_context,
            codebase_context,
            model,
        );

        diag.log(Some(agent_name), "prompt_built", serde_json::json!({
            "system_prompt_len": system_prompt.len(),
            "user_prompt_len": user_prompt.len(),
            "system_prompt_preview": system_prompt.chars().take(500).collect::<String>(),
            "user_prompt_preview": user_prompt.chars().take(500).collect::<String>(),
        }));

        diag.log(Some(agent_name), "llm_request", serde_json::json!({
            "provider": provider,
            "model": model,
        }));

        // Apply timeout
        let result = timeout(
            Duration::from_secs(AGENT_TIMEOUT_SECS),
            self.client.call_with_system(provider, api_key, model, system_prompt, &user_prompt),
        )
        .await
        .map_err(|_| AppError::AIProvider(format!("{} agent timed out", agent_type.as_str())))?;

        let ai_response = result?;
        let response_text = ai_response.content;
        let real_token_usage = ai_response.token_usage;

        diag.log(Some(agent_name), "llm_response", serde_json::json!({
            "response_len": response_text.len(),
            "has_tool_calls": false,
            "response_preview": response_text.chars().take(300).collect::<String>(),
            "token_usage": real_token_usage,
        }));

        println!("[AI] {} agent raw response (first 500 chars): {}",
            agent_type.as_str(),
            &response_text.chars().take(500).collect::<String>()
        );

        // Parse with retry loop: on failure, send follow-up asking for JSON-only response
        const MAX_PARSE_RETRIES: u32 = 2;
        let mut all_responses = vec![response_text.clone()];
        #[allow(unused_assignments)]
        let mut last_error = String::new();

        match parse_agent_response(&response_text) {
            Ok(raw_response) => {
                let processing_time_ms = start_time.elapsed().as_millis() as u64;
                let token_usage = real_token_usage.unwrap_or_else(|| {
                    let (p, c) = estimate_tokens(system_prompt, &user_prompt, &response_text);
                    TokenUsage { prompt_tokens: p, completion_tokens: c, total_tokens: p + c }
                });
                return Ok(build_agent_response_with_usage(agent_type, raw_response, processing_time_ms, token_usage));
            }
            Err(e) => {
                last_error = e.to_string();
                println!("[AI] {} agent parse error (will retry): {}", agent_name, last_error);
            }
        }

        // Retry loop using message-based conversation
        for retry in 0..MAX_PARSE_RETRIES {
            diag.log(Some(agent_name), "parse_retry", serde_json::json!({
                "attempt": retry + 1,
                "error": &last_error,
            }));

            let retry_prompt = format!(
                "Your previous response could not be parsed as valid JSON. Error: {}\n\n\
                 Please respond with ONLY the JSON object, no markdown fences, no explanation text before or after. \
                 Just the raw JSON starting with {{ and ending with }}.",
                last_error
            );

            // Build messages for conversation continuity
            let messages: Vec<serde_json::Value> = vec![
                serde_json::json!({"role": "user", "content": &user_prompt}),
                serde_json::json!({"role": "assistant", "content": all_responses.last().unwrap()}),
                serde_json::json!({"role": "user", "content": &retry_prompt}),
            ];

            let retry_result = timeout(
                Duration::from_secs(AGENT_TIMEOUT_SECS),
                self.client.call_with_tools(provider, api_key, model, system_prompt, &messages, &serde_json::json!([])),
            )
            .await;

            match retry_result {
                Ok(Ok(response_json)) => {
                    // Extract text from the response
                    let retry_text = extract_text_from_response(provider, &response_json);
                    if retry_text.is_empty() {
                        last_error = "Empty retry response".to_string();
                        continue;
                    }

                    all_responses.push(retry_text.clone());

                    diag.log(Some(agent_name), "retry_response", serde_json::json!({
                        "attempt": retry + 1,
                        "response_len": retry_text.len(),
                        "response_preview": retry_text.chars().take(300).collect::<String>(),
                    }));

                    match parse_agent_response(&retry_text) {
                        Ok(raw_response) => {
                            let processing_time_ms = start_time.elapsed().as_millis() as u64;
                            let (estimated_prompt_tokens, estimated_completion_tokens) = estimate_tokens(system_prompt, &user_prompt, &retry_text);
                            return Ok(build_agent_response(agent_type, raw_response, processing_time_ms, estimated_prompt_tokens, estimated_completion_tokens));
                        }
                        Err(e) => {
                            last_error = e.to_string();
                            println!("[AI] {} agent retry {} parse error: {}", agent_name, retry + 1, last_error);
                        }
                    }
                }
                Ok(Err(e)) => {
                    last_error = e.to_string();
                    println!("[AI] {} agent retry {} API error: {}", agent_name, retry + 1, last_error);
                }
                Err(_) => {
                    last_error = "retry timed out".to_string();
                    println!("[AI] {} agent retry {} timed out", agent_name, retry + 1);
                }
            }
        }

        // Final attempt: try extract_json on concatenation of all responses
        let concatenated = all_responses.join("\n");
        match parse_agent_response(&concatenated) {
            Ok(raw_response) => {
                let processing_time_ms = start_time.elapsed().as_millis() as u64;
                let (estimated_prompt_tokens, estimated_completion_tokens) = estimate_tokens(system_prompt, &user_prompt, &concatenated);
                Ok(build_agent_response(agent_type, raw_response, processing_time_ms, estimated_prompt_tokens, estimated_completion_tokens))
            }
            Err(e) => {
                println!("[AI] {} agent all parse attempts failed: {}", agent_name, e);
                Err(e)
            }
        }
    }

    /// Run an agent with tool support
    pub(super) async fn run_agent_with_tools(
        &self,
        agent_type: AgentType,
        provider: &str,
        api_key: &str,
        model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files_context: &str,
        codebase_context: Option<&str>,
        custom_system_prompt: Option<&str>,
        tool_config: &ToolConfig,
        diag: &SharedDiagnostics,
        event_emitter: &Option<EventEmitter>,
    ) -> AppResult<AgentResponse> {
        let start_time = Instant::now();
        let agent_name = agent_type.as_str();

        // Use custom prompt if provided, otherwise use default
        let default_prompt = get_system_prompt(agent_type);
        let base_system_prompt = custom_system_prompt.unwrap_or(default_prompt);

        // Enhance system prompt with agent-specific tool instructions
        let tool_instructions = get_tool_instructions(agent_type);
        let system_prompt = format!("{}\n\n{}", base_system_prompt, tool_instructions);

        let user_prompt = build_agent_prompt_for_model(
            agent_type,
            pr_title,
            pr_body,
            files_context,
            codebase_context,
            model,
        );

        diag.log(Some(agent_name), "prompt_built", serde_json::json!({
            "system_prompt_len": system_prompt.len(),
            "user_prompt_len": user_prompt.len(),
            "system_prompt_preview": system_prompt.chars().take(500).collect::<String>(),
            "user_prompt_preview": user_prompt.chars().take(500).collect::<String>(),
        }));

        // Create tool executor and context
        let mut tool_executor = ToolExecutor::new(tool_config.execution_config.clone())
            .with_diagnostics(diag.clone(), agent_name);
        if let Some(ref emitter) = event_emitter {
            tool_executor = tool_executor.with_event_emitter(emitter.clone());
        }
        let tool_context = ToolContext {
            repo_path: tool_config.repo_path.clone(),
            repo_full_name: tool_config.repo_full_name.clone(),
            user_id: tool_config.user_id.clone(),
        };

        // Apply timeout (longer for tool usage)
        let result = timeout(
            Duration::from_secs(AGENT_WITH_TOOLS_TIMEOUT_SECS),
            tool_executor.execute(
                &self.client,
                provider,
                api_key,
                model,
                &system_prompt,
                &user_prompt,
                &tool_context,
            ),
        )
        .await
        .map_err(|_| AppError::AIProvider(format!("{} agent timed out", agent_type.as_str())))?;

        let execution_result = result?;
        let response_text = execution_result.response;
        let processing_time_ms = start_time.elapsed().as_millis() as u64;

        println!(
            "[AI] {} agent (with tools) completed in {}ms ({} tool calls, {} iterations)",
            agent_type.as_str(),
            processing_time_ms,
            execution_result.tool_calls_made,
            execution_result.iterations
        );

        println!(
            "[AI] {} agent raw response (first 500 chars): {}",
            agent_type.as_str(),
            &response_text.chars().take(500).collect::<String>()
        );

        let (estimated_prompt_tokens, estimated_completion_tokens) = estimate_tokens(&system_prompt, &user_prompt, &response_text);

        // Parse the response
        let raw_response = parse_agent_response(&response_text).map_err(|e| {
            println!("[AI] {} agent parse error: {}", agent_type.as_str(), e);
            e
        })?;

        Ok(build_agent_response(agent_type, raw_response, processing_time_ms, estimated_prompt_tokens, estimated_completion_tokens))
    }

    /// Run an agent using the pipeline architecture for enhanced context retrieval
    ///
    /// This method uses agent-specific pipelines to:
    /// 1. Retrieve relevant code examples from the codebase
    /// 2. Build enhanced prompts with context
    /// 3. Execute the agent with the enhanced context
    pub(super) async fn run_agent_with_pipeline(
        &self,
        agent_type: AgentType,
        provider: &str,
        api_key: &str,
        model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files: &[GitHubFile],
        files_context: &str,
        codebase_summary: Option<&str>,
        repo_context: &RepoContext,
        diag: &SharedDiagnostics,
    ) -> AppResult<AgentResponse> {
        let start_time = Instant::now();
        let agent_name = agent_type.as_str();

        // Get the pipeline for this agent type
        let pipeline = self.pipeline_registry.get(agent_type).ok_or_else(|| {
            AppError::Internal(format!("No pipeline found for agent type: {:?}", agent_type))
        })?;

        // Retrieve agent-specific context
        let mut agent_context = pipeline.retrieve_context(files, repo_context).await?;

        // Add the codebase summary if available
        agent_context.codebase_summary = codebase_summary.map(String::from);

        let context_tokens = agent_context.estimated_tokens();
        println!(
            "[AI] {} agent retrieved context: {} similar code examples, {} patterns (~{} tokens)",
            agent_type.as_str(),
            agent_context.similar_code.len(),
            agent_context.pattern_examples.len(),
            context_tokens
        );

        diag.log(Some(agent_name), "context_retrieved", serde_json::json!({
            "similar_code_count": agent_context.similar_code.len(),
            "pattern_count": agent_context.pattern_examples.len(),
            "context_tokens": context_tokens,
            "codebase_summary_len": agent_context.codebase_summary.as_ref().map(|s| s.len()).unwrap_or(0),
        }));

        // Build prompts using the pipeline
        let system_prompt = pipeline.build_system_prompt(&agent_context);
        let user_prompt = pipeline.build_user_prompt(pr_title, pr_body, files_context, &agent_context);

        diag.log(Some(agent_name), "prompt_built", serde_json::json!({
            "system_prompt_len": system_prompt.len(),
            "user_prompt_len": user_prompt.len(),
            "system_prompt_preview": system_prompt.chars().take(500).collect::<String>(),
            "user_prompt_preview": user_prompt.chars().take(500).collect::<String>(),
        }));

        diag.log(Some(agent_name), "llm_request", serde_json::json!({
            "provider": provider,
            "model": model,
        }));

        // Execute the agent
        let result = timeout(
            Duration::from_secs(AGENT_TIMEOUT_SECS),
            self.client.call_with_system(provider, api_key, model, &system_prompt, &user_prompt),
        )
        .await
        .map_err(|_| AppError::AIProvider(format!("{} agent timed out", agent_type.as_str())))?;

        let ai_response = result?;
        let response_text = ai_response.content;
        let real_token_usage = ai_response.token_usage;
        let processing_time_ms = start_time.elapsed().as_millis() as u64;

        let token_usage = real_token_usage.unwrap_or_else(|| {
            let (p, c) = estimate_tokens(&system_prompt, &user_prompt, &response_text);
            TokenUsage { prompt_tokens: p, completion_tokens: c, total_tokens: p + c }
        });

        diag.log(Some(agent_name), "llm_response", serde_json::json!({
            "response_len": response_text.len(),
            "has_tool_calls": false,
            "response_preview": response_text.chars().take(300).collect::<String>(),
            "token_usage": token_usage,
        }));

        println!(
            "[AI] {} agent (with pipeline) completed in {}ms ({} prompt + {} completion tokens)",
            agent_type.as_str(),
            processing_time_ms,
            token_usage.prompt_tokens,
            token_usage.completion_tokens
        );

        println!(
            "[AI] {} agent raw response (first 500 chars): {}",
            agent_type.as_str(),
            &response_text.chars().take(500).collect::<String>()
        );

        // Parse the response
        let raw_response = parse_agent_response(&response_text).map_err(|e| {
            println!("[AI] {} agent parse error: {}", agent_type.as_str(), e);
            e
        })?;

        // Post-process using the pipeline
        let response = pipeline.post_process(raw_response, processing_time_ms);

        // Add token usage
        Ok(AgentResponse {
            token_usage: Some(token_usage),
            ..response
        })
    }

    /// Run an agent using pipeline context retrieval combined with tool calling
    pub(super) async fn run_agent_with_pipeline_and_tools(
        &self,
        agent_type: AgentType,
        provider: &str,
        api_key: &str,
        model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files: &[GitHubFile],
        files_context: &str,
        codebase_summary: Option<&str>,
        repo_context: &RepoContext,
        tool_config: &ToolConfig,
        diag: &SharedDiagnostics,
        event_emitter: &Option<EventEmitter>,
    ) -> AppResult<AgentResponse> {
        let start_time = Instant::now();
        let agent_name = agent_type.as_str();

        // Get the pipeline for this agent type
        let pipeline = self.pipeline_registry.get(agent_type).ok_or_else(|| {
            AppError::Internal(format!("No pipeline found for agent type: {:?}", agent_type))
        })?;

        // Retrieve agent-specific context
        let mut agent_context = pipeline.retrieve_context(files, repo_context).await?;
        agent_context.codebase_summary = codebase_summary.map(String::from);

        let context_tokens = agent_context.estimated_tokens();
        println!(
            "[AI] {} agent (pipeline+tools) retrieved context: {} similar code examples, {} patterns (~{} tokens)",
            agent_type.as_str(),
            agent_context.similar_code.len(),
            agent_context.pattern_examples.len(),
            context_tokens
        );

        diag.log(Some(agent_name), "context_retrieved", serde_json::json!({
            "similar_code_count": agent_context.similar_code.len(),
            "pattern_count": agent_context.pattern_examples.len(),
            "context_tokens": context_tokens,
            "codebase_summary_len": agent_context.codebase_summary.as_ref().map(|s| s.len()).unwrap_or(0),
        }));

        // Build prompts using the pipeline
        let base_system_prompt = pipeline.build_system_prompt(&agent_context);
        let user_prompt = pipeline.build_user_prompt(pr_title, pr_body, files_context, &agent_context);

        // Enhance system prompt with agent-specific tool instructions
        let tool_instructions = get_tool_instructions(agent_type);
        let system_prompt = format!("{}\n\n{}", base_system_prompt, tool_instructions);

        diag.log(Some(agent_name), "prompt_built", serde_json::json!({
            "system_prompt_len": system_prompt.len(),
            "user_prompt_len": user_prompt.len(),
            "system_prompt_preview": system_prompt.chars().take(500).collect::<String>(),
            "user_prompt_preview": user_prompt.chars().take(500).collect::<String>(),
        }));

        // Create tool executor and context
        let mut tool_executor = ToolExecutor::new(tool_config.execution_config.clone())
            .with_diagnostics(diag.clone(), agent_name);
        if let Some(ref emitter) = event_emitter {
            tool_executor = tool_executor.with_event_emitter(emitter.clone());
        }
        let tool_context = ToolContext {
            repo_path: tool_config.repo_path.clone(),
            repo_full_name: tool_config.repo_full_name.clone(),
            user_id: tool_config.user_id.clone(),
        };

        // Execute with tools and longer timeout
        let result = timeout(
            Duration::from_secs(AGENT_WITH_TOOLS_TIMEOUT_SECS),
            tool_executor.execute(
                &self.client,
                provider,
                api_key,
                model,
                &system_prompt,
                &user_prompt,
                &tool_context,
            ),
        )
        .await
        .map_err(|_| AppError::AIProvider(format!("{} agent timed out", agent_type.as_str())))?;

        let execution_result = result?;
        let response_text = execution_result.response;
        let processing_time_ms = start_time.elapsed().as_millis() as u64;

        println!(
            "[AI] {} agent (pipeline+tools) completed in {}ms ({} tool calls, {} iterations)",
            agent_type.as_str(),
            processing_time_ms,
            execution_result.tool_calls_made,
            execution_result.iterations
        );

        println!(
            "[AI] {} agent raw response (first 500 chars): {}",
            agent_type.as_str(),
            &response_text.chars().take(500).collect::<String>()
        );

        let (estimated_prompt_tokens, estimated_completion_tokens) = estimate_tokens(&system_prompt, &user_prompt, &response_text);

        // Parse the response
        let raw_response = parse_agent_response(&response_text).map_err(|e| {
            println!("[AI] {} agent parse error: {}", agent_type.as_str(), e);
            e
        })?;

        // Post-process using the pipeline
        let response = pipeline.post_process(raw_response, processing_time_ms);

        Ok(AgentResponse {
            token_usage: Some(TokenUsage {
                prompt_tokens: estimated_prompt_tokens,
                completion_tokens: estimated_completion_tokens,
                total_tokens: estimated_prompt_tokens + estimated_completion_tokens,
            }),
            ..response
        })
    }

    /// Run an agent with pipeline context retrieval and optional tool support
    pub(super) async fn run_agent_if_enabled_with_pipeline(
        &self,
        config: &AgentConfig,
        provider: &str,
        api_key: &str,
        default_model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files: &[GitHubFile],
        files_context: &str,
        codebase_summary: Option<&str>,
        repo_context: &RepoContext,
        tool_config: Option<&ToolConfig>,
        diag: &SharedDiagnostics,
        event_emitter: &Option<EventEmitter>,
    ) -> Option<AppResult<AgentResponse>> {
        if !config.enabled {
            return None;
        }

        let model = config.model_override.as_deref().unwrap_or(default_model);
        let agent_name = config.agent_type.as_str();

        // Use tools if the agent config enables them and tool_config is available
        let use_tools = config.use_tools && tool_config.is_some();

        let mode = if use_tools { "pipeline+tools" } else { "pipeline" };
        diag.log(Some(agent_name), "agent_start", serde_json::json!({
            "agent_type": agent_name,
            "model": model,
            "mode": mode,
        }));
        if let Some(ref emitter) = event_emitter {
            emitter(AnalysisEvent::AgentStarted {
                agent: agent_name.to_string(),
                mode: mode.to_string(),
            });
        }

        let result = if use_tools {
            self.run_agent_with_pipeline_and_tools(
                config.agent_type,
                provider,
                api_key,
                model,
                pr_title,
                pr_body,
                files,
                files_context,
                codebase_summary,
                repo_context,
                tool_config.unwrap(),
                diag,
                event_emitter,
            )
            .await
        } else {
            self.run_agent_with_pipeline(
                config.agent_type,
                provider,
                api_key,
                model,
                pr_title,
                pr_body,
                files,
                files_context,
                codebase_summary,
                repo_context,
                diag,
            )
            .await
        };

        match &result {
            Ok(resp) => {
                diag.log(Some(agent_name), "agent_complete", serde_json::json!({
                    "processing_time_ms": resp.processing_time_ms,
                    "finding_count": resp.findings.len(),
                    "token_usage": resp.token_usage,
                }));
            }
            Err(e) => {
                diag.log(Some(agent_name), "agent_failed", serde_json::json!({
                    "error": e.to_string(),
                }));
            }
        }

        Some(result)
    }
}

fn parse_agent_response(response: &str) -> AppResult<RawAgentResponse> {
    super::super::json_extract::extract_json::<RawAgentResponse>(response)
        .map_err(|e| AppError::AIProvider(format!("Failed to parse agent response: {}", e)))
}

fn estimate_tokens(system_prompt: &str, user_prompt: &str, response_text: &str) -> (u32, u32) {
    let prompt_chars = system_prompt.len() + user_prompt.len();
    let response_chars = response_text.len();
    ((prompt_chars / 4) as u32, (response_chars / 4) as u32)
}

fn build_agent_response(
    agent_type: AgentType,
    raw_response: RawAgentResponse,
    processing_time_ms: u64,
    estimated_prompt_tokens: u32,
    estimated_completion_tokens: u32,
) -> AgentResponse {
    let token_usage = TokenUsage {
        prompt_tokens: estimated_prompt_tokens,
        completion_tokens: estimated_completion_tokens,
        total_tokens: estimated_prompt_tokens + estimated_completion_tokens,
    };
    build_agent_response_with_usage(agent_type, raw_response, processing_time_ms, token_usage)
}

fn build_agent_response_with_usage(
    agent_type: AgentType,
    raw_response: RawAgentResponse,
    processing_time_ms: u64,
    token_usage: TokenUsage,
) -> AgentResponse {
    AgentResponse {
        agent_type,
        summary: AgentSummary {
            overview: raw_response.summary.overview,
            risk_assessment: raw_response.summary.risk_assessment,
            top_concerns: raw_response.summary.top_concerns,
        },
        findings: raw_response
            .findings
            .into_iter()
            .map(|f| f.into_finding())
            .collect(),
        priority_files: raw_response.priority_files,
        processing_time_ms,
        token_usage: Some(token_usage),
    }
}

/// Extract text content from a raw provider response JSON
fn extract_text_from_response(provider: &str, response: &serde_json::Value) -> String {
    match provider {
        "anthropic" => {
            response.get("content")
                .and_then(|c| c.as_array())
                .map(|blocks| {
                    blocks.iter()
                        .filter_map(|b| {
                            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("")
                })
                .unwrap_or_default()
        }
        "google" => {
            response.get("candidates")
                .and_then(|c| c.as_array())
                .and_then(|c| c.first())
                .and_then(|c| c.get("content"))
                .and_then(|c| c.get("parts"))
                .and_then(|p| p.as_array())
                .and_then(|parts| {
                    parts.iter().find_map(|p| p.get("text").and_then(|t| t.as_str()))
                })
                .unwrap_or_default()
                .to_string()
        }
        _ => {
            // OpenAI-style
            response.get("choices")
                .and_then(|c| c.as_array())
                .and_then(|c| c.first())
                .and_then(|c| c.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or_default()
                .to_string()
        }
    }
}
