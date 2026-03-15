//! Typed analysis events for frontend progress tracking
//!
//! These events are emitted via Tauri's event system during PR analysis
//! to provide real-time progress updates to the UI.

use serde::Serialize;

/// Events emitted during PR analysis
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum AnalysisEvent {
    /// Analysis has started, agents are being launched
    AnalysisStarted {
        agent_count: u32,
    },
    /// An individual agent has started working
    AgentStarted {
        agent: String,
        mode: String,
    },
    /// An agent made a tool call (in tool-calling mode)
    AgentToolCall {
        agent: String,
        tool: String,
        iteration: u32,
    },
    /// An agent's JSON parse failed and is being retried
    #[allow(dead_code)]
    AgentRetrying {
        agent: String,
        attempt: u32,
        error: String,
    },
    /// An agent completed successfully
    AgentCompleted {
        agent: String,
        finding_count: u32,
        time_ms: u64,
    },
    /// An agent failed
    AgentFailed {
        agent: String,
        error: String,
    },
    /// File grouping step started
    FileGroupingStarted,
    /// File grouping completed
    FileGroupingCompleted {
        group_count: u32,
    },
    /// Full analysis completed
    AnalysisCompleted {
        total_time_ms: u64,
    },
    /// Analysis was cancelled by user
    AnalysisCancelled,
}

/// Channel name for analysis progress events
pub const ANALYSIS_PROGRESS_EVENT: &str = "analysis-progress";
