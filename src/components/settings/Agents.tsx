import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agents, settings, mcp, AgentInfo, AgentSettings, MCPServerConfig, MCPTool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Bot,
  Shield,
  Layers,
  Paintbrush,
  Zap,
  Search,
  ScanSearch,
  ChevronDown,
  RotateCcw,
  Loader2,
  Check,
  AlertCircle,
  Database,
  FileSearch,
  Plus,
  Trash2,
  Plug,
  TestTube2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_ICONS: Record<string, { icon: typeof Shield; color: string; bgColor: string }> = {
  security: {
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-100 dark:bg-red-950",
  },
  architecture: {
    icon: Layers,
    color: "text-blue-500",
    bgColor: "bg-blue-100 dark:bg-blue-950",
  },
  style: {
    icon: Paintbrush,
    color: "text-green-500",
    bgColor: "bg-green-100 dark:bg-green-950",
  },
  performance: {
    icon: Zap,
    color: "text-amber-500",
    bgColor: "bg-amber-100 dark:bg-amber-950",
  },
  research: {
    icon: Search,
    color: "text-violet-500",
    bgColor: "bg-violet-100 dark:bg-violet-950",
  },
  profiler: {
    icon: ScanSearch,
    color: "text-cyan-500",
    bgColor: "bg-cyan-100 dark:bg-cyan-950",
  },
};

interface ProviderModels {
  provider: string;
  models: { id: string; name: string }[];
}

