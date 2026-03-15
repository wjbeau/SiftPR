import { useState, useEffect } from "react";
import { AgentInfo, AgentSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  RotateCcw,
  Loader2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_ICONS } from "@/lib/constants/agents";
import { MCPServersSection } from "./MCPServerManager";

export interface InternalAgentCardProps {
  agent: AgentInfo;
  settings: AgentSettings | undefined;
  onSave: (
    agentType: string,
    modelOverride: string | null,
    customPrompt: string | null,
    enabled: boolean
  ) => Promise<void>;
  isSaving: boolean;
}

export function InternalAgentCard({ agent, settings: agentSettings, onSave, isSaving }: InternalAgentCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(agentSettings?.enabled ?? true);
  const [customPrompt, setCustomPrompt] = useState(agentSettings?.custom_prompt ?? "");
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const iconConfig = AGENT_ICONS[agent.agent_type] || AGENT_ICONS.security;
  const Icon = iconConfig.icon;

  useEffect(() => {
    const originalEnabled = agentSettings?.enabled ?? true;
    const originalPrompt = agentSettings?.custom_prompt ?? "";
    setHasChanges(enabled !== originalEnabled || customPrompt !== originalPrompt);
  }, [enabled, customPrompt, agentSettings]);

  const handleSave = async () => {
    await onSave(agent.agent_type, null, customPrompt || null, enabled);
    setHasChanges(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleResetPrompt = () => setCustomPrompt("");

  const displayPrompt = customPrompt || agent.default_prompt;
  const isUsingCustomPrompt = customPrompt && customPrompt !== agent.default_prompt;

  return (
    <div className="border rounded-lg">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center gap-4 hover:bg-muted/50 transition-colors"
      >
        <div className={cn("p-2 rounded-lg", iconConfig.bgColor)}>
          <Icon className={cn("h-5 w-5", iconConfig.color)} />
        </div>
        <div className="flex-1 text-left">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            {agent.name}
            {!enabled && (
              <span className="text-xs bg-muted px-2 py-0.5 rounded text-muted-foreground">
                Disabled
              </span>
            )}
            {isUsingCustomPrompt && (
              <span className="text-xs bg-blue-100 dark:bg-blue-900 px-2 py-0.5 rounded text-blue-700 dark:text-blue-300">
                Custom Prompt
              </span>
            )}
          </div>
          <div className="text-sm text-muted-foreground">{agent.description}</div>
        </div>
        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {isOpen && (
        <div className="px-4 pb-4 pt-2 border-t space-y-4">
          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor={`${agent.agent_type}-enabled`}>Enable Agent</Label>
              <p className="text-xs text-muted-foreground">
                {agent.agent_type === "research"
                  ? "When enabled, other agents can spawn this agent to investigate the codebase"
                  : "Disabled agents won't run during codebase analysis"}
              </p>
            </div>
            <button
              id={`${agent.agent_type}-enabled`}
              onClick={() => setEnabled(!enabled)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                enabled ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                  enabled ? "translate-x-6" : "translate-x-1"
                )}
              />
            </button>
          </div>

          {/* Custom Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${agent.agent_type}-prompt`}>System Prompt</Label>
              {isUsingCustomPrompt && (
                <Button variant="ghost" size="sm" onClick={handleResetPrompt} className="h-7 text-xs gap-1">
                  <RotateCcw className="h-3 w-3" />
                  Reset to Default
                </Button>
              )}
            </div>
            <textarea
              id={`${agent.agent_type}-prompt`}
              value={displayPrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomPrompt(e.target.value)}
              className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Enter custom system prompt..."
            />
            <p className="text-xs text-muted-foreground">
              {isUsingCustomPrompt
                ? "Using custom prompt. Click 'Reset to Default' to restore the original."
                : "Showing default prompt. Edit to customize this agent's behavior."}
            </p>
          </div>

          {/* MCP Servers */}
          <MCPServersSection agentType={agent.agent_type} />

          {/* Save Button */}
          <div className="flex items-center justify-end gap-2">
            {saveSuccess && (
              <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <Check className="h-4 w-4" />
                Saved
              </span>
            )}
            <Button onClick={handleSave} disabled={!hasChanges || isSaving} className="gap-2">
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
