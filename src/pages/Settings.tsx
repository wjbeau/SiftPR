import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { settings, ModelInfo } from "@/lib/api";
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
import { Server, Cloud, Cpu, RefreshCw, Loader2 } from "lucide-react";

type AIProvider = "openai" | "anthropic" | "google" | "openrouter" | "ollama" | "lmstudio" | "openai-compatible";

interface ProviderConfig {
  value: AIProvider;
  label: string;
  isLocal: boolean;
  defaultUrl?: string;
  description: string;
  placeholder?: string;
  requiresKeyForModels?: boolean;
}

const PROVIDERS: ProviderConfig[] = [
  {
    value: "openai",
    label: "OpenAI",
    isLocal: false,
    description: "OpenAI's GPT and reasoning models",
    requiresKeyForModels: true,
  },
  {
    value: "anthropic",
    label: "Anthropic",
    isLocal: false,
    description: "Anthropic's Claude models",
    requiresKeyForModels: true,
  },
  {
    value: "google",
    label: "Google AI",
    isLocal: false,
    description: "Google's Gemini models",
    requiresKeyForModels: true,
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    isLocal: false,
    description: "Access multiple providers through one API",
    requiresKeyForModels: false, // OpenRouter models can be fetched without auth
  },
  {
    value: "ollama",
    label: "Ollama",
    isLocal: true,
    defaultUrl: "http://localhost:11434",
    description: "Run models locally with Ollama",
    requiresKeyForModels: false,
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    isLocal: true,
    defaultUrl: "http://localhost:1234",
    description: "Run models locally with LM Studio",
    placeholder: "Enter the model name loaded in LM Studio",
    requiresKeyForModels: false,
  },
  {
    value: "openai-compatible",
    label: "OpenAI Compatible",
    isLocal: true,
    defaultUrl: "http://localhost:8000",
    description: "Any OpenAI-compatible API (vLLM, LocalAI, etc.)",
    placeholder: "Enter your model name",
    requiresKeyForModels: false,
  },
];

