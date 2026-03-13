use std::collections::HashMap;
use std::time::Instant;

use tokio::time::{timeout, Duration};

use crate::error::{AppError, AppResult};
use crate::github::GitHubFile;

use super::client::AIClient;
use super::prompts::{build_agent_prompt, build_files_context, build_grouping_prompt, get_system_prompt};
use super::tools::{ToolContext, ToolExecutionConfig, ToolExecutor};
use super::types::{
    AgentResponse, AgentSummary, AgentType, AnnotationType, FailedAgent,
    FileAnalysis, FileContext, FileGroup, FilePriority, GroupedFile, KeyChange, LineAnnotation,
    OrchestratedAnalysis, PRCategory, RawAgentResponse, Severity, TokenUsage,
};

const AGENT_TIMEOUT_SECS: u64 = 60;
const AGENT_WITH_TOOLS_TIMEOUT_SECS: u64 = 300; // 5 minutes when using tools

/// Fuzzy-match an AI-reported filename against the actual PR file list.
/// Tries in order: exact match, normalized match (strip leading /, normalize \),
/// suffix match (AI might omit a prefix), basename match (last resort).
fn fuzzy_match_filename<'a>(ai_name: &str, actual_names: &[&'a str]) -> Option<&'a str> {
    // 1. Exact match
    if let Some(&exact) = actual_names.iter().find(|&&n| n == ai_name) {
        return Some(exact);
    }

    let normalized = ai_name.trim_start_matches('/').replace('\\', "/");

    // 2. Normalized match
    if let Some(&m) = actual_names.iter().find(|&&n| {
        n.trim_start_matches('/').replace('\\', "/") == normalized
    }) {
        return Some(m);
    }

    // 3. Suffix match — AI might report "src/foo.ts" when actual is "packages/app/src/foo.ts"
    //    or vice versa
    let suffix_matches: Vec<&&str> = actual_names.iter()
        .filter(|&&n| n.ends_with(&format!("/{}", normalized)) || normalized.ends_with(&format!("/{}", n)))
        .collect();
    if suffix_matches.len() == 1 {
        return Some(suffix_matches[0]);
    }

    // 4. Basename match — only if unambiguous
    let ai_basename = normalized.rsplit('/').next().unwrap_or(&normalized);
    let basename_matches: Vec<&&str> = actual_names.iter()
        .filter(|&&n| {
            let base = n.rsplit('/').next().unwrap_or(n);
            base == ai_basename
        })
        .collect();
    if basename_matches.len() == 1 {
        return Some(basename_matches[0]);
    }

    None // Couldn't match
}

/// Configuration for a single analysis agent
#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub agent_type: AgentType,
    pub enabled: bool,
    pub model_override: Option<String>,
    pub custom_prompt: Option<String>,
    pub use_tools: bool,
}

impl AgentConfig {
    pub fn default_for(agent_type: AgentType) -> Self {
        Self {
            agent_type,
            enabled: true,
            model_override: None,
            custom_prompt: None,
            use_tools: false,
        }
    }

    pub fn with_tools(mut self) -> Self {
        self.use_tools = true;
        self
    }
}

/// Configuration for tool usage across agents
#[derive(Debug, Clone)]
pub struct ToolConfig {
    /// Path to the local repository (enables search_repo and read_file tools)
    pub repo_path: Option<String>,
    /// Full name of the repository (e.g., "owner/repo") for semantic search
    pub repo_full_name: Option<String>,
    /// User ID for accessing stored credentials
    pub user_id: String,
    /// Execution limits
    pub execution_config: ToolExecutionConfig,
}

