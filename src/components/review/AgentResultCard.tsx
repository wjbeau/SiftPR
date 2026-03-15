import { ChevronDown } from "lucide-react";
import { AgentType, AgentResponse } from "@/lib/api";
import { getAgentIcon, getAgentColors, getRiskColor, getSeverityColor } from "@/lib/constants/agents";
import { cn } from "@/lib/utils";

interface AgentResultCardProps {
  response: AgentResponse;
  isExpanded: boolean;
  onToggle: (agentType: AgentType) => void;
}

export function AgentResultCard({ response, isExpanded, onToggle }: AgentResultCardProps) {
  const colors = getAgentColors(response.agent_type);
  const hasFindings = response.findings.length > 0;
  const Icon = getAgentIcon(response.agent_type);

  // Count findings by severity
  const severityCounts = response.findings.reduce((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className={cn("rounded-lg border", colors.border, colors.bg)}>
      {/* Agent Header - Always visible */}
      <button
        onClick={() => hasFindings && onToggle(response.agent_type)}
        className={cn(
          "w-full p-4 flex items-start gap-3 text-left",
          hasFindings && "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
        )}
        disabled={!hasFindings}
      >
        <div className={cn("p-2 rounded-lg bg-white dark:bg-black/20", colors.icon)}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold capitalize">{response.agent_type}</span>
            <span className={cn(
              "text-xs px-2 py-0.5 rounded-full",
              getRiskColor(response.summary.risk_assessment)
            )}>
              {response.summary.risk_assessment}
            </span>
            {hasFindings && (
              <span className="text-xs text-muted-foreground">
                {response.findings.length} finding{response.findings.length !== 1 ? "s" : ""}
              </span>
            )}
            {response.token_usage && (
              <span className="text-xs text-muted-foreground ml-auto">
                ~{(response.token_usage.total_tokens / 1000).toFixed(1)}k tokens
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {response.summary.overview}
          </p>
          {/* Severity badges */}
          {hasFindings && Object.keys(severityCounts).length > 0 && (
            <div className="flex gap-1.5 mt-2">
              {["critical", "high", "medium", "low", "info"].map(sev =>
                severityCounts[sev] ? (
                  <span key={sev} className={cn("text-xs px-1.5 py-0.5 rounded", getSeverityColor(sev))}>
                    {severityCounts[sev]} {sev}
                  </span>
                ) : null
              )}
            </div>
          )}
        </div>
        {hasFindings && (
          <ChevronDown className={cn(
            "h-5 w-5 text-muted-foreground transition-transform flex-shrink-0",
            isExpanded && "rotate-180"
          )} />
        )}
      </button>

      {/* Expanded Findings */}
      {isExpanded && hasFindings && (
        <div className="border-t border-inherit">
          <div className="p-4 space-y-3">
            {response.findings.map((finding, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-white dark:bg-black/20 rounded-lg">
                <span className={cn(
                  "text-xs px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5",
                  getSeverityColor(finding.severity)
                )}>
                  {finding.severity}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                    <span className="font-mono truncate">{finding.file}</span>
                    {finding.line && <span>Line {finding.line}</span>}
                    <span className="px-1.5 py-0.5 bg-muted rounded">{finding.category}</span>
                  </div>
                  <p className="text-sm">{finding.message}</p>
                  {finding.suggestion && (
                    <p className="text-sm text-muted-foreground mt-1 italic">
                      Suggestion: {finding.suggestion}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
