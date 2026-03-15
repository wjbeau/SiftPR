import { useState, useMemo } from "react";
import { Check, ChevronDown, Copy, Terminal } from "lucide-react";
import { DiagnosticEntry } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function DiagnosticsTab({ entries }: { entries: DiagnosticEntry[] }) {
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());

  // Group entries by agent
  const agents = useMemo(() => {
    const agentSet = new Set<string>();
    for (const e of entries) {
      if (e.agent) agentSet.add(e.agent);
    }
    return Array.from(agentSet);
  }, [entries]);

  const toggleAgent = (agent: string) => {
    setCollapsedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const formatEntry = (entry: DiagnosticEntry) => {
    const ts = `${entry.timestamp_ms}ms`.padStart(8);
    const agent = entry.agent ? `[${entry.agent}]` : "[system]";
    const data = JSON.stringify(entry.data, null, 2);
    return `[${ts}] ${agent} ${entry.event}:\n${data}`;
  };

  const copyAll = async () => {
    const text = entries.map(formatEntry).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedAt(Date.now());
    setTimeout(() => setCopiedAt(null), 2000);
  };

  const getEventColor = (event: string) => {
    if (event.includes("failed") || event.includes("error")) return "text-red-500";
    if (event.includes("tool_call") || event.includes("tool_result")) return "text-blue-500";
    if (event.includes("complete") || event.includes("start")) return "text-green-500";
    if (event.includes("retry")) return "text-amber-500";
    return "text-muted-foreground";
  };

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Terminal className="h-8 w-8 mb-3 opacity-50" />
        <p className="text-sm">No diagnostic data available.</p>
        <p className="text-xs mt-1">Run an analysis to see diagnostic logs.</p>
      </div>
    );
  }

  // Split entries: system-level (no agent) and per-agent
  const systemEntries = entries.filter(e => !e.agent);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{entries.length} events</span>
        <Button variant="outline" size="sm" onClick={copyAll} className="gap-1.5">
          {copiedAt ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copiedAt ? "Copied" : "Copy Log"}
        </Button>
      </div>

      {/* System-level events */}
      {systemEntries.length > 0 && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">System</h4>
          <div className="space-y-1">
            {systemEntries.map((entry, i) => (
              <div key={i} className="font-mono text-xs">
                <span className="text-muted-foreground">[{entry.timestamp_ms}ms]</span>{" "}
                <span className={getEventColor(entry.event)}>{entry.event}</span>
                <pre className="mt-0.5 ml-4 text-[11px] text-muted-foreground overflow-x-auto max-h-24 overflow-y-auto">
                  {JSON.stringify(entry.data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-agent groups */}
      {agents.map(agent => {
        const agentEntries = entries.filter(e => e.agent === agent);
        const isCollapsed = collapsedAgents.has(agent);
        const completionEntry = agentEntries.find(e => e.event === "agent_complete");
        const timeMs = completionEntry?.data?.processing_time_ms as number | undefined;

        return (
          <div key={agent} className="rounded-lg border bg-muted/30">
            <button
              onClick={() => toggleAgent(agent)}
              className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm capitalize">{agent}</span>
                <span className="text-xs text-muted-foreground">{agentEntries.length} events</span>
                {timeMs != null && (
                  <span className="text-xs text-muted-foreground">{(timeMs / 1000).toFixed(1)}s</span>
                )}
              </div>
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !isCollapsed && "rotate-180")} />
            </button>
            {!isCollapsed && (
              <div className="border-t p-3 space-y-1.5">
                {agentEntries.map((entry, i) => (
                  <div key={i} className="font-mono text-xs">
                    <span className="text-muted-foreground">[{entry.timestamp_ms}ms]</span>{" "}
                    <span className={getEventColor(entry.event)}>{entry.event}</span>
                    <pre className="mt-0.5 ml-4 text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
