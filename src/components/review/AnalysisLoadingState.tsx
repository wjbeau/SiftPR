import { Sparkles, Loader2, Shield, Layers, Paintbrush, Zap, Check, X, Square } from "lucide-react";
import type { AgentType } from "@/lib/api";
import type { AgentProgress, AgentStatus } from "@/contexts/AnalysisContext";
import { AGENT_STATUS_MESSAGES } from "@/lib/constants/agents";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";

interface Props {
  agentProgress?: Record<string, AgentProgress>;
  isGroupingFiles?: boolean;
  onCancel?: () => void;
}

export function AnalysisLoadingState({ agentProgress, isGroupingFiles, onCancel }: Props) {
  // Fallback rotating messages for when no real progress events are available
  const [messageIndices, setMessageIndices] = useState<Record<AgentType, number>>({
    security: 0,
    architecture: 0,
    style: 0,
    performance: 0,
  });

  const hasRealProgress = agentProgress && Object.keys(agentProgress).length > 0;

  useEffect(() => {
    if (hasRealProgress) return; // Don't rotate when we have real progress

    const interval = setInterval(() => {
      setMessageIndices((prev) => {
        const agents: AgentType[] = ["security", "architecture", "style", "performance"];
        const randomAgent = agents[Math.floor(Math.random() * agents.length)];
        return {
          ...prev,
          [randomAgent]: (prev[randomAgent] + 1) % AGENT_STATUS_MESSAGES[randomAgent].length,
        };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, [hasRealProgress]);

  const agents: { type: AgentType; label: string; icon: React.ReactNode; color: string }[] = [
    { type: "security", label: "Security", icon: <Shield className="h-4 w-4" />, color: "text-red-500" },
    { type: "architecture", label: "Architecture", icon: <Layers className="h-4 w-4" />, color: "text-blue-500" },
    { type: "style", label: "Style", icon: <Paintbrush className="h-4 w-4" />, color: "text-purple-500" },
    { type: "performance", label: "Performance", icon: <Zap className="h-4 w-4" />, color: "text-amber-500" },
  ];

  function getStatusMessage(type: AgentType, progress?: AgentProgress): string {
    if (!progress || progress.status === "pending") {
      return "Waiting to start...";
    }
    if (progress.status === "running") {
      if (progress.lastToolCall) {
        return `Calling ${progress.lastToolCall}... (iteration ${progress.toolIteration ?? 1})`;
      }
      if (progress.mode === "tools" || progress.mode === "pipeline+tools") {
        return "Investigating codebase...";
      }
      return AGENT_STATUS_MESSAGES[type]?.[messageIndices[type]] ?? "Analyzing...";
    }
    if (progress.status === "completed") {
      const count = progress.findingCount ?? 0;
      const time = progress.timeMs ? `${(progress.timeMs / 1000).toFixed(1)}s` : "";
      return `Done - ${count} finding${count !== 1 ? "s" : ""}${time ? ` (${time})` : ""}`;
    }
    if (progress.status === "failed") {
      return `Failed: ${progress.error ?? "Unknown error"}`;
    }
    return "Analyzing...";
  }

  function getStatusIcon(status: AgentStatus) {
    switch (status) {
      case "completed":
        return <Check className="h-3 w-3 text-green-500" />;
      case "failed":
        return <X className="h-3 w-3 text-red-500" />;
      case "running":
        return <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />;
      default:
        return <Loader2 className="h-3 w-3 text-muted-foreground opacity-30" />;
    }
  }

  const completedCount = hasRealProgress
    ? Object.values(agentProgress!).filter((p) => p.status === "completed" || p.status === "failed").length
    : 0;

  return (
    <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
      <div className="p-4 bg-purple-100 dark:bg-purple-950/50 rounded-full mb-6">
        <Sparkles className="h-10 w-10 text-purple-500 animate-pulse" />
      </div>

      <h2 className="text-xl font-semibold mb-2">Analyzing Pull Request</h2>
      <p className="text-muted-foreground mb-6">
        {hasRealProgress
          ? `${completedCount}/4 agents completed`
          : "Running 4 specialized agents in parallel"}
      </p>

      <div className="w-full space-y-3 mb-6">
        {agents.map(({ type: agentType, label, icon, color }) => {
          const progress = agentProgress?.[agentType];
          const status = progress?.status ?? (hasRealProgress ? "pending" : "running");

          return (
            <div
              key={agentType}
              className={cn(
                "flex items-center gap-3 p-3 bg-muted/50 rounded-lg transition-opacity",
                status === "completed" && "opacity-70"
              )}
            >
              <div className={cn("p-2 rounded-lg bg-background", color)}>
                {icon}
              </div>
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{label}</span>
                  {getStatusIcon(status)}
                </div>
                <p className={cn(
                  "text-xs transition-all duration-300",
                  status === "failed" ? "text-red-500" : "text-muted-foreground"
                )}>
                  {hasRealProgress
                    ? getStatusMessage(agentType, progress)
                    : AGENT_STATUS_MESSAGES[agentType][messageIndices[agentType]]}
                </p>
              </div>
            </div>
          );
        })}

        {isGroupingFiles && (
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <div className="p-2 rounded-lg bg-background text-indigo-500">
              <Layers className="h-4 w-4" />
            </div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">File Grouping</span>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">Organizing files by function...</p>
            </div>
          </div>
        )}
      </div>

      {onCancel && (
        <button
          onClick={onCancel}
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
        >
          <Square className="h-3 w-3" />
          Cancel Analysis
        </button>
      )}

      {!onCancel && (
        <p className="text-xs text-muted-foreground">This typically takes 30-60 seconds</p>
      )}
    </div>
  );
}
