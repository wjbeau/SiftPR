import { useState, useEffect } from "react";
import { AgentInfo, AgentSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  ChevronDown,
  RotateCcw,
  Loader2,
  Check,
  Database,
  FileSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AGENT_ICONS } from "@/lib/constants/agents";
import { MCPServersSection } from "./MCPServerManager";

export interface ProviderModels {
  provider: string;
  models: { id: string; name: string }[];
}

export interface AgentCardProps {
  agent: AgentInfo;
  settings: AgentSettings | undefined;
  providerModels: ProviderModels[];
  embeddingCapability?: { available: boolean; provider: string | null };
  onSave: (
    agentType: string,
    modelOverride: string | null,
    customPrompt: string | null,
    enabled: boolean
  ) => Promise<void>;
  isSaving: boolean;
}

export function AgentCard({ agent, settings, providerModels, embeddingCapability, onSave, isSaving }: AgentCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(settings?.enabled ?? true);
  const [modelOverride, setModelOverride] = useState(settings?.model_override ?? "");
  const [customPrompt, setCustomPrompt] = useState(settings?.custom_prompt ?? "");
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const iconConfig = AGENT_ICONS[agent.agent_type] || AGENT_ICONS.security;
  const Icon = iconConfig.icon;
  const isResearchAgent = agent.agent_type === "research";

  // Track changes
  useEffect(() => {
    const originalEnabled = settings?.enabled ?? true;
    const originalModel = settings?.model_override ?? "";
    const originalPrompt = settings?.custom_prompt ?? "";

    const changed =
      enabled !== originalEnabled ||
      modelOverride !== originalModel ||
      customPrompt !== originalPrompt;

    setHasChanges(changed);
  }, [enabled, modelOverride, customPrompt, settings]);

  const handleSave = async () => {
    await onSave(
      agent.agent_type,
      modelOverride || null,
      customPrompt || null,
      enabled
    );
    setHasChanges(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  const handleResetPrompt = () => {
    setCustomPrompt("");
  };

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
            {modelOverride && (
              <span className="text-xs bg-purple-100 dark:bg-purple-900 px-2 py-0.5 rounded text-purple-700 dark:text-purple-300">
                {modelOverride}
              </span>
            )}
            {isResearchAgent && embeddingCapability && (
              embeddingCapability.available ? (
                <span className="text-xs bg-emerald-100 dark:bg-emerald-900 px-2 py-0.5 rounded text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                  <Database className="h-3 w-3" />
                  Semantic Search
                </span>
              ) : (
                <span className="text-xs bg-orange-100 dark:bg-orange-900 px-2 py-0.5 rounded text-orange-700 dark:text-orange-300 flex items-center gap-1">
                  <FileSearch className="h-3 w-3" />
                  File Search Only
                </span>
              )
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
          {/* Research agent embedding info */}
          {isResearchAgent && (
            <div className={cn(
              "p-3 rounded-lg text-sm",
              embeddingCapability?.available
                ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900"
                : "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900"
            )}>
              {embeddingCapability?.available ? (
                <div className="flex gap-2">
                  <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-emerald-800 dark:text-emerald-200">
                      Semantic search available via {embeddingCapability.provider}
                    </p>
                    <p className="text-emerald-700 dark:text-emerald-300 mt-0.5">
                      This agent can search the indexed codebase for semantically related code when reviewing PRs.
                      Index your repositories in the Repositories tab to enable this.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <FileSearch className="h-4 w-4 text-orange-600 dark:text-orange-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-orange-800 dark:text-orange-200">
                      Limited to file search tools
                    </p>
                    <p className="text-orange-700 dark:text-orange-300 mt-0.5">
                      Add an OpenAI, Google, or OpenRouter API key in the Providers tab to enable semantic search on indexed repositories.
                      Without embeddings, this agent uses grep and file reading to find related code.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Enable/Disable Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor={`${agent.agent_type}-enabled`}>Enable Agent</Label>
              <p className="text-xs text-muted-foreground">
                {isResearchAgent
                  ? "When enabled, other agents can spawn this agent to investigate the codebase"
                  : "Disabled agents won't run during PR analysis"}
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

          {/* Model Override */}
          <div className="space-y-2">
            <Label htmlFor={`${agent.agent_type}-model`}>Model Override</Label>
            <select
              id={`${agent.agent_type}-model`}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={modelOverride}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setModelOverride(e.target.value)}
            >
              <option value="">Use default model</option>
              {providerModels.map((pg) => (
                <optgroup key={pg.provider} label={pg.provider.charAt(0).toUpperCase() + pg.provider.slice(1)}>
                  {pg.models.map((model) => (
                    <option key={`${pg.provider}:${model.id}`} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Override the default model for this agent, or leave blank to use your active provider's model
            </p>
          </div>

          {/* Custom Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${agent.agent_type}-prompt`}>System Prompt</Label>
              {isUsingCustomPrompt && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetPrompt}
                  className="h-7 text-xs gap-1"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset to Default
                </Button>
              )}
            </div>
            <textarea
              id={`${agent.agent_type}-prompt`}
              value={displayPrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCustomPrompt(e.target.value)}
              className="flex min-h-[200px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
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
            <Button
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="gap-2"
            >
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
