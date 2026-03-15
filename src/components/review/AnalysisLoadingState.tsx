import { useState, useEffect } from "react";
import { Sparkles, Loader2, Shield, Layers, Paintbrush, Zap } from "lucide-react";
import type { AgentType } from "@/lib/api";
import { AGENT_STATUS_MESSAGES } from "@/lib/constants/agents";
import { cn } from "@/lib/utils";

export function AnalysisLoadingState() {
  const [messageIndices, setMessageIndices] = useState<Record<AgentType, number>>({
    security: 0,
    architecture: 0,
    style: 0,
    performance: 0,
  });

  useEffect(() => {
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
  }, []);

  const agents: { type: AgentType; label: string; icon: React.ReactNode; color: string }[] = [
    { type: "security", label: "Security", icon: <Shield className="h-4 w-4" />, color: "text-red-500" },
    { type: "architecture", label: "Architecture", icon: <Layers className="h-4 w-4" />, color: "text-blue-500" },
    { type: "style", label: "Style", icon: <Paintbrush className="h-4 w-4" />, color: "text-purple-500" },
    { type: "performance", label: "Performance", icon: <Zap className="h-4 w-4" />, color: "text-amber-500" },
  ];

  return (
    <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
      <div className="p-4 bg-purple-100 dark:bg-purple-950/50 rounded-full mb-6">
        <Sparkles className="h-10 w-10 text-purple-500 animate-pulse" />
      </div>

      <h2 className="text-xl font-semibold mb-2">Analyzing Pull Request</h2>
      <p className="text-muted-foreground mb-6">
        Running 4 specialized agents in parallel
      </p>

      <div className="w-full space-y-3 mb-6">
        {agents.map(({ type, label, icon, color }) => (
          <div
            key={type}
            className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
          >
            <div className={cn("p-2 rounded-lg bg-background", color)}>
              {icon}
            </div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{label}</span>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground transition-all duration-300">
                {AGENT_STATUS_MESSAGES[type][messageIndices[type]]}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">This typically takes 30-60 seconds</p>
    </div>
  );
}
