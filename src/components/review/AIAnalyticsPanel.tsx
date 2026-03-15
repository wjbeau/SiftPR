import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { FileCode, Sparkles, AlertTriangle, FolderOpen, Files, Settings, Terminal } from "lucide-react";
import { OrchestratedAnalysis, AgentType, LinkedRepo, GitHubPR } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AnalysisLoadingState } from "./AnalysisLoadingState";
import { DiagnosticsTab } from "./DiagnosticsTab";
import { AnalysisHeader } from "./AnalysisHeader";
import { AgentResultCard } from "./AgentResultCard";

export interface AIAnalyticsPanelProps {
  analysis: OrchestratedAnalysis | null;
  isAnalyzing: boolean;
  error: string | null;
  onRunAnalysis: () => void;
  linkedRepo: LinkedRepo | null | undefined;
  analysisMode: "pr_only" | "with_context";
  onSetAnalysisMode: (mode: "pr_only" | "with_context") => void;
  lastAnalysisMode: "pr_only" | "with_context" | null;
  pr: GitHubPR | undefined;
  owner: string | undefined;
  repo: string | undefined;
}

export function AIAnalyticsPanel({ analysis, isAnalyzing, error, onRunAnalysis, linkedRepo, analysisMode, onSetAnalysisMode, lastAnalysisMode, pr, owner, repo }: AIAnalyticsPanelProps) {
  const [expandedAgents, setExpandedAgents] = useState<Set<AgentType>>(new Set());
  const [activeTab, setActiveTab] = useState<"analysis" | "diagnostics">("analysis");

  const toggleAgent = (agentType: AgentType) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentType)) {
        next.delete(agentType);
      } else {
        next.add(agentType);
      }
      return next;
    });
  };

  // Sort agent responses by priority (highest severity findings first)
  const sortedAgentResponses = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.agent_responses].sort((a, b) => {
      const getScore = (response: typeof a) => {
        let score = 0;
        for (const f of response.findings) {
          if (f.severity === "critical") score += 100;
          else if (f.severity === "high") score += 50;
          else if (f.severity === "medium") score += 10;
          else if (f.severity === "low") score += 1;
        }
        if (response.summary.risk_assessment === "high") score += 30;
        else if (response.summary.risk_assessment === "medium") score += 15;
        return score;
      };
      return getScore(b) - getScore(a);
    });
  }, [analysis]);

  // Show empty state if no analysis
  if (!analysis && !isAnalyzing) {
    const hasLinkedRepo = linkedRepo && linkedRepo.profile_data;

    return (
      <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
        <div className="p-4 bg-purple-100 dark:bg-purple-950/50 rounded-full mb-6">
          <Sparkles className="h-12 w-12 text-purple-500" />
        </div>

        <h2 className="text-xl font-semibold mb-2">AI-Powered Analysis</h2>
        <p className="text-muted-foreground mb-4">
          Get intelligent insights about this pull request including risk assessment,
          code quality analysis, and suggested review focus areas.
        </p>

        {/* Analysis Mode Toggle */}
        <div className="w-full p-4 bg-muted/50 rounded-lg mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-sm font-medium">Analysis Mode</span>
          </div>
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => onSetAnalysisMode("pr_only")}
              className={cn(
                "flex-1 px-4 py-2 text-sm transition-colors flex items-center justify-center gap-2",
                analysisMode === "pr_only"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              )}
            >
              <FileCode className="h-4 w-4" />
              PR Only
            </button>
            <button
              onClick={() => hasLinkedRepo && onSetAnalysisMode("with_context")}
              disabled={!hasLinkedRepo}
              className={cn(
                "flex-1 px-4 py-2 text-sm transition-colors flex items-center justify-center gap-2",
                analysisMode === "with_context"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
                !hasLinkedRepo && "opacity-50 cursor-not-allowed"
              )}
              title={hasLinkedRepo ? "Analyze with local codebase context" : "Link a local repo in Settings to enable"}
            >
              <FolderOpen className="h-4 w-4" />
              With Context
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {analysisMode === "pr_only" ? (
              "Analyze just the changed files in this PR"
            ) : (
              "Include patterns and conventions from your local codebase"
            )}
          </p>
          {!hasLinkedRepo && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Settings className="h-3.5 w-3.5" />
              <Link to="/settings/repositories" className="hover:underline">
                Link a local repository to enable context mode
              </Link>
            </div>
          )}
          {linkedRepo && !linkedRepo.profile_data && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Local repo linked but not analyzed yet. <Link to="/settings/repositories" className="hover:underline">Run analysis in Settings</Link></span>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 mb-6">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <Button onClick={onRunAnalysis} className="gap-2">
          <Sparkles className="h-4 w-4" />
          Run Analysis
        </Button>
      </div>
    );
  }

  // Show loading state
  if (isAnalyzing) {
    return <AnalysisLoadingState />;
  }

  // Show analysis results
  if (!analysis) return null;

  return (
    <div className="space-y-6">
      {/* Header with risk level */}
      <AnalysisHeader
        analysis={analysis}
        analysisMode={analysisMode}
        onSetAnalysisMode={onSetAnalysisMode}
        onRunAnalysis={onRunAnalysis}
        linkedRepo={linkedRepo}
        lastAnalysisMode={lastAnalysisMode}
        pr={pr}
        owner={owner}
        repo={repo}
      />

      {/* Tab Bar */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("analysis")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            activeTab === "analysis"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          Analysis
        </button>
        <button
          onClick={() => setActiveTab("diagnostics")}
          className={cn(
            "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5",
            activeTab === "diagnostics"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Terminal className="h-3.5 w-3.5" />
          Diagnostics
          {analysis.diagnostics && analysis.diagnostics.entries.length > 0 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{analysis.diagnostics.entries.length}</span>
          )}
        </button>
      </div>

      {/* Diagnostics Tab */}
      {activeTab === "diagnostics" && (
        <DiagnosticsTab entries={analysis.diagnostics?.entries ?? []} />
      )}

      {/* Analysis Tab */}
      {activeTab === "analysis" && <>

      {/* Failed agents warning */}
      {analysis.failed_agents.length > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">
              {analysis.failed_agents.length} agent(s) failed
            </span>
          </div>
          <ul className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            {analysis.failed_agents.map((fa) => (
              <li key={fa.agent_type}>• {fa.agent_type}: {fa.error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent Results - Stacked and sorted by severity */}
      <div className="space-y-3">
        {sortedAgentResponses.map((response) => (
          <AgentResultCard
            key={response.agent_type}
            response={response}
            isExpanded={expandedAgents.has(response.agent_type)}
            onToggle={toggleAgent}
          />
        ))}
      </div>

      {/* Suggested Review Order */}
      {analysis.suggested_review_order.length > 0 && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <Files className="h-4 w-4 text-muted-foreground" />
            Suggested Review Order
          </h3>
          <ol className="space-y-1 text-sm">
            {analysis.suggested_review_order.slice(0, 5).map((file, i) => (
              <li key={file} className="flex items-center gap-2 text-muted-foreground">
                <span className="w-5 h-5 bg-background rounded-full flex items-center justify-center text-xs font-medium">
                  {i + 1}
                </span>
                <span className="truncate font-mono text-xs">{file}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      </>}
    </div>
  );
}