pub struct Orchestrator {
    client: AIClient,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self {
            client: AIClient::new(),
        }
    }

    /// Run all agents in parallel and aggregate results
    pub async fn analyze_pr(
        &self,
        provider: &str,
        api_key: &str,
        default_model: &str,
        pr_title: &str,
        pr_body: Option<&str>,
        files: &[GitHubFile],
        codebase_context: Option<&str>,
        agent_configs: Option<Vec<AgentConfig>>,
        tool_config: Option<ToolConfig>,
    ) -> AppResult<OrchestratedAnalysis> {
        let start_time = Instant::now();
        let files_context = build_files_context(files);

        // Build agent configs, using defaults if not provided
        let configs: HashMap<AgentType, AgentConfig> = agent_configs
            .unwrap_or_else(|| vec![
                AgentConfig::default_for(AgentType::Security),
                AgentConfig::default_for(AgentType::Architecture),
                AgentConfig::default_for(AgentType::Style),
                AgentConfig::default_for(AgentType::Performance),
            ])
            .into_iter()
            .filter(|c| c.agent_type != AgentType::Research) // Research agent is a tool, not a top-level agent
            .map(|c| (c.agent_type, c))
            .collect();

        // Get configs for each agent (default to enabled if not configured)
        let security_config = configs.get(&AgentType::Security).cloned()
            .unwrap_or_else(|| AgentConfig::default_for(AgentType::Security));
        let architecture_config = configs.get(&AgentType::Architecture).cloned()
            .unwrap_or_else(|| AgentConfig::default_for(AgentType::Architecture));
        let style_config = configs.get(&AgentType::Style).cloned()
            .unwrap_or_else(|| AgentConfig::default_for(AgentType::Style));
        let performance_config = configs.get(&AgentType::Performance).cloned()
            .unwrap_or_else(|| AgentConfig::default_for(AgentType::Performance));

        let tool_config_ref = tool_config.as_ref();

        // Run enabled agents in parallel
        // Note: The research agent is available as a tool (spawn_research_agent) that
        // any analysis agent can call on demand to investigate the codebase.
        let (security_result, architecture_result, style_result, performance_result) = tokio::join!(
            self.run_agent_if_enabled(
                &security_config,
                provider,
                api_key,
                default_model,
                pr_title,
                pr_body,
                &files_context,
                codebase_context,
                tool_config_ref,
            ),
            self.run_agent_if_enabled(
                &architecture_config,
                provider,
                api_key,
                default_model,
                pr_title,
                pr_body,
                &files_context,
                codebase_context,
                tool_config_ref,
            ),
            self.run_agent_if_enabled(
                &style_config,
                provider,
                api_key,
                default_model,
                pr_title,
                pr_body,
                &files_context,
                codebase_context,
                tool_config_ref,
            ),
            self.run_agent_if_enabled(
                &performance_config,
                provider,
                api_key,
                default_model,
                pr_title,
                pr_body,
                &files_context,
                codebase_context,
                tool_config_ref,
            ),
        );

        // Collect successful responses and failures
        let mut agent_responses: Vec<AgentResponse> = Vec::new();
        let mut failed_agents: Vec<FailedAgent> = Vec::new();

        for (agent_type, result) in [
            (AgentType::Security, security_result),
            (AgentType::Architecture, architecture_result),
            (AgentType::Style, style_result),
            (AgentType::Performance, performance_result),
        ] {
            match result {
                Some(Ok(response)) => {
                    println!("[AI] {} agent succeeded with {} findings", agent_type.as_str(), response.findings.len());
                    agent_responses.push(response);
                }
                Some(Err(e)) => {
                    println!("[AI] {} agent failed: {}", agent_type.as_str(), e);
                    failed_agents.push(FailedAgent {
                        agent_type,
                        error: e.to_string(),
                    });
                }
                None => {
                    println!("[AI] {} agent is disabled, skipping", agent_type.as_str());
                }
            }
        }

        // Require at least one successful agent
        if agent_responses.is_empty() {
            return Err(AppError::AIProvider(
                "All agents failed or are disabled. Please try again.".to_string(),
            ));
        }

        // Aggregate results
        let mut analysis = self.aggregate_responses(
            &agent_responses,
            &failed_agents,
            files,
            start_time.elapsed().as_millis() as u64,
        );

        // Run file grouping as a lightweight follow-up call
        let model = configs.values()
            .find(|c| c.enabled)
            .and_then(|c| c.model_override.as_deref())
            .unwrap_or(default_model);

        match timeout(
            Duration::from_secs(15),
            self.run_file_grouping(provider, api_key, model, files, pr_title, pr_body, &analysis.summary),
        ).await {
            Ok(Ok(groups)) => {
                println!("[AI] File grouping succeeded with {} groups", groups.len());
                analysis.file_groups = groups;
            }
            Ok(Err(e)) => {
                println!("[AI] File grouping failed: {}", e);
            }
            Err(_) => {
                println!("[AI] File grouping timed out");
            }
        }

        Ok(analysis)
    }

    async fn run_agent_if_enabled(
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

        if use_tools {
            let tool_config = tool_config.unwrap();
            Some(self.run_agent_with_tools(
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
            ).await)
        } else {
            Some(self.run_agent(
                config.agent_type,
                provider,
                api_key,
                model,
                pr_title,
                pr_body,
                files_context,
                codebase_context,
                custom_prompt,
            ).await)
        }
    }

    async fn run_agent(
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
    ) -> AppResult<AgentResponse> {
        let start_time = Instant::now();

        // Use custom prompt if provided, otherwise use default
        let default_prompt = get_system_prompt(agent_type);
        let system_prompt = custom_system_prompt.unwrap_or(default_prompt);

        let user_prompt = build_agent_prompt(
            agent_type,
            pr_title,
            pr_body,
            files_context,
            codebase_context,
        );

        // Apply timeout
        let result = timeout(
            Duration::from_secs(AGENT_TIMEOUT_SECS),
            self.client.call_with_system(provider, api_key, model, system_prompt, &user_prompt),
        )
        .await
        .map_err(|_| AppError::AIProvider(format!("{} agent timed out", agent_type.as_str())))?;

        let response_text = result?;
        let processing_time_ms = start_time.elapsed().as_millis() as u64;

        // Estimate token usage (rough approximation: ~4 chars per token)
        let prompt_chars = system_prompt.len() + user_prompt.len();
        let response_chars = response_text.len();
        let estimated_prompt_tokens = (prompt_chars / 4) as u32;
        let estimated_completion_tokens = (response_chars / 4) as u32;

        println!("[AI] {} agent completed in {}ms (~{} prompt + ~{} completion tokens)",
            agent_type.as_str(),
            processing_time_ms,
            estimated_prompt_tokens,
            estimated_completion_tokens
        );

        println!("[AI] {} agent raw response (first 500 chars): {}",
            agent_type.as_str(),
            &response_text.chars().take(500).collect::<String>()
        );

        // Parse the response
        let raw_response = parse_agent_response(&response_text)
            .map_err(|e| {
                println!("[AI] {} agent parse error: {}", agent_type.as_str(), e);
                e
            })?;

        Ok(AgentResponse {
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
            token_usage: Some(TokenUsage {
                prompt_tokens: estimated_prompt_tokens,
                completion_tokens: estimated_completion_tokens,
                total_tokens: estimated_prompt_tokens + estimated_completion_tokens,
            }),
        })
    }

    /// Run an agent with tool support
    async fn run_agent_with_tools(
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
    ) -> AppResult<AgentResponse> {
        let start_time = Instant::now();

        // Use custom prompt if provided, otherwise use default
        let default_prompt = get_system_prompt(agent_type);
        let base_system_prompt = custom_system_prompt.unwrap_or(default_prompt);

        // Enhance system prompt with tool instructions
        let system_prompt = format!(
            "{}\n\n## Available Tools\n\
            You have access to the following tools to help analyze this PR:\n\
            - `search_repo`: Search for patterns in the codebase using regex\n\
            - `read_file`: Read the contents of specific files\n\n\
            Use these tools when you need to:\n\
            - Find how a function/class/pattern is used elsewhere in the codebase\n\
            - Read related files to understand context\n\
            - Verify your assumptions about the code\n\n\
            After using tools, provide your final analysis in the expected JSON format.",
            base_system_prompt
        );

        let user_prompt = build_agent_prompt(
            agent_type,
            pr_title,
            pr_body,
            files_context,
            codebase_context,
        );

        // Create tool executor and context
        let tool_executor = ToolExecutor::new(tool_config.execution_config.clone());
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

        // Estimate token usage
        let prompt_chars = system_prompt.len() + user_prompt.len();
        let response_chars = response_text.len();
        let estimated_prompt_tokens = (prompt_chars / 4) as u32;
        let estimated_completion_tokens = (response_chars / 4) as u32;

        // Parse the response
        let raw_response = parse_agent_response(&response_text).map_err(|e| {
            println!("[AI] {} agent parse error: {}", agent_type.as_str(), e);
            e
        })?;

        Ok(AgentResponse {
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
            token_usage: Some(TokenUsage {
                prompt_tokens: estimated_prompt_tokens,
                completion_tokens: estimated_completion_tokens,
                total_tokens: estimated_prompt_tokens + estimated_completion_tokens,
            }),
        })
    }

    async fn run_file_grouping(
        &self,
        provider: &str,
        api_key: &str,
        model: &str,
        files: &[GitHubFile],
        pr_title: &str,
        pr_body: Option<&str>,
        summary: &str,
    ) -> AppResult<Vec<FileGroup>> {
        let prompt = build_grouping_prompt(files, pr_title, pr_body, summary);
        let system = "You are a code review assistant. Respond with ONLY valid JSON, no markdown fences or explanation.";

        let response = self.client.call_with_system(provider, api_key, model, system, &prompt).await?;

        // Parse JSON, stripping markdown fences if present
        let json_str = if response.contains("```json") {
            response
                .split("```json")
                .nth(1)
                .and_then(|s| s.split("```").next())
                .unwrap_or(&response)
        } else if response.contains("```") {
            response.split("```").nth(1).unwrap_or(&response)
        } else {
            &response
        };

        let mut groups: Vec<FileGroup> = serde_json::from_str(json_str.trim())
            .map_err(|e| AppError::AIProvider(format!("Failed to parse file groups: {}", e)))?;

        // Reconcile AI-reported filenames with actual PR filenames
        self.reconcile_group_filenames(&mut groups, files);

        Ok(groups)
    }

    /// Match AI-reported filenames to actual PR filenames using fuzzy matching.
    /// The AI often returns slightly different paths (leading slash, different casing, etc.)
    fn reconcile_group_filenames(&self, groups: &mut [FileGroup], files: &[GitHubFile]) {
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        for group in groups.iter_mut() {
            for gf in group.files.iter_mut() {
                if let Some(matched) = fuzzy_match_filename(&gf.filename, &actual_filenames) {
                    if matched != gf.filename {
                        println!("[AI] Filename reconciled: '{}' -> '{}'", gf.filename, matched);
                        gf.filename = matched.to_string();
                    }
                }
            }
        }
    }

    fn aggregate_responses(
        &self,
        responses: &[AgentResponse],
        failed_agents: &[FailedAgent],
        files: &[GitHubFile],
        total_time_ms: u64,
    ) -> OrchestratedAnalysis {
        // Calculate overall risk level
        let risk_level = self.calculate_risk_level(responses);

        // Build summary from agent summaries
        let summary = self.build_summary(responses);

        // Calculate file priorities
        let file_priorities = self.calculate_file_priorities(responses, files);

        // Build per-file analyses with annotations
        let file_analyses = self.build_file_analyses(responses, files);

        // Build categories from findings
        let categories = self.build_categories(responses, files);

        // Build key changes
        let key_changes = self.build_key_changes(responses);

        // Suggested review order based on priorities
        let suggested_review_order: Vec<String> = file_priorities
            .iter()
            .take(10)
            .map(|fp| fp.filename.clone())
            .collect();

        // Calculate total token usage across all agents
        let total_token_usage = responses.iter().fold(
            TokenUsage::default(),
            |acc, r| {
                if let Some(usage) = &r.token_usage {
                    TokenUsage {
                        prompt_tokens: acc.prompt_tokens + usage.prompt_tokens,
                        completion_tokens: acc.completion_tokens + usage.completion_tokens,
                        total_tokens: acc.total_tokens + usage.total_tokens,
                    }
                } else {
                    acc
                }
            },
        );

        OrchestratedAnalysis {
            summary,
            risk_level,
            file_priorities,
            file_analyses,
            categories,
            key_changes,
            suggested_review_order,
            agent_responses: responses.to_vec(),
            failed_agents: failed_agents.to_vec(),
            total_processing_time_ms: total_time_ms,
            total_token_usage,
            file_groups: Vec::new(), // Populated by caller after grouping
        }
    }

    fn calculate_risk_level(&self, responses: &[AgentResponse]) -> String {
        let mut high_count = 0;
        let mut medium_count = 0;

        for response in responses {
            match response.summary.risk_assessment.to_lowercase().as_str() {
                "high" => high_count += 1,
                "medium" => medium_count += 1,
                _ => {}
            }

            // Also consider critical/high severity findings
            for finding in &response.findings {
                match finding.severity {
                    Severity::Critical => high_count += 2,
                    Severity::High => high_count += 1,
                    _ => {}
                }
            }
        }

        if high_count >= 2 {
            "high".to_string()
        } else if high_count >= 1 || medium_count >= 2 {
            "medium".to_string()
        } else {
            "low".to_string()
        }
    }

    fn build_summary(&self, responses: &[AgentResponse]) -> String {
        let mut summaries: Vec<String> = Vec::new();

        for response in responses {
            if !response.summary.overview.is_empty() {
                summaries.push(format!(
                    "**{}**: {}",
                    capitalize(response.agent_type.as_str()),
                    response.summary.overview
                ));
            }
        }

        if summaries.is_empty() {
            "No significant issues found.".to_string()
        } else {
            summaries.join("\n\n")
        }
    }

    fn calculate_file_priorities(
        &self,
        responses: &[AgentResponse],
        files: &[GitHubFile],
    ) -> Vec<FilePriority> {
        let mut file_scores: HashMap<String, (u8, Vec<String>)> = HashMap::new();
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        // Initialize with all files
        for file in files {
            file_scores.insert(file.filename.clone(), (0, Vec::new()));
        }

        // Add scores from findings
        for response in responses {
            let agent_name = capitalize(response.agent_type.as_str());

            for finding in &response.findings {
                // Fuzzy-match to actual filename
                let matched = fuzzy_match_filename(&finding.file, &actual_filenames)
                    .unwrap_or(&finding.file);

                let entry = file_scores
                    .entry(matched.to_string())
                    .or_insert((0, Vec::new()));

                let severity_score = finding.severity.priority() * 2;
                entry.0 = entry.0.saturating_add(severity_score);
                entry.1.push(format!(
                    "{}: {} ({})",
                    agent_name,
                    finding.category,
                    format!("{:?}", finding.severity).to_lowercase()
                ));
            }

            // Add scores for priority files
            for priority_file in &response.priority_files {
                let matched = fuzzy_match_filename(priority_file, &actual_filenames)
                    .unwrap_or(priority_file);

                let entry = file_scores
                    .entry(matched.to_string())
                    .or_insert((0, Vec::new()));
                entry.0 = entry.0.saturating_add(3);
                entry.1.push(format!("{}: Priority file", agent_name));
            }
        }

        // Convert to sorted list
        let mut priorities: Vec<FilePriority> = file_scores
            .into_iter()
            .map(|(filename, (score, reasons))| FilePriority {
                filename,
                priority_score: score,
                reasons,
            })
            .collect();

        priorities.sort_by(|a, b| b.priority_score.cmp(&a.priority_score));
        priorities
    }

    fn build_file_analyses(
        &self,
        responses: &[AgentResponse],
        files: &[GitHubFile],
    ) -> Vec<FileAnalysis> {
        let mut file_map: HashMap<String, FileAnalysis> = HashMap::new();

        // Initialize with all files
        for file in files {
            file_map.insert(
                file.filename.clone(),
                FileAnalysis {
                    filename: file.filename.clone(),
                    importance_score: 0,
                    annotations: Vec::new(),
                    context: FileContext {
                        summary: String::new(),
                        purpose: String::new(),
                        related_files: Vec::new(),
                    },
                    agent_findings: Vec::new(),
                },
            );
        }

        // Collect actual filenames for fuzzy matching
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        // Add findings as annotations
        for response in responses {
            for finding in &response.findings {
                // Fuzzy-match AI-reported filename to actual PR files
                let file_key = fuzzy_match_filename(&finding.file, &actual_filenames)
                    .map(|s| s.to_string());

                if let Some(key) = file_key {
                    if let Some(analysis) = file_map.get_mut(&key) {
                    // Add to agent findings
                    analysis.agent_findings.push(finding.clone());

                    // Add annotation if line number exists
                    if let Some(line) = finding.line {
                        analysis.annotations.push(LineAnnotation {
                            line_number: line,
                            row_index: None, // Will be mapped by frontend
                            annotation_type: severity_to_annotation_type(&finding.severity),
                            message: finding.message.clone(),
                            sources: vec![response.agent_type],
                            severity: finding.severity,
                            category: finding.category.clone(),
                            suggestion: finding.suggestion.clone(),
                        });
                    }

                    // Update importance score
                    analysis.importance_score = analysis
                        .importance_score
                        .saturating_add(finding.severity.priority());
                    }
                }
            }
        }

        // Merge duplicate annotations on same line
        for analysis in file_map.values_mut() {
            analysis.annotations = merge_annotations(&analysis.annotations);
        }

        let mut analyses: Vec<FileAnalysis> = file_map.into_values().collect();
        analyses.sort_by(|a, b| b.importance_score.cmp(&a.importance_score));
        analyses
    }

    fn build_categories(&self, responses: &[AgentResponse], files: &[GitHubFile]) -> Vec<PRCategory> {
        let mut categories: HashMap<String, Vec<String>> = HashMap::new();
        let actual_filenames: Vec<&str> = files.iter().map(|f| f.filename.as_str()).collect();

        // Group files by agent concerns
        for response in responses {
            let agent_name = capitalize(response.agent_type.as_str());

            if !response.findings.is_empty() {
                let files_with_findings: Vec<String> = response
                    .findings
                    .iter()
                    .map(|f| fuzzy_match_filename(&f.file, &actual_filenames)
                        .unwrap_or(&f.file)
                        .to_string())
                    .collect::<std::collections::HashSet<_>>()
                    .into_iter()
                    .collect();

                categories.insert(
                    format!("{} Concerns", agent_name),
                    files_with_findings,
                );
            }
        }

        // Add uncategorized files
        let all_flagged_files: std::collections::HashSet<String> = categories
            .values()
            .flatten()
            .cloned()
            .collect();

        let other_files: Vec<String> = files
            .iter()
            .map(|f| f.filename.clone())
            .filter(|f| !all_flagged_files.contains(f))
            .collect();

        if !other_files.is_empty() {
            categories.insert("Other Changes".to_string(), other_files);
        }

        categories
            .into_iter()
            .map(|(name, files)| PRCategory {
                name: name.clone(),
                description: get_category_description(&name),
                files,
            })
            .collect()
    }

    fn build_key_changes(&self, responses: &[AgentResponse]) -> Vec<KeyChange> {
        let mut key_changes: Vec<KeyChange> = Vec::new();

        for response in responses {
            for finding in &response.findings {
                if matches!(finding.severity, Severity::Critical | Severity::High) {
                    key_changes.push(KeyChange {
                        file: finding.file.clone(),
                        line: finding.line.map(|l| l as i64),
                        description: finding.message.clone(),
                        importance: format!("{:?}", finding.severity).to_lowercase(),
                    });
                }
            }
        }

        // Limit to top 10
        key_changes.truncate(10);
        key_changes
    }
}

