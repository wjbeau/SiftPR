import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { agents, settings, AgentSettings } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Bot,
  Loader2,
  Check,
  AlertCircle,
  Database,
  FileSearch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AgentCard, ProviderModels } from "./AgentCard";
import { InternalAgentCard } from "./InternalAgentCard";

const ANALYSIS_AGENTS = ["security", "architecture", "style", "performance"];
const INTERNAL_AGENTS = ["profiler", "research"];
const EMBEDDING_PROVIDERS = ["openai", "google", "openrouter", "ollama"];

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

  // Fetch user's configured AI providers (for model selection dropdown)
  const { data: aiProviders } = useQuery({
    queryKey: ["settings", "ai-providers"],
    queryFn: () => settings.getAIProviders(),
  });

  // Fetch internal agent config
  const { data: internalConfig } = useQuery({
    queryKey: ["agents", "internal-config"],
    queryFn: () => agents.getInternalConfig(),
  });

  // Fetch embedding capability
  const { data: embeddingCapability } = useQuery({
    queryKey: ["agents", "embedding-capability"],
    queryFn: () => agents.getEmbeddingCapability(),
  });

  // Fetch service keys (to check for ollama_url)
  const { data: serviceKeysList } = useQuery({
    queryKey: ["service-keys"],
    queryFn: () => import("@/lib/api").then((m) => m.serviceKeys.get()),
  });

  // Build model list from user's configured providers (no network calls needed)
  const providerModels: ProviderModels[] = (() => {
    if (!aiProviders || aiProviders.length === 0) return [];
    const byProvider = new Map<string, { id: string; name: string }[]>();
    for (const p of aiProviders) {
      if (!byProvider.has(p.provider)) {
        byProvider.set(p.provider, []);
      }
      const models = byProvider.get(p.provider)!;
      if (!models.some((m) => m.id === p.model_preference)) {
        models.push({ id: p.model_preference, name: p.model_preference });
      }
    }
    return Array.from(byProvider.entries()).map(([provider, models]) => ({ provider, models }));
  })();

  // Build embedding-capable model list (only openai, google, ollama)
  const embeddingProviderModels: ProviderModels[] = (() => {
    const result: ProviderModels[] = providerModels.filter((pm) =>
      EMBEDDING_PROVIDERS.includes(pm.provider)
    );

    // Add Ollama if configured via service key (it's not in aiProviders)
    const hasOllama = serviceKeysList?.some((k) => k.service_name === "ollama_url");
    if (hasOllama && !result.some((pm) => pm.provider === "ollama")) {
      result.push({
        provider: "ollama",
        models: [
          { id: "llama3.2", name: "llama3.2" },
          { id: "llama3.1", name: "llama3.1" },
          { id: "mistral", name: "mistral" },
          { id: "gemma2", name: "gemma2" },
          { id: "qwen2.5", name: "qwen2.5" },
        ],
      });
    }

    return result;
  })();

  // Internal agent model state
  const [internalModel, setInternalModel] = useState("");
  const [internalSaveSuccess, setInternalSaveSuccess] = useState(false);
  const [internalSaving, setInternalSaving] = useState(false);

  // Sync internal model state when config loads
  useEffect(() => {
    if (internalConfig) {
      setInternalModel(`${internalConfig.provider}:${internalConfig.model}`);
    }
  }, [internalConfig]);

  const handleInternalModelSave = async () => {
    if (!internalModel) return;
    const [provider, ...modelParts] = internalModel.split(":");
    const model = modelParts.join(":");
    if (!provider || !model) return;

    setInternalSaving(true);
    try {
      await agents.setInternalConfig(provider, model);
      queryClient.invalidateQueries({ queryKey: ["agents", "internal-config"] });
      queryClient.invalidateQueries({ queryKey: ["agents", "embedding-capability"] });
      setInternalSaveSuccess(true);
      setTimeout(() => setInternalSaveSuccess(false), 2000);
    } finally {
      setInternalSaving(false);
    }
  };

  const internalModelChanged = (() => {
    if (!internalConfig && !internalModel) return false;
    if (!internalConfig && internalModel) return true;
    if (internalConfig) {
      return internalModel !== `${internalConfig.provider}:${internalConfig.model}`;
    }
    return false;
  })();

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
    agentSettings?.find((s: AgentSettings) => s.agent_type === agentType);

  const hasAnyModels = providerModels && providerModels.length > 0;

  const analysisAgents = agentDefaults?.filter((a) => ANALYSIS_AGENTS.includes(a.agent_type)) || [];
  const internalAgentsList = agentDefaults?.filter((a) => INTERNAL_AGENTS.includes(a.agent_type)) || [];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">AI Agents</h2>
        <p className="text-muted-foreground">
          Configure the AI agents used for PR analysis and codebase intelligence.
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

      {/* Analysis Agents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Analysis Agents
          </CardTitle>
          <CardDescription>
            These agents run during PR analysis. Each can use a different model from your configured providers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {analysisAgents.map((agent) => (
            <AgentCard
              key={agent.agent_type}
              agent={agent}
              settings={getSettingsForAgent(agent.agent_type)}
              providerModels={providerModels || []}
              onSave={handleSave}
              isSaving={savingAgent === agent.agent_type}
            />
          ))}
        </CardContent>
      </Card>

      {/* Internal Agents */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Database className="h-4 w-4" />
            Internal Agents
          </CardTitle>
          <CardDescription>
            The profiler and research agents share a single model from an embedding-capable provider.
            This model is also used to generate embeddings for semantic search.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Shared Model Picker */}
          <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
            <div className="space-y-2">
              <Label htmlFor="internal-model">Shared Model</Label>
              <div className="flex gap-2">
                <select
                  id="internal-model"
                  className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={internalModel}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setInternalModel(e.target.value)}
                >
                  <option value="">Select a model...</option>
                  {embeddingProviderModels.map((pg) => (
                    <optgroup key={pg.provider} label={pg.provider.charAt(0).toUpperCase() + pg.provider.slice(1)}>
                      {pg.models.map((model) => (
                        <option key={`${pg.provider}:${model.id}`} value={`${pg.provider}:${model.id}`}>
                          {model.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <Button
                  onClick={handleInternalModelSave}
                  disabled={!internalModelChanged || internalSaving}
                  size="sm"
                  className="h-10"
                >
                  {internalSaving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : internalSaveSuccess ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Only embedding-capable providers (OpenAI, Google, OpenRouter, Ollama) are shown.
                Embeddings for semantic search are generated using this provider.
              </p>
            </div>

            {embeddingCapability && (
              <div className={cn(
                "p-2 rounded text-xs flex items-center gap-2",
                embeddingCapability.available
                  ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300"
                  : "bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-300"
              )}>
                {embeddingCapability.available ? (
                  <>
                    <Database className="h-3.5 w-3.5 flex-shrink-0" />
                    Semantic search available via {embeddingCapability.provider}
                  </>
                ) : (
                  <>
                    <FileSearch className="h-3.5 w-3.5 flex-shrink-0" />
                    No embedding provider configured — select a model above to enable semantic search
                  </>
                )}
              </div>
            )}
          </div>

          {/* Internal Agent Cards */}
          {internalAgentsList.map((agent) => (
            <InternalAgentCard
              key={agent.agent_type}
              agent={agent}
              settings={getSettingsForAgent(agent.agent_type)}
              onSave={handleSave}
              isSaving={savingAgent === agent.agent_type}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
