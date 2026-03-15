//! Per-agent pipeline architecture for customizable review analysis
//!
//! This module provides an extensible architecture where each agent type
//! (Security, Architecture, Style, Performance) can have its own customizable
//! pipeline with:
//! - Agent-specific context retrieval
//! - Custom prompt building
//! - Specialized tool selection
//! - Pre/post processing hooks

pub mod retrieval;

use std::collections::HashMap;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::error::AppResult;
use crate::github::GitHubFile;

use super::prompts::{build_agent_prompt, get_system_prompt};
use super::tools::{ToolContext, ToolDefinition, ToolExecutionConfig};
use super::types::{AgentResponse, AgentSummary, AgentType, RawAgentResponse};

/// A code example retrieved from the codebase for context
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeExample {
    /// Path to the file containing this code
    pub file_path: String,
    /// Type of code chunk (function, class, module, etc.)
    pub chunk_type: String,
    /// Name of the code element (function name, class name, etc.)
    pub name: String,
    /// The actual code content
    pub content: String,
    /// Starting line number in the file
    pub line_start: u32,
    /// Ending line number in the file
    pub line_end: u32,
    /// Similarity score if retrieved via semantic search (0.0 to 1.0)
    pub similarity_score: Option<f32>,
    /// Brief explanation of why this example is relevant
    pub why_relevant: Option<String>,
}

impl CodeExample {
    /// Estimate token count for this example (rough approximation: ~4 chars per token)
    pub fn estimated_tokens(&self) -> usize {
        (self.content.len() + self.file_path.len() + self.name.len()) / 4
    }

    /// Format this example for inclusion in a prompt
    pub fn to_prompt_format(&self) -> String {
        let relevance = self
            .why_relevant
            .as_ref()
            .map(|r| format!(" ({})", r))
            .unwrap_or_default();

        format!(
            "### {} - {} [lines {}-{}]{}\n```\n{}\n```",
            self.file_path, self.name, self.line_start, self.line_end, relevance, self.content
        )
    }
}

/// Context retrieved specifically for an agent
#[derive(Debug, Clone, Default)]
pub struct AgentContext {
    /// Code examples similar to what's being changed
    pub similar_code: Vec<CodeExample>,
    /// Pattern-specific examples (e.g., "error_handling", "api_structure")
    pub pattern_examples: HashMap<String, Vec<CodeExample>>,
    /// Additional custom instructions for this agent
    pub custom_instructions: Option<String>,
    /// Results from any pre-analysis checks (static analysis, linting, etc.)
    pub pre_analysis_results: Option<PreAnalysisResults>,
    /// The generic codebase context (profiler summary) if available
    pub codebase_summary: Option<String>,
}

impl AgentContext {
    /// Check if any context was retrieved
    pub fn has_context(&self) -> bool {
        !self.similar_code.is_empty()
            || !self.pattern_examples.is_empty()
            || self.codebase_summary.is_some()
    }

    /// Estimate total token count across all examples
    pub fn estimated_tokens(&self) -> usize {
        let similar_tokens: usize = self.similar_code.iter().map(|e| e.estimated_tokens()).sum();
        let pattern_tokens: usize = self
            .pattern_examples
            .values()
            .flatten()
            .map(|e| e.estimated_tokens())
            .sum();
        let summary_tokens = self.codebase_summary.as_ref().map(|s| s.len() / 4).unwrap_or(0);

        similar_tokens + pattern_tokens + summary_tokens
    }
}

/// Results from pre-analysis checks (static analysis, linting, etc.)
#[derive(Debug, Clone, Default)]
pub struct PreAnalysisResults {
    /// Findings from static analysis tools
    pub static_analysis_findings: Vec<StaticAnalysisFinding>,
    /// Any warnings or notes from the pre-analysis phase
    #[allow(dead_code)]
    pub notes: Vec<String>,
}

