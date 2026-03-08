import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settings } from "@/lib/api";
import type { ModelInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RefreshCw, Loader2, Star, Trash2, Plus } from "lucide-react";
import { PROVIDERS } from "./AIProviders";

type AIProvider = "openai" | "anthropic" | "google" | "openrouter" | "ollama" | "lmstudio" | "openai-compatible";

export function AIModels() {
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | "">("");
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [modelsFetchStatus, setModelsFetchStatus] = useState<"idle" | "fetching" | "success" | "error">("idle");
  const [modelsFetchError, setModelsFetchError] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");

  const { data: configuredModels, isLoading } = useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => settings.getAIProviders(),
  });

  const addModelMutation = useMutation({
    mutationFn: (data: { provider: string; apiKey: string; model: string }) =>
      settings.addAIProvider(data.provider, data.apiKey, data.model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
      setSelectedModel("");
      setCustomModel("");
    },
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => settings.activateAIProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => settings.deleteAIProvider(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
    },
  });

  // Get unique configured providers (those that have API keys set up)
  const configuredProviders = [...new Set(configuredModels?.map((m) => m.provider) ?? [])];

  // Filter out models with placeholder (they're provider-only configs)
  const actualModels = configuredModels?.filter((m) => m.model_preference !== "__placeholder__") ?? [];
  const activeModel = actualModels.find((m) => m.is_active);

  const handleFetchModels = async () => {
    if (!selectedProvider) return;

    setModelsFetchStatus("fetching");
    setModelsFetchError("");
    setFetchedModels([]);

    try {
      // Use the stored API key for this provider
      const models = await settings.fetchModelsForProvider(selectedProvider);
      setFetchedModels(models);
      setModelsFetchStatus("success");

      if (models.length > 0 && !selectedModel) {
        setSelectedModel(models[0].id);
      }
    } catch (err) {
      setModelsFetchStatus("error");
      setModelsFetchError(err instanceof Error ? err.message : "Failed to fetch models");
    }
  };

  const handleAddModel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;

    const model = customModel || selectedModel;
    if (!model) return;

    // Find the provider config to get the API key
    const providerConfig = configuredModels?.find((m) => m.provider === selectedProvider);
    if (!providerConfig) return;

    // Note: This adds a new model config entry
    // The API key is already stored, so we just need the model
    addModelMutation.mutate({
      provider: selectedProvider,
      apiKey: "", // Backend should use existing key
      model,
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">AI Models</h2>
        <p className="text-muted-foreground">
          Configure which models to use from your connected providers.
        </p>
      </div>

      {/* Active Model */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
            Default Model
          </CardTitle>
          <CardDescription>
            The model used for PR analysis when no specific model is selected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : activeModel ? (
            <div className="flex items-center justify-between p-3 border rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-900">
              <div>
                <div className="font-medium">
                  {PROVIDERS.find((p) => p.value === activeModel.provider)?.label || activeModel.provider}
                </div>
                <div className="text-sm text-muted-foreground">
                  {activeModel.model_preference}
                </div>
              </div>
              <span className="text-xs bg-yellow-200 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded">
                Active
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No model activated. Add and activate a model below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Configured Models */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configured Models</CardTitle>
          <CardDescription>
            Models you've added from your providers. Click to set as default.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {actualModels.length > 0 ? (
            <div className="space-y-2">
              {actualModels.map((model) => {
                const providerConfig = PROVIDERS.find((p) => p.value === model.provider);
                return (
                  <div
                    key={model.id}
                    className={`flex items-center justify-between p-3 border rounded-lg ${
                      model.is_active ? "border-yellow-300 dark:border-yellow-800" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {model.model_preference}
                          {model.is_active && (
                            <Star className="h-3 w-3 text-yellow-500 fill-yellow-500" />
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {providerConfig?.label || model.provider}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!model.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => activateMutation.mutate(model.id)}
                          disabled={activateMutation.isPending}
                        >
                          Set Default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate(model.id)}
                        disabled={deleteMutation.isPending}
                        title="Remove model"
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No models configured yet. Add one below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add Model */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Add Model
          </CardTitle>
          <CardDescription>
            Add a model from one of your configured providers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {configuredProviders.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No providers configured. Add a provider in the Providers section first.
            </p>
          ) : (
            <form onSubmit={handleAddModel} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <select
                  id="provider"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedProvider}
                  onChange={(e) => {
                    setSelectedProvider(e.target.value as AIProvider);
                    setFetchedModels([]);
                    setModelsFetchStatus("idle");
                    setSelectedModel("");
                    setCustomModel("");
                  }}
                >
                  <option value="">-- Select a provider --</option>
                  {configuredProviders.map((provider) => {
                    const config = PROVIDERS.find((p) => p.value === provider);
                    return (
                      <option key={provider} value={provider}>
                        {config?.label || provider}
                      </option>
                    );
                  })}
                </select>
              </div>

              {selectedProvider && (
                <>
                  <div className="space-y-2">
                    <Label>Model</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleFetchModels}
                        disabled={modelsFetchStatus === "fetching"}
                        className="flex-shrink-0"
                      >
                        {modelsFetchStatus === "fetching" ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Fetching...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="h-4 w-4 mr-2" />
                            Fetch Models
                          </>
                        )}
                      </Button>
                    </div>

                    {modelsFetchStatus === "error" && (
                      <p className="text-xs text-destructive">{modelsFetchError}</p>
                    )}

                    {fetchedModels.length > 0 && (
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={selectedModel}
                        onChange={(e) => {
                          setSelectedModel(e.target.value);
                          setCustomModel("");
                        }}
                      >
                        <option value="">-- Select a model --</option>
                        {fetchedModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                            {model.context_length && ` (${Math.round(model.context_length / 1000)}k ctx)`}
                          </option>
                        ))}
                      </select>
                    )}

                    <Input
                      type="text"
                      placeholder="Or enter a custom model name"
                      value={customModel}
                      onChange={(e) => setCustomModel(e.target.value)}
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={
                      addModelMutation.isPending ||
                      (!selectedModel && !customModel)
                    }
                  >
                    {addModelMutation.isPending ? "Adding..." : "Add Model"}
                  </Button>

                  {addModelMutation.isError && (
                    <p className="text-sm text-destructive">
                      {(addModelMutation.error as Error).message}
                    </p>
                  )}
                </>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
