import { Link } from "react-router-dom";
import { FileCode, Loader2, Sparkles, RefreshCw, AlertTriangle, ChevronDown, FolderOpen, Settings } from "lucide-react";
import { OrchestratedAnalysis, LinkedRepo } from "@/lib/api";
import { getRiskColor } from "@/lib/constants/agents";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AISummarySectionProps {
  analysis: OrchestratedAnalysis | null;
  isAnalyzing: boolean;
  error: string | null;
  onRunAnalysis: () => void;
  onViewFullAnalysis: () => void;
  linkedRepo: LinkedRepo | null | undefined;
  analysisMode: "pr_only" | "with_context";
  onSetAnalysisMode: (mode: "pr_only" | "with_context") => void;
  lastAnalysisMode: "pr_only" | "with_context" | null;
}

export function AISummarySection({
  analysis,
  isAnalyzing,
  error,
  onRunAnalysis,
  onViewFullAnalysis,
  linkedRepo,
  analysisMode,
  onSetAnalysisMode,
  lastAnalysisMode,
}: AISummarySectionProps) {
  const hasLinkedRepo = linkedRepo && linkedRepo.profile_data;

  // Analyzing state - compact loading indicator
  if (isAnalyzing) {
    return (
      <div className="rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
            <Loader2 className="h-5 w-5 text-purple-500 animate-spin" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              Running AI Analysis
            </h3>
            <p className="text-sm text-muted-foreground">
              4 specialized agents analyzing this PR...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Analysis complete - show summary
  if (analysis) {
    // Debug: Log all findings with their line numbers
    logger.log("[Analysis] All findings with line numbers:");
    analysis.agent_responses.forEach(r => {
      r.findings.forEach(f => {
        logger.log(`  [${r.agent_type}] ${f.file}:${f.line ?? 'NO LINE'} - ${f.message.substring(0, 50)}...`);
      });
    });
    logger.log("[Analysis] file_analyses count:", analysis.file_analyses.length);
    analysis.file_analyses.forEach(fa => {
      logger.log(`  File: ${fa.filename}, annotations: ${fa.annotations.length}, agent_findings: ${fa.agent_findings.length}`);
    });
    const totalFindings = analysis.agent_responses.reduce((sum, r) => sum + r.findings.length, 0);
    const criticalCount = analysis.agent_responses.reduce(
      (sum, r) => sum + r.findings.filter(f => f.severity === "critical" || f.severity === "high").length,
      0
    );

    return (
      <div className="rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex-shrink-0">
              <Sparkles className="h-5 w-5 text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium">AI Analysis</h3>
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", getRiskColor(analysis.risk_level))}>
                  {analysis.risk_level.charAt(0).toUpperCase() + analysis.risk_level.slice(1)} Risk
                </span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {analysis.summary}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {lastAnalysisMode && (
                  <span className="flex items-center gap-1">
                    {lastAnalysisMode === "with_context" ? (
                      <><FolderOpen className="h-3 w-3" /> With Context</>
                    ) : (
                      <><FileCode className="h-3 w-3" /> PR Only</>
                    )}
                  </span>
                )}
                <span>{totalFindings} finding{totalFindings !== 1 ? "s" : ""}</span>
                {criticalCount > 0 && (
                  <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {criticalCount} critical/high
                  </span>
                )}
                <span>~{((analysis.total_token_usage?.total_tokens || 0) / 1000).toFixed(1)}k tokens</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mode toggle for re-run */}
            <div className="flex border rounded-md overflow-hidden">
              <button
                onClick={() => onSetAnalysisMode("pr_only")}
                className={cn(
                  "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                  analysisMode === "pr_only"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                )}
                title="PR diff only"
              >
                <FileCode className="h-3 w-3" />
                PR
              </button>
              <button
                onClick={() => hasLinkedRepo && onSetAnalysisMode("with_context")}
                disabled={!hasLinkedRepo}
                className={cn(
                  "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                  analysisMode === "with_context"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                  !hasLinkedRepo && "opacity-50 cursor-not-allowed"
                )}
                title={hasLinkedRepo ? "Include codebase context" : "Link local repo in Settings"}
              >
                <FolderOpen className="h-3 w-3" />
                Context
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRunAnalysis}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run
            </Button>
            <Button
              size="sm"
              onClick={onViewFullAnalysis}
              className="gap-1.5"
            >
              View Details
              <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // No analysis yet - show run controls
  return (
    <div className="rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex-shrink-0">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-medium mb-1">AI-Powered Analysis</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Get risk assessment, code quality analysis, and review priorities.
            </p>

            {/* Analysis Mode Toggle */}
            <div className="flex items-center gap-2">
              <div className="flex border rounded-md overflow-hidden">
                <button
                  onClick={() => onSetAnalysisMode("pr_only")}
                  className={cn(
                    "px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5",
                    analysisMode === "pr_only"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  )}
                >
                  <FileCode className="h-3.5 w-3.5" />
                  PR Only
                </button>
                <button
                  onClick={() => hasLinkedRepo && onSetAnalysisMode("with_context")}
                  disabled={!hasLinkedRepo}
                  className={cn(
                    "px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5",
                    analysisMode === "with_context"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted",
                    !hasLinkedRepo && "opacity-50 cursor-not-allowed"
                  )}
                  title={hasLinkedRepo ? "Include codebase context" : "Link local repo in Settings"}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  With Context
                </button>
              </div>
              {!hasLinkedRepo && (
                <Link
                  to="/settings/repositories"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Settings className="h-3 w-3" />
                  Link repo
                </Link>
              )}
            </div>
          </div>
        </div>

        <Button onClick={onRunAnalysis} className="gap-2 flex-shrink-0">
          <Sparkles className="h-4 w-4" />
          Run Analysis
        </Button>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}
