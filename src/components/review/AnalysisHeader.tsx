import { Sparkles, RefreshCw, FileCode, FolderOpen, Download, FileText } from "lucide-react";
import { OrchestratedAnalysis, LinkedRepo, GitHubPR } from "@/lib/api";
import { getRiskColor } from "@/lib/constants/agents";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAnalysisAsMarkdown, downloadMarkdown, downloadAsHTML } from "@/lib/exportAnalysis";
import { cn } from "@/lib/utils";

interface AnalysisHeaderProps {
  analysis: OrchestratedAnalysis;
  analysisMode: "pr_only" | "with_context";
  onSetAnalysisMode: (mode: "pr_only" | "with_context") => void;
  onRunAnalysis: () => void;
  linkedRepo: LinkedRepo | null | undefined;
  lastAnalysisMode: "pr_only" | "with_context" | null;
  pr: GitHubPR | undefined;
  owner: string | undefined;
  repo: string | undefined;
}

export function AnalysisHeader({ analysis, analysisMode, onSetAnalysisMode, onRunAnalysis, linkedRepo, lastAnalysisMode, pr, owner, repo }: AnalysisHeaderProps) {
  const totalFindings = analysis.agent_responses.reduce((sum, r) => sum + r.findings.length, 0);
  const totalTokens = analysis.total_token_usage?.total_tokens || 0;

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 dark:bg-purple-950/50 rounded-lg">
          <Sparkles className="h-5 w-5 text-purple-500" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">AI Analysis Complete</h2>
          <p className="text-sm text-muted-foreground">
            {totalFindings} finding{totalFindings !== 1 ? "s" : ""} · {(analysis.total_processing_time_ms / 1000).toFixed(1)}s · ~{(totalTokens / 1000).toFixed(1)}k tokens
            {lastAnalysisMode && (
              <> · {lastAnalysisMode === "with_context" ? "With Context" : "PR Only"}</>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <span className={cn("px-3 py-1 rounded-full text-sm font-medium", getRiskColor(analysis.risk_level))}>
          {analysis.risk_level.charAt(0).toUpperCase() + analysis.risk_level.slice(1)} Risk
        </span>
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
            onClick={() => linkedRepo?.profile_data && onSetAnalysisMode("with_context")}
            disabled={!linkedRepo?.profile_data}
            className={cn(
              "px-2 py-1 text-xs transition-colors flex items-center gap-1",
              analysisMode === "with_context"
                ? "bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted",
              !linkedRepo?.profile_data && "opacity-50 cursor-not-allowed"
            )}
            title={linkedRepo?.profile_data ? "Include codebase context" : "Link local repo in Settings"}
          >
            <FolderOpen className="h-3 w-3" />
            Context
          </button>
        </div>
        <Button variant="outline" size="sm" onClick={onRunAnalysis} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Re-analyze
        </Button>
        {pr && owner && repo && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={async () => {
                  const markdown = formatAnalysisAsMarkdown(
                    analysis,
                    pr,
                    owner,
                    repo,
                    lastAnalysisMode || undefined
                  );
                  try {
                    await downloadMarkdown(markdown, `${repo}-pr-${pr.number}-analysis.md`);
                  } catch (err) {
                    logger.error("Failed to save markdown:", err);
                  }
                }}
              >
                <FileText className="h-4 w-4 mr-2" />
                Download Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={async () => {
                  const markdown = formatAnalysisAsMarkdown(
                    analysis,
                    pr,
                    owner,
                    repo,
                    lastAnalysisMode || undefined
                  );
                  try {
                    await downloadAsHTML(
                      markdown,
                      `PR Analysis - ${repo} #${pr.number}`,
                      `${repo}-pr-${pr.number}-analysis.html`
                    );
                  } catch (err) {
                    logger.error("Failed to save HTML:", err);
                  }
                }}
              >
                <FileCode className="h-4 w-4 mr-2" />
                Download HTML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