fn parse_agent_response(response: &str) -> AppResult<RawAgentResponse> {
    let json_str = if response.contains("```json") {
        response
            .split("```json")
            .nth(1)
            .and_then(|s| s.split("```").next())
            .unwrap_or(response)
    } else if response.contains("```") {
        response.split("```").nth(1).unwrap_or(response)
    } else {
        response
    };

    serde_json::from_str(json_str.trim())
        .map_err(|e| AppError::AIProvider(format!("Failed to parse agent response: {}", e)))
}

fn severity_to_annotation_type(severity: &Severity) -> AnnotationType {
    match severity {
        Severity::Critical | Severity::High => AnnotationType::Warning,
        Severity::Medium | Severity::Low => AnnotationType::Info,
        Severity::Info => AnnotationType::Suggestion,
    }
}

fn merge_annotations(annotations: &[LineAnnotation]) -> Vec<LineAnnotation> {
    let mut by_line: HashMap<u32, LineAnnotation> = HashMap::new();

    for ann in annotations {
        if let Some(existing) = by_line.get_mut(&ann.line_number) {
            // Merge sources
            for source in &ann.sources {
                if !existing.sources.contains(source) {
                    existing.sources.push(*source);
                }
            }
            // Keep higher severity
            if ann.severity.priority() > existing.severity.priority() {
                existing.severity = ann.severity;
                existing.annotation_type = ann.annotation_type.clone();
            }
            // Combine messages
            existing.message = format!("{}\n\n{}", existing.message, ann.message);
        } else {
            by_line.insert(ann.line_number, ann.clone());
        }
    }

    by_line.into_values().collect()
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => first.to_uppercase().chain(chars).collect(),
    }
}

fn get_category_description(name: &str) -> String {
    match name {
        "Security Concerns" => "Files with potential security vulnerabilities".to_string(),
        "Architecture Concerns" => "Files with architectural or design issues".to_string(),
        "Style Concerns" => "Files with style or consistency issues".to_string(),
        "Performance Concerns" => "Files with potential performance issues".to_string(),
        "Other Changes" => "Files without specific concerns flagged".to_string(),
        _ => "".to_string(),
    }
}