/// A finding from a static analysis tool
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct StaticAnalysisFinding {
    pub tool: String,
    pub file: String,
    pub line: Option<u32>,
    pub message: String,
    pub severity: String,
}

/// Repository context shared across all agents during analysis
#[derive(Debug, Clone)]
pub struct RepoContext {
    /// Index ID if the repository has been indexed for embeddings
    pub index_id: Option<i64>,
    /// Path to the local repository
    pub repo_path: Option<String>,
    /// Full name of the repository (e.g., "owner/repo")
    pub repo_full_name: Option<String>,
    /// Whether the repository has embeddings available
    pub has_embeddings: bool,
    /// Tool context for executing tools
    pub tool_context: Option<ToolContext>,
}

impl RepoContext {
    /// Create an empty context (no repository linked)
    pub fn empty() -> Self {
        Self {
            index_id: None,
            repo_path: None,
            repo_full_name: None,
            has_embeddings: false,
            tool_context: None,
        }
    }

    /// Check if context retrieval is possible
    pub fn can_retrieve_context(&self) -> bool {
        self.has_embeddings || self.repo_path.is_some()
    }
}

/// Execution configuration for an agent
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct AgentExecutionConfig {
    /// Whether tools are enabled for this agent
    pub use_tools: bool,
    /// Tool execution configuration
    pub tool_config: ToolExecutionConfig,
    /// Timeout in seconds for agent execution
    pub timeout_secs: u64,
    /// Model override for this agent (if any)
    pub model_override: Option<String>,
}

impl Default for AgentExecutionConfig {
    fn default() -> Self {
        Self {
            use_tools: false,
            tool_config: ToolExecutionConfig::default(),
            timeout_secs: 60,
            model_override: None,
        }
    }
}

impl AgentExecutionConfig {
    /// Create config with tools enabled
    pub fn with_tools() -> Self {
        Self {
            use_tools: true,
            timeout_secs: 300, // 5 minutes when using tools
            ..Default::default()
        }
    }
}

/// Defines the full execution pipeline for an agent type
///
/// Each agent type (Security, Architecture, Style, Performance) implements
/// this trait to customize its analysis pipeline.
#[async_trait]
pub trait AgentPipeline: Send + Sync {
    /// Get the agent type this pipeline handles
    fn agent_type(&self) -> AgentType;

    /// Retrieve agent-specific context from the codebase
    ///
    /// This method is called before the LLM analysis to gather relevant
    /// code examples, patterns, and other context specific to this agent's
    /// domain.
    async fn retrieve_context(
        &self,
        pr_files: &[GitHubFile],
        repo_context: &RepoContext,
    ) -> AppResult<AgentContext>;