export function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newProvider, setNewProvider] = useState<AIProvider>("openai");
  const [newApiKey, setNewApiKey] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newModel, setNewModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [fetchedModels, setFetchedModels] = useState<ModelInfo[]>([]);
  const [modelsFetchStatus, setModelsFetchStatus] = useState<"idle" | "fetching" | "success" | "error">("idle");
  const [modelsFetchError, setModelsFetchError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => settings.getAIProviders(),
    enabled: !!user,
  });

  const addMutation = useMutation({
    mutationFn: (data: { provider: string; apiKey: string; model: string }) =>
      settings.addAIProvider(data.provider, data.apiKey, data.model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
      setNewApiKey("");
      setNewBaseUrl("");
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

  const selectedProviderConfig = PROVIDERS.find((p) => p.value === newProvider);
  const isLocalProvider = selectedProviderConfig?.isLocal ?? false;
  const effectiveModel = customModel || newModel;

  const handleFetchModels = async () => {
    setModelsFetchStatus("fetching");
    setModelsFetchError("");
    setFetchedModels([]);

    try {
      let apiKeyOrUrl = "";
      if (isLocalProvider) {
        apiKeyOrUrl = newBaseUrl || selectedProviderConfig?.defaultUrl || "";
        if (newProvider === "openai-compatible" && newApiKey) {
          apiKeyOrUrl = `${apiKeyOrUrl}|${newApiKey}`;
        }
      } else {
        apiKeyOrUrl = newApiKey;
      }

      const models = await settings.fetchModels(newProvider, apiKeyOrUrl);
      setFetchedModels(models);
      setModelsFetchStatus("success");

      // Auto-select first model if none selected
      if (models.length > 0 && !newModel) {
        setNewModel(models[0].id);
      }
    } catch (err) {
      setModelsFetchStatus("error");
      setModelsFetchError(err instanceof Error ? err.message : "Failed to fetch models");
    }
  };

  const handleAddProvider = (e: React.FormEvent) => {
    e.preventDefault();

    // For local providers, use base URL; for cloud providers, use API key
    // For openai-compatible with optional API key, combine them
    let apiKeyOrUrl = isLocalProvider ? newBaseUrl : newApiKey;
    if (newProvider === "openai-compatible" && newApiKey) {
      apiKeyOrUrl = `${newBaseUrl}|${newApiKey}`;
    }

    addMutation.mutate({
      provider: newProvider,
      apiKey: apiKeyOrUrl,
      model: effectiveModel,
    });
  };

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");

    try {
      const url = newBaseUrl || selectedProviderConfig?.defaultUrl || "";
      let testUrl = "";

      if (newProvider === "ollama") {
        testUrl = `${url.replace(/\/$/, "")}/api/tags`;
      } else {
        testUrl = `${url.replace(/\/$/, "")}/v1/models`;
      }

      const response = await fetch(testUrl);
      if (response.ok) {
        setTestStatus("success");
        setTestMessage("Connection successful!");
      } else {
        setTestStatus("error");
        setTestMessage(`Connection failed: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      setTestStatus("error");
      setTestMessage(`Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  };

  const handleProviderChange = (provider: AIProvider) => {
    setNewProvider(provider);
    const config = PROVIDERS.find((p) => p.value === provider);
    if (config) {
      setNewBaseUrl(config.defaultUrl || "");
      setNewModel("");
      setCustomModel("");
    }
    setTestStatus("idle");
    setTestMessage("");
    setFetchedModels([]);
    setModelsFetchStatus("idle");
    setModelsFetchError("");
  };

  if (!user) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Please log in to access settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure your AI providers and preferences.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>AI Providers</CardTitle>
          <CardDescription>
            Add your API keys for AI providers. Keys are encrypted and stored securely.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : data && data.length > 0 ? (
            <div className="space-y-4">
              {data.map((setting) => {
                const providerConfig = PROVIDERS.find((p) => p.value === setting.provider);
                const isLocal = providerConfig?.isLocal ?? false;
                return (
                  <div
                    key={setting.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${isLocal ? "bg-purple-100 dark:bg-purple-950" : "bg-blue-100 dark:bg-blue-950"}`}>
                        {isLocal ? (
                          <Cpu className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                        ) : (
                          <Cloud className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {providerConfig?.label || setting.provider}
                          {setting.is_active && (
                            <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 px-2 py-0.5 rounded">
                              Active
                            </span>
                          )}
                          {isLocal && (
                            <span className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 px-2 py-0.5 rounded">
                              Local
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Model: {setting.model_preference}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {!setting.is_active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => activateMutation.mutate(setting.id)}
                          disabled={activateMutation.isPending}
                        >
                          Activate
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => deleteMutation.mutate(setting.id)}
                        disabled={deleteMutation.isPending}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground">
              No AI providers configured yet. Add one below.
            </p>
          )}

          <hr />

          <form onSubmit={handleAddProvider} className="space-y-4">
            <h3 className="font-medium">Add New Provider</h3>

            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newProvider}
                onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
              >
                <optgroup label="Cloud Providers">
                  {PROVIDERS.filter(p => !p.isLocal).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Local Providers">
                  {PROVIDERS.filter(p => p.isLocal).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              {selectedProviderConfig && (
                <p className="text-xs text-muted-foreground">
                  {selectedProviderConfig.description}
                </p>
              )}
            </div>

            {/* Base URL for local providers */}
            {isLocalProvider && (
              <div className="space-y-2">
                <Label htmlFor="base-url">
                  <span className="flex items-center gap-2">
                    <Server className="h-3.5 w-3.5" />
                    Base URL
                  </span>
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="base-url"
                    type="text"
                    placeholder={selectedProviderConfig?.defaultUrl || "http://localhost:11434"}
                    value={newBaseUrl}
                    onChange={(e) => setNewBaseUrl(e.target.value)}
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testStatus === "testing"}
                  >
                    {testStatus === "testing" ? "Testing..." : "Test"}
                  </Button>
                </div>
                {testMessage && (
                  <p className={`text-xs ${testStatus === "success" ? "text-green-600" : "text-destructive"}`}>
                    {testMessage}
                  </p>
                )}
              </div>
            )}

            {/* API Key for cloud providers (and optionally for openai-compatible) */}
            {(!isLocalProvider || newProvider === "openai-compatible") && (
              <div className="space-y-2">
                <Label htmlFor="api-key">
                  API Key {newProvider === "openai-compatible" && <span className="text-muted-foreground">(optional)</span>}
                </Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder="sk-..."
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  required={!isLocalProvider}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <div className="space-y-2">
                {/* Fetch Models Button */}
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleFetchModels}
                    disabled={
                      modelsFetchStatus === "fetching" ||
                      (selectedProviderConfig?.requiresKeyForModels && !newApiKey) ||
                      (isLocalProvider && !newBaseUrl && !selectedProviderConfig?.defaultUrl)
                    }
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
                        Fetch Available Models
                      </>
                    )}
                  </Button>
                </div>

                {/* Fetch status message */}
                {modelsFetchStatus === "error" && (
                  <p className="text-xs text-destructive">{modelsFetchError}</p>
                )}
                {modelsFetchStatus === "success" && fetchedModels.length === 0 && (
                  <p className="text-xs text-muted-foreground">No models found. Enter a custom model name below.</p>
                )}
                {selectedProviderConfig?.requiresKeyForModels && !newApiKey && modelsFetchStatus === "idle" && (
                  <p className="text-xs text-muted-foreground">
                    Enter your API key above to fetch available models
                  </p>
                )}

                {/* Model Selection Dropdown */}
                {fetchedModels.length > 0 && (
                  <select
                    id="model"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={newModel}
                    onChange={(e) => {
                      setNewModel(e.target.value);
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

                {/* Custom model input */}
                <Input
                  type="text"
                  placeholder={selectedProviderConfig?.placeholder || "Or enter a custom model name"}
                  value={customModel}
                  onChange={(e) => setCustomModel(e.target.value)}
                />
                {!newModel && !customModel && fetchedModels.length === 0 && modelsFetchStatus !== "idle" && (
                  <p className="text-xs text-muted-foreground">
                    Enter the model name you want to use
                  </p>
                )}
              </div>
            </div>

            <Button
              type="submit"
              disabled={addMutation.isPending || !effectiveModel}
            >
              {addMutation.isPending ? "Adding..." : "Add Provider"}
            </Button>

            {addMutation.isError && (
              <p className="text-sm text-destructive">
                {(addMutation.error as Error).message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
