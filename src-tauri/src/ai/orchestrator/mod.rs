use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tokio::time::{timeout, Duration};

use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::github::GitHubFile;

use super::client::AIClient;
use super::events::AnalysisEvent;
use super::pipeline::{PipelineRegistry, RepoContext};
use super::prompts::{build_agent_prompt_for_model, build_files_context, build_grouping_prompt, get_system_prompt};
use super::tools::{ToolContext, ToolExecutionConfig, ToolExecutor};
use super::types::{
    AgentResponse, AgentSummary, AgentType, AnnotationType, DiagnosticLog, FailedAgent,
    FileAnalysis, FileContext, FileGroup, FilePriority, KeyChange, LineAnnotation,
    OrchestratedAnalysis, PRCategory, RawAgentResponse, Severity, SharedDiagnostics, TokenUsage,
};

pub type EventEmitter = Arc<dyn Fn(AnalysisEvent) + Send + Sync>;

pub(super) const AGENT_TIMEOUT_SECS: u64 = 60;
pub(super) const AGENT_WITH_TOOLS_TIMEOUT_SECS: u64 = 300; // 5 minutes when using tools

mod agent_runner;
mod aggregator;
mod file_grouping;

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

    #[allow(dead_code)]
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
    pub(super) client: AIClient,
    pub(super) pipeline_registry: PipelineRegistry,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self {
            client: AIClient::new(),
            pipeline_registry: PipelineRegistry::new(),
        }
    }

    /// Build RepoContext from ToolConfig for pipeline usage
    fn build_repo_context(
        tool_config: Option<&ToolConfig>,
        has_embeddings: bool,
        index_id: Option<i64>,
    ) -> RepoContext {
        match tool_config {
            Some(tc) => RepoContext {
                index_id,
                repo_path: tc.repo_path.clone(),
                repo_full_name: tc.repo_full_name.clone(),
                has_embeddings,
                tool_context: Some(ToolContext {
                    repo_path: tc.repo_path.clone(),
                    repo_full_name: tc.repo_full_name.clone(),
                    user_id: tc.user_id.clone(),
                }),
            },
            None => RepoContext::empty(),
        }
    }

    /// Run all agents in parallel and aggregate results
    #[allow(dead_code)]
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
        self.analyze_pr_with_events(
            provider, api_key, default_model, pr_title, pr_body,
            files, codebase_context, agent_configs, tool_config,
            None, None,
        ).await
    }

    /// Run all agents with event emission and cancellation support
    pub async fn analyze_pr_with_events(
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
        event_emitter: Option<EventEmitter>,
        cancel_token: Option<CancellationToken>,
    ) -> AppResult<OrchestratedAnalysis> {
        let start_time = Instant::now();
        let emit = {
            let emitter = event_emitter.clone();
            move |event: AnalysisEvent| {
                if let Some(ref emitter) = emitter {
                    emitter(event);
                }
            }
        };
        let diag = SharedDiagnostics::new();
        let files_context = build_files_context(files);

        let use_pipelines_flag = codebase_context.is_some()
            && tool_config.as_ref().map(|tc| tc.repo_path.is_some()).unwrap_or(false);
        let any_tools = tool_config.is_some();

        diag.log(None, "analysis_start", serde_json::json!({
            "provider": provider,
            "model": default_model,
            "file_count": files.len(),
            "use_pipelines": use_pipelines_flag,
            "has_tool_config": any_tools,
        }));
        emit(AnalysisEvent::AnalysisStarted { agent_count: 4 });

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

        // Determine if we should use pipeline-based context retrieval
        // Use pipelines when:
        // 1. Codebase context is requested (with_codebase_context mode)
        // 2. We have a linked repository (repo_path is available)
        let use_pipelines = codebase_context.is_some()
            && tool_config_ref.map(|tc| tc.repo_path.is_some()).unwrap_or(false);

        // Build RepoContext for pipeline usage
        // TODO: Pass index_id and has_embeddings from caller when available
        let repo_context = Self::build_repo_context(tool_config_ref, false, None);

        // Run enabled agents in parallel
        // Note: The research agent is available as a tool (spawn_research_agent) that
        // any analysis agent can call on demand to investigate the codebase.
        let (security_result, architecture_result, style_result, performance_result) = if use_pipelines {
            println!("[AI] Using pipeline-based context retrieval for enhanced analysis");
            tokio::join!(
                self.run_agent_if_enabled_with_pipeline(
                    &security_config,
                    provider,
                    api_key,
                    default_model,
                    pr_title,
                    pr_body,
                    files,
                    &files_context,
                    codebase_context,
                    &repo_context,
                    tool_config_ref,
                    &diag,
                    &event_emitter,
                ),
                self.run_agent_if_enabled_with_pipeline(
                    &architecture_config,
                    provider,
                    api_key,
                    default_model,
                    pr_title,
                    pr_body,
                    files,
                    &files_context,
                    codebase_context,
                    &repo_context,
                    tool_config_ref,
                    &diag,
                    &event_emitter,
                ),
                self.run_agent_if_enabled_with_pipeline(
                    &style_config,
                    provider,
                    api_key,
                    default_model,
                    pr_title,
                    pr_body,
                    files,
                    &files_context,
                    codebase_context,
                    &repo_context,
                    tool_config_ref,
                    &diag,
                    &event_emitter,
                ),
                self.run_agent_if_enabled_with_pipeline(
                    &performance_config,
                    provider,
                    api_key,
                    default_model,
                    pr_title,
                    pr_body,
                    files,
                    &files_context,
                    codebase_context,
                    &repo_context,
                    tool_config_ref,
                    &diag,
                    &event_emitter,
                ),
            )
        } else {
            tokio::join!(
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
                    &diag,
                    &event_emitter,
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
                    &diag,
                    &event_emitter,
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
                    &diag,
                    &event_emitter,
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
                    &diag,
                    &event_emitter,
                ),
            )
        };

        // Check cancellation
        if cancel_token.as_ref().map(|t| t.is_cancelled()).unwrap_or(false) {
            emit(AnalysisEvent::AnalysisCancelled);
            return Err(AppError::AIProvider("Analysis cancelled".to_string()));
        }

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
                    emit(AnalysisEvent::AgentCompleted {
                        agent: agent_type.as_str().to_string(),
                        finding_count: response.findings.len() as u32,
                        time_ms: response.processing_time_ms,
                    });
                    agent_responses.push(response);
                }
                Some(Err(e)) => {
                    println!("[AI] {} agent failed: {}", agent_type.as_str(), e);
                    emit(AnalysisEvent::AgentFailed {
                        agent: agent_type.as_str().to_string(),
                        error: e.to_string(),
                    });
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

        emit(AnalysisEvent::FileGroupingStarted);
        match timeout(
            Duration::from_secs(15),
            self.run_file_grouping(provider, api_key, model, files, pr_title, pr_body, &analysis.summary),
        ).await {
            Ok(Ok(groups)) => {
                println!("[AI] File grouping succeeded with {} groups", groups.len());
                diag.log(None, "file_grouping", serde_json::json!({
                    "status": "success",
                    "group_count": groups.len(),
                }));
                emit(AnalysisEvent::FileGroupingCompleted { group_count: groups.len() as u32 });
                analysis.file_groups = groups;
            }
            Ok(Err(e)) => {
                println!("[AI] File grouping failed: {}", e);
                diag.log(None, "file_grouping", serde_json::json!({
                    "status": "error",
                    "error": e.to_string(),
                }));
            }
            Err(_) => {
                println!("[AI] File grouping timed out");
                diag.log(None, "file_grouping", serde_json::json!({
                    "status": "timeout",
                }));
            }
        }

        let total_time_ms = start_time.elapsed().as_millis() as u64;
        diag.log(None, "analysis_complete", serde_json::json!({
            "total_time_ms": total_time_ms,
            "agents_succeeded": analysis.agent_responses.len(),
            "agents_failed": analysis.failed_agents.len(),
        }));

        emit(AnalysisEvent::AnalysisCompleted { total_time_ms });

        analysis.diagnostics = diag.into_log();
        Ok(analysis)
    }
}