    /// Build the system prompt for this agent
    ///
    /// By default, uses the base system prompt from prompts.rs.
    /// Implementations can extend or modify the prompt.
    fn build_system_prompt(&self, context: &AgentContext) -> String {
        let base = get_system_prompt(self.agent_type());

        // If there are pre-analysis results, append them
        if let Some(ref results) = context.pre_analysis_results {
            if !results.static_analysis_findings.is_empty() {
                let findings = results
                    .static_analysis_findings
                    .iter()
                    .map(|f| {
                        format!(
                            "- [{}] {}:{} - {}",
                            f.tool,
                            f.file,
                            f.line.map(|l| l.to_string()).unwrap_or_default(),
                            f.message
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                return format!(
                    "{}\n\n## Pre-Analysis Findings\n\
                     The following issues were found by static analysis tools. \
                     Consider these when reviewing:\n{}",
                    base, findings
                );
            }
        }

        base.to_string()
    }

    /// Build the user prompt with retrieved context
    ///
    /// This is where agent-specific context (similar code, patterns, etc.)
    /// gets injected into the prompt.
    fn build_user_prompt(
        &self,
        pr_title: &str,
        pr_body: Option<&str>,
        files_context: &str,
        agent_context: &AgentContext,
    ) -> String {
        // Start with base prompt
        let codebase_context = agent_context.codebase_summary.as_deref();
        let base = build_agent_prompt(
            self.agent_type(),
            pr_title,
            pr_body,
            files_context,
            codebase_context,
        );

        // If no retrieved context, return base prompt
        if !agent_context.has_context() || agent_context.similar_code.is_empty() {
            return base;
        }

        // Add agent-specific context section
        let context_section = self.format_context_section(agent_context);

        // Insert context section before the "Changed Files" section
        if let Some(pos) = base.find("## Changed Files") {
            let (before, after) = base.split_at(pos);
            format!("{}\n{}\n{}", before, context_section, after)
        } else {
            // Fallback: append at the end
            format!("{}\n\n{}", base, context_section)
        }
    }

    /// Format the context section for this agent
    ///
    /// Override this to customize how similar code and patterns are presented
    fn format_context_section(&self, context: &AgentContext) -> String {
        let mut sections = Vec::new();

        // Add similar code section
        if !context.similar_code.is_empty() {
            let examples = context
                .similar_code
                .iter()
                .take(5) // Limit to avoid prompt bloat
                .map(|e| e.to_prompt_format())
                .collect::<Vec<_>>()
                .join("\n\n");

            sections.push(format!(
                "## Related Code from This Codebase\n\
                 The following code examples show similar patterns in this codebase. \
                 Compare the PR's approach to these existing patterns.\n\n{}",
                examples
            ));
        }

        // Add pattern-specific sections
        for (pattern_name, examples) in &context.pattern_examples {
            if !examples.is_empty() {
                let formatted = examples
                    .iter()
                    .take(3)
                    .map(|e| e.to_prompt_format())
                    .collect::<Vec<_>>()
                    .join("\n\n");

                sections.push(format!(
                    "## {} Pattern Examples\n\
                     Here's how {} is handled elsewhere in this codebase:\n\n{}",
                    pattern_name.replace('_', " "),
                    pattern_name.replace('_', " ").to_lowercase(),
                    formatted
                ));
            }
        }

        // Add custom instructions if present
        if let Some(ref instructions) = context.custom_instructions {
            sections.push(format!("## Additional Instructions\n{}", instructions));
        }

        sections.join("\n\n")
    }

    /// Get tool definitions available to this agent
    ///
    /// Override to customize which tools are available
    fn get_available_tools(&self, _repo_context: &RepoContext) -> Vec<ToolDefinition> {
        // Default: return empty (no tools)
        // Implementations can add agent-specific tools
        Vec::new()
    }

    /// Get execution configuration for this agent
    fn execution_config(&self) -> AgentExecutionConfig {
        AgentExecutionConfig::default()
    }

    /// Post-process the raw agent response
    ///
    /// Override to validate or transform findings
    fn post_process(&self, response: RawAgentResponse, processing_time_ms: u64) -> AgentResponse {
        AgentResponse {
            agent_type: self.agent_type(),
            summary: AgentSummary {
                overview: response.summary.overview,
                risk_assessment: response.summary.risk_assessment,
                top_concerns: response.summary.top_concerns,
            },
            findings: response
                .findings
                .into_iter()
                .map(|f| f.into_finding())
                .collect(),
            priority_files: response.priority_files,
            processing_time_ms,
            token_usage: None,
        }
    }

    /// Optional: Run external tools/checks before LLM analysis
    ///
    /// Override to run static analysis, linting, or other checks
    async fn run_pre_analysis_checks(
        &self,
        _pr_files: &[GitHubFile],
        _repo_context: &RepoContext,
    ) -> Option<PreAnalysisResults> {
        None
    }
}

// ============================================================================
// Default Pipeline Implementations
// ============================================================================

/// Security agent pipeline
pub struct SecurityPipeline;

#[async_trait]
impl AgentPipeline for SecurityPipeline {
    fn agent_type(&self) -> AgentType {
        AgentType::Security
    }

    async fn retrieve_context(
        &self,
        pr_files: &[GitHubFile],
        repo_context: &RepoContext,
    ) -> AppResult<AgentContext> {
        // For now, return minimal context
        // TODO: Implement security-specific retrieval (auth patterns, input validation, etc.)
        let mut context = AgentContext::default();

        if repo_context.can_retrieve_context() {
            // Security-specific patterns to look for
            context.pattern_examples = retrieval::retrieve_patterns(
                pr_files,
                repo_context,
                &["authentication", "authorization", "input_validation", "crypto"],
            )
            .await
            .unwrap_or_default();
        }

        Ok(context)
    }

    fn format_context_section(&self, context: &AgentContext) -> String {
        let mut sections = Vec::new();

        // Security-specific formatting
        if let Some(auth_examples) = context.pattern_examples.get("authentication") {
            if !auth_examples.is_empty() {
                let examples = auth_examples
                    .iter()
                    .take(3)
                    .map(|e| e.to_prompt_format())
                    .collect::<Vec<_>>()
                    .join("\n\n");

                sections.push(format!(
                    "## Authentication Patterns in This Codebase\n\
                     Here's how authentication is handled elsewhere:\n\n{}",
                    examples
                ));
            }
        }

        if let Some(validation_examples) = context.pattern_examples.get("input_validation") {
            if !validation_examples.is_empty() {
                let examples = validation_examples
                    .iter()
                    .take(3)
                    .map(|e| e.to_prompt_format())
                    .collect::<Vec<_>>()
                    .join("\n\n");

                sections.push(format!(
                    "## Input Validation Patterns\n\
                     Here's how input validation is done elsewhere:\n\n{}",
                    examples
                ));
            }
        }

        // Fall back to default formatting for any other patterns
        if sections.is_empty() {
            return String::new();
        }

        sections.push(
            "CRITICAL: Compare the PR's security approach to these existing patterns. \
             Flag any inconsistencies or missing security measures."
                .to_string(),
        );

        sections.join("\n\n")
    }
}

/// Architecture agent pipeline
pub struct ArchitecturePipeline;

#[async_trait]
impl AgentPipeline for ArchitecturePipeline {
    fn agent_type(&self) -> AgentType {
        AgentType::Architecture
    }

    async fn retrieve_context(
        &self,
        pr_files: &[GitHubFile],
        repo_context: &RepoContext,
    ) -> AppResult<AgentContext> {
        let mut context = AgentContext::default();

        if repo_context.can_retrieve_context() {
            // Find similar structures (services, components, modules)
            context.similar_code =
                retrieval::find_similar_code(pr_files, repo_context, 5).await?;

            // Architecture-specific patterns
            context.pattern_examples = retrieval::retrieve_patterns(
                pr_files,
                repo_context,
                &["error_handling", "api_structure", "dependency_injection"],
            )
            .await
            .unwrap_or_default();
        }

        Ok(context)
    }

    fn format_context_section(&self, context: &AgentContext) -> String {
        let mut sections = Vec::new();

        // Similar structures
        if !context.similar_code.is_empty() {
            let examples = context
                .similar_code
                .iter()
                .take(5)
                .map(|e| e.to_prompt_format())
                .collect::<Vec<_>>()
                .join("\n\n");

            sections.push(format!(
                "## Similar Structures in This Codebase\n\
                 The following code shows how similar functionality is structured. \
                 Compare the PR's approach to these established patterns:\n\n{}",
                examples
            ));
        }

        // Error handling patterns
        if let Some(error_examples) = context.pattern_examples.get("error_handling") {
            if !error_examples.is_empty() {
                let examples = error_examples
                    .iter()
                    .take(3)
                    .map(|e| e.to_prompt_format())
                    .collect::<Vec<_>>()
                    .join("\n\n");

                sections.push(format!(
                    "## Error Handling Pattern\n\
                     This is how error handling is done in this codebase:\n\n{}",
                    examples
                ));
            }
        }

        if sections.is_empty() {
            return String::new();
        }

        sections.push(
            "CRITICAL: When reviewing, explicitly compare the PR to these examples.\n\
             - Does the PR follow the same structural patterns?\n\
             - Does error handling match the established approach?\n\
             - Flag any significant deviations and assess if they're improvements or regressions."
                .to_string(),
        );

        sections.join("\n\n")
    }
}

/// Style agent pipeline
pub struct StylePipeline;

#[async_trait]
impl AgentPipeline for StylePipeline {
    fn agent_type(&self) -> AgentType {
        AgentType::Style
    }

    async fn retrieve_context(
        &self,
        pr_files: &[GitHubFile],
        repo_context: &RepoContext,
    ) -> AppResult<AgentContext> {
        let mut context = AgentContext::default();

        if repo_context.can_retrieve_context() {
            // Get style exemplars from similar file types
            context.similar_code =
                retrieval::extract_style_exemplars(pr_files, repo_context, 5).await?;
        }

        Ok(context)
    }

    fn format_context_section(&self, context: &AgentContext) -> String {
        if context.similar_code.is_empty() {
            return String::new();
        }

        let examples = context
            .similar_code
            .iter()
            .take(5)
            .map(|e| e.to_prompt_format())
            .collect::<Vec<_>>()
            .join("\n\n");

        format!(
            "## Style Reference from This Codebase\n\n\
             Do NOT apply generic style guides. Match THIS codebase's actual style.\n\n\
             The following code samples show the prevailing style in this repository:\n\n\
             {}\n\n\
             CRITICAL: Compare the PR's style to THESE examples, not generic best practices.\n\
             Report inconsistencies with specific reference to codebase examples.",
            examples
        )
    }
}

/// Performance agent pipeline
pub struct PerformancePipeline;

#[async_trait]
impl AgentPipeline for PerformancePipeline {
    fn agent_type(&self) -> AgentType {
        AgentType::Performance
    }

    async fn retrieve_context(
        &self,
        pr_files: &[GitHubFile],
        repo_context: &RepoContext,
    ) -> AppResult<AgentContext> {
        let mut context = AgentContext::default();

        if repo_context.can_retrieve_context() {
            // Performance-specific patterns
            context.pattern_examples = retrieval::retrieve_patterns(
                pr_files,
                repo_context,
                &["caching", "database_queries", "async_patterns"],
            )
            .await
            .unwrap_or_default();
        }

        Ok(context)
    }
}

// ============================================================================
// Pipeline Registry
// ============================================================================

/// Registry of agent pipelines
pub struct PipelineRegistry {
    pipelines: HashMap<AgentType, Box<dyn AgentPipeline>>,
}

impl PipelineRegistry {
    /// Create a new registry with default pipelines
    pub fn new() -> Self {
        let mut pipelines: HashMap<AgentType, Box<dyn AgentPipeline>> = HashMap::new();
        pipelines.insert(AgentType::Security, Box::new(SecurityPipeline));
        pipelines.insert(AgentType::Architecture, Box::new(ArchitecturePipeline));
        pipelines.insert(AgentType::Style, Box::new(StylePipeline));
        pipelines.insert(AgentType::Performance, Box::new(PerformancePipeline));
        Self { pipelines }
    }

    /// Get a pipeline for an agent type
    pub fn get(&self, agent_type: AgentType) -> Option<&dyn AgentPipeline> {
        self.pipelines.get(&agent_type).map(|p| p.as_ref())
    }

    /// Register a custom pipeline
    #[allow(dead_code)]
    pub fn register(&mut self, pipeline: Box<dyn AgentPipeline>) {
        self.pipelines.insert(pipeline.agent_type(), pipeline);
    }
}

impl Default for PipelineRegistry {
    fn default() -> Self {
        Self::new()
    }
}