interface AgentCardProps {
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

function AgentCard({ agent, settings, providerModels, embeddingCapability, onSave, isSaving }: AgentCardProps) {
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
                      Add an OpenAI or Google API key in the Providers tab to enable semantic search on indexed repositories.
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

function MCPServersSection({ agentType }: { agentType: string }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, MCPTool[]>>({});
  const [testErrors, setTestErrors] = useState<Record<string, string>>({});

  // Add form state
  const [newName, setNewName] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newTransport, setNewTransport] = useState("stdio");
  const [newHttpUrl, setNewHttpUrl] = useState("");
  const [newEnvPairs, setNewEnvPairs] = useState<{ key: string; value: string }[]>([]);
  const [addError, setAddError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  const { data: servers, isLoading } = useQuery({
    queryKey: ["mcp", "servers", agentType],
    queryFn: () => mcp.getServers(agentType),
  });

  const removeMutation = useMutation({
    mutationFn: (serverName: string) => mcp.removeServer(agentType, serverName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers", agentType] });
    },
  });

  const handleAdd = async () => {
    if (!newName.trim() || (!newCommand.trim() && newTransport === "stdio")) {
      setAddError("Name and command are required for stdio servers.");
      return;
    }
    if (newTransport === "http" && !newHttpUrl.trim()) {
      setAddError("URL is required for HTTP servers.");
      return;
    }

    setAddError(null);
    setIsAdding(true);
    try {
      const args = newArgs.trim()
        ? newArgs.split(/\s+/)
        : [];
      const env: Record<string, string> = {};
      for (const pair of newEnvPairs) {
        if (pair.key.trim()) {
          env[pair.key.trim()] = pair.value;
        }
      }
      await mcp.addServer(
        agentType,
        newName.trim(),
        newCommand.trim(),
        args,
        env,
        newTransport,
        newTransport === "http" ? newHttpUrl.trim() : null
      );
      queryClient.invalidateQueries({ queryKey: ["mcp", "servers", agentType] });
      resetForm();
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAdding(false);
    }
  };

  const handleTest = async (server: MCPServerConfig) => {
    setTestingServer(server.server_name);
    setTestErrors((prev) => ({ ...prev, [server.server_name]: "" }));
    try {
      const tools = await mcp.testServer(
        server.server_command,
        server.server_args,
        server.server_env,
        server.transport_type,
        server.http_url
      );
      setTestResults((prev) => ({ ...prev, [server.server_name]: tools }));
    } catch (err: unknown) {
      setTestErrors((prev) => ({
        ...prev,
        [server.server_name]: err instanceof Error ? err.message : String(err),
      }));
      setTestResults((prev) => {
        const copy = { ...prev };
        delete copy[server.server_name];
        return copy;
      });
    } finally {
      setTestingServer(null);
    }
  };

  const resetForm = () => {
    setShowAddForm(false);
    setNewName("");
    setNewCommand("");
    setNewArgs("");
    setNewTransport("stdio");
    setNewHttpUrl("");
    setNewEnvPairs([]);
    setAddError(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="flex items-center gap-1.5">
            <Plug className="h-3.5 w-3.5" />
            MCP Servers
          </Label>
          <p className="text-xs text-muted-foreground">
            Connect external tool servers for this agent to use during analysis
          </p>
        </div>
        {!showAddForm && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(true)}
            className="h-7 text-xs gap-1"
          >
            <Plus className="h-3 w-3" />
            Add Server
          </Button>
        )}
      </div>

      {/* Existing servers */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading servers...
        </div>
      ) : servers && servers.length > 0 ? (
        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.id}
              className="border rounded-md p-3 space-y-2 bg-muted/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium text-sm">{server.server_name}</span>
                  <span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                    {server.transport_type}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={() => handleTest(server)}
                    disabled={testingServer === server.server_name}
                  >
                    {testingServer === server.server_name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <TestTube2 className="h-3 w-3" />
                    )}
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => removeMutation.mutate(server.server_name)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {server.transport_type === "http"
                  ? server.http_url
                  : `${server.server_command} ${server.server_args.join(" ")}`}
              </div>

              {/* Test results */}
              {testResults[server.server_name] && (
                <div className="border rounded p-2 bg-background space-y-1">
                  <p className="text-xs font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    {testResults[server.server_name].length} tool{testResults[server.server_name].length !== 1 ? "s" : ""} discovered
                  </p>
                  <div className="space-y-0.5">
                    {testResults[server.server_name].map((tool) => (
                      <div key={tool.name} className="text-xs text-muted-foreground">
                        <span className="font-mono font-medium">{tool.name}</span>
                        {tool.description && (
                          <span className="ml-1.5">— {tool.description}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {testErrors[server.server_name] && (
                <div className="text-xs text-destructive flex items-start gap-1">
                  <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                  {testErrors[server.server_name]}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : !showAddForm ? (
        <p className="text-xs text-muted-foreground italic py-1">
          No MCP servers configured for this agent.
        </p>
      ) : null}

      {/* Add server form */}
      {showAddForm && (
        <div className="border rounded-md p-3 space-y-3 bg-muted/20">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">New MCP Server</Label>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={resetForm}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Server Name</Label>
              <Input
                value={newName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                placeholder="e.g. filesystem"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Transport</Label>
              <select
                value={newTransport}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setNewTransport(e.target.value)}
                className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
              >
                <option value="stdio">stdio</option>
                <option value="http">HTTP</option>
              </select>
            </div>
          </div>

          {newTransport === "stdio" ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Command</Label>
                <Input
                  value={newCommand}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewCommand(e.target.value)}
                  placeholder="e.g. npx"
                  className="h-8 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Arguments</Label>
                <Input
                  value={newArgs}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewArgs(e.target.value)}
                  placeholder="e.g. -y @modelcontextprotocol/server-filesystem /tmp"
                  className="h-8 text-sm font-mono"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <Label className="text-xs">Server URL</Label>
              <Input
                value={newHttpUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewHttpUrl(e.target.value)}
                placeholder="e.g. http://localhost:3000/mcp"
                className="h-8 text-sm font-mono"
              />
            </div>
          )}

          {/* Environment variables */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Environment Variables</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs gap-1"
                onClick={() => setNewEnvPairs([...newEnvPairs, { key: "", value: "" }])}
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            </div>
            {newEnvPairs.map((pair, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={pair.key}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const updated = [...newEnvPairs];
                    updated[i] = { ...updated[i], key: e.target.value };
                    setNewEnvPairs(updated);
                  }}
                  placeholder="KEY"
                  className="h-7 text-xs font-mono flex-1"
                />
                <span className="text-muted-foreground text-xs">=</span>
                <Input
                  value={pair.value}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const updated = [...newEnvPairs];
                    updated[i] = { ...updated[i], value: e.target.value };
                    setNewEnvPairs(updated);
                  }}
                  placeholder="value"
                  className="h-7 text-xs font-mono flex-1"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setNewEnvPairs(newEnvPairs.filter((_, j) => j !== i))}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          {addError && (
            <div className="text-xs text-destructive flex items-start gap-1">
              <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
              {addError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={resetForm} className="h-7 text-xs">
              Cancel
            </Button>
            <Button size="sm" onClick={handleAdd} disabled={isAdding} className="h-7 text-xs gap-1">
              {isAdding ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Add Server
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Agents() {
  const queryClient = useQueryClient();
  const [savingAgent, setSavingAgent] = useState<string | null>(null);

  // Fetch default agent info
  const { data: agentDefaults, isLoading: loadingDefaults } = useQuery({
    queryKey: ["agents", "defaults"],
    queryFn: () => agents.getDefaults(),
  });

  // Fetch user's agent settings
  const { data: agentSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ["agents", "settings"],
    queryFn: () => agents.getSettings(),
  });

  // Fetch available models from ALL configured providers (not just active)
  const { data: providerModels } = useQuery({
    queryKey: ["agents", "models", "all-providers"],
    queryFn: async () => {
      try {
        const providers = await settings.getAIProviders();
        const results: ProviderModels[] = [];

        // Fetch models from each configured provider in parallel
        const fetches = providers.map(async (p) => {
          try {
            const models = await settings.fetchModelsForProvider(p.provider);
            return {
              provider: p.provider,
              models: models.map((m) => ({ id: m.id, name: m.name })),
            };
          } catch {
            return { provider: p.provider, models: [] };
          }
        });

        const allResults = await Promise.all(fetches);
        for (const r of allResults) {
          if (r.models.length > 0) {
            results.push(r);
          }
        }

        return results;
      } catch {
        return [];
      }
    },
  });

  // Fetch embedding capability for research agent
  const { data: embeddingCapability } = useQuery({
    queryKey: ["agents", "embedding-capability"],
    queryFn: () => agents.getEmbeddingCapability(),
  });

  const saveMutation = useMutation({
    mutationFn: async (data: {
      agentType: string;
      modelOverride: string | null;
      customPrompt: string | null;
      enabled: boolean;
    }) => {
      return agents.saveSetting(
        data.agentType,
        data.modelOverride,
        data.customPrompt,
        data.enabled
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents", "settings"] });
    },
  });

  const handleSave = async (
    agentType: string,
    modelOverride: string | null,
    customPrompt: string | null,
    enabled: boolean
  ) => {
    setSavingAgent(agentType);
    try {
      await saveMutation.mutateAsync({ agentType, modelOverride, customPrompt, enabled });
    } finally {
      setSavingAgent(null);
    }
  };

  const isLoading = loadingDefaults || loadingSettings;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getSettingsForAgent = (agentType: string) =>
    agentSettings?.find((s) => s.agent_type === agentType);

  const hasAnyModels = providerModels && providerModels.length > 0;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">AI Agents</h2>
        <p className="text-muted-foreground">
          Customize the AI agents used in PR analysis. Each agent specializes in a different aspect of code review.
        </p>
      </div>

      {!hasAnyModels && (
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="pt-4">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  No AI Provider Configured
                </p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  Add an AI provider in the Providers tab to customize agent models.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Agent Configuration
          </CardTitle>
          <CardDescription>
            Configure model selection, enable/disable agents, and customize system prompts.
            Models from all configured providers are available for selection.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {agentDefaults?.map((agent) => (
            <AgentCard
              key={agent.agent_type}
              agent={agent}
              settings={getSettingsForAgent(agent.agent_type)}
              providerModels={providerModels || []}
              embeddingCapability={agent.agent_type === "research" ? embeddingCapability : undefined}
              onSave={handleSave}
              isSaving={savingAgent === agent.agent_type}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
