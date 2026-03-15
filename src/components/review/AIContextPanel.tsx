import { useMemo } from "react";
import { Sparkles } from "lucide-react";
import { GitHubFile, FileAnalysis } from "@/lib/api";

export interface AIContextPanelProps {
  file: GitHubFile;
  fileAnalysis: FileAnalysis | null;
}

export function AIContextPanel({ file, fileAnalysis }: AIContextPanelProps) {
  // Use AI analysis if available, otherwise generate placeholder context
  const context = useMemo(() => {
    // If we have AI analysis, use it
    if (fileAnalysis && fileAnalysis.agent_findings.length > 0) {
      const topFinding = fileAnalysis.agent_findings[0];
      const findingCount = fileAnalysis.agent_findings.length;
      const severityCounts = fileAnalysis.agent_findings.reduce((acc, f) => {
        acc[f.severity] = (acc[f.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      let importance = "";
      if (severityCounts.critical || severityCounts.high) {
        importance = "Needs careful review";
      } else if (severityCounts.medium) {
        importance = "Review recommended";
      } else {
        importance = "Minor notes";
      }

      return {
        importance,
        description: `${findingCount} finding(s): ${topFinding.message}${findingCount > 1 ? ` (+${findingCount - 1} more)` : ""}`,
        isFromAI: true,
      };
    }

    // Fallback: Generate placeholder context based on file characteristics
    const filename = file.filename.toLowerCase();
    const isTest = filename.includes("test") || filename.includes("spec");
    const isConfig = filename.includes("config") || filename.includes(".json") || filename.includes(".yaml") || filename.includes(".toml");
    const isStyle = filename.includes(".css") || filename.includes(".scss") || filename.includes("style");
    const isMigration = filename.includes("migration");
    const isLargeChange = (file.additions + file.deletions) > 50;

    let importance = "";
    let description = "";

    if (isTest) {
      importance = "Test coverage change";
      description = `Updates test cases with ${file.additions} new lines. Verify test coverage is adequate for the related changes.`;
    } else if (isConfig) {
      importance = "Configuration change";
      description = "Configuration changes can affect application behavior. Review for security implications and environment compatibility.";
    } else if (isMigration) {
      importance = "Database migration";
      description = "Schema changes require careful review. Check for backwards compatibility and data integrity.";
    } else if (isStyle) {
      importance = "Styling update";
      description = "Visual changes to the application. Consider checking for responsiveness and accessibility.";
    } else if (isLargeChange) {
      importance = "Significant code change";
      description = `This file has ${file.additions + file.deletions} lines changed. Consider reviewing in detail for logic correctness.`;
    } else {
      importance = "Code modification";
      description = "Standard code change. Review for correctness and adherence to project conventions.";
    }

    return { importance, description, isFromAI: false };
  }, [file, fileAnalysis]);

  return (
    <div className="px-4 py-2.5 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-b flex-shrink-0">
      <div className="flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              {context.importance}
            </span>
            <span className="text-xs text-muted-foreground">
              • {context.isFromAI ? "AI Analysis" : "Auto-detected"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {context.description}
          </p>
        </div>
      </div>
    </div>
  );
}
