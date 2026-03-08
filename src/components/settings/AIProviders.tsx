import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settings } from "@/lib/api";
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
import { Server, Cloud, Cpu, Trash2, CheckCircle2 } from "lucide-react";

type AIProvider = "openai" | "anthropic" | "google" | "openrouter" | "ollama" | "lmstudio" | "openai-compatible";

interface ProviderConfig {
  value: AIProvider;
  label: string;
  isLocal: boolean;
  defaultUrl?: string;
  description: string;
}

export const PROVIDERS: ProviderConfig[] = [
  {
    value: "openai",
    label: "OpenAI",
    isLocal: false,
    description: "OpenAI's GPT and reasoning models",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    isLocal: false,
    description: "Anthropic's Claude models",
  },
  {
    value: "google",
    label: "Google AI",
    isLocal: false,
    description: "Google's Gemini models",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    isLocal: false,
    description: "Access multiple providers through one API",
  },
  {
    value: "ollama",
    label: "Ollama",
    isLocal: true,
    defaultUrl: "http://localhost:11434",
    description: "Run models locally with Ollama",
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    isLocal: true,
    defaultUrl: "http://localhost:1234",
    description: "Run models locally with LM Studio",
  },
  {
    value: "openai-compatible",
    label: "OpenAI Compatible",
    isLocal: true,
    defaultUrl: "http://localhost:8000",
    description: "Any OpenAI-compatible API (vLLM, LocalAI, etc.)",
  },
];

export function AIProviders() {
  const queryClient = useQueryClient();
  const [newProvider, setNewProvider] = useState<AIProvider>("openai");
  const [newApiKey, setNewApiKey] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const { data: providers, isLoading } = useQuery({
    queryKey: ["settings", "ai"],
    queryFn: () => settings.getAIProviders(),
  });

  // Note: The backend stores provider+model together. For providers-only view,
  // we'll add with a placeholder model and handle models separately
  const addMutation = useMutation({
    mutationFn: (data: { provider: string; apiKey: string }) =>
      settings.addAIProvider(data.provider, data.apiKey, "__placeholder__"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings", "ai"] });
      setNewApiKey("");
      setNewBaseUrl("");
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

  // Check if provider is already configured
  const configuredProviders = new Set(providers?.map((p) => p.provider) ?? []);

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
    }
    setTestStatus("idle");
    setTestMessage("");
  };

  const handleAddProvider = (e: React.FormEvent) => {
    e.preventDefault();

    let apiKeyOrUrl = isLocalProvider ? newBaseUrl : newApiKey;
    if (newProvider === "openai-compatible" && newApiKey) {
      apiKeyOrUrl = `${newBaseUrl}|${newApiKey}`;
    }

    addMutation.mutate({
      provider: newProvider,
      apiKey: apiKeyOrUrl,
    });
  };

  // Group providers by type
  const configuredCloudProviders = providers?.filter(
    (p) => !PROVIDERS.find((c) => c.value === p.provider)?.isLocal
  ) ?? [];
  const configuredLocalProviders = providers?.filter(
    (p) => PROVIDERS.find((c) => c.value === p.provider)?.isLocal
  ) ?? [];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">AI Providers</h2>
        <p className="text-muted-foreground">
          Configure your API keys and connections. Keys are encrypted and stored securely.
        </p>
      </div>

      {/* Configured Providers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Configured Providers</CardTitle>
          <CardDescription>
            Your connected AI providers. Add models in the Models section.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : providers && providers.length > 0 ? (
            <div className="space-y-4">
              {/* Cloud Providers */}
              {configuredCloudProviders.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Cloud className="h-3.5 w-3.5" />
                    Cloud Providers
                  </h4>
                  {configuredCloudProviders.map((provider) => {
                    const config = PROVIDERS.find((p) => p.value === provider.provider);
                    return (
                      <div
                        key={provider.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <div>
                            <div className="font-medium">
                              {config?.label || provider.provider}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {config?.description}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(provider.id)}
                          disabled={deleteMutation.isPending}
                          title="Remove provider"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Local Providers */}
              {configuredLocalProviders.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Cpu className="h-3.5 w-3.5" />
                    Local Providers
                  </h4>
                  {configuredLocalProviders.map((provider) => {
                    const config = PROVIDERS.find((p) => p.value === provider.provider);
                    return (
                      <div
                        key={provider.id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <div>
                            <div className="font-medium">
                              {config?.label || provider.provider}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {config?.description}
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteMutation.mutate(provider.id)}
                          disabled={deleteMutation.isPending}
                          title="Remove provider"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No providers configured yet. Add one below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add New Provider */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Provider</CardTitle>
          <CardDescription>
            Connect a new AI provider by entering your API key or endpoint.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddProvider} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <select
                id="provider"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newProvider}
                onChange={(e) => handleProviderChange(e.target.value as AIProvider)}
              >
                <optgroup label="Cloud Providers">
                  {PROVIDERS.filter((p) => !p.isLocal).map((p) => (
                    <option
                      key={p.value}
                      value={p.value}
                      disabled={configuredProviders.has(p.value)}
                    >
                      {p.label} {configuredProviders.has(p.value) && "(configured)"}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Local Providers">
                  {PROVIDERS.filter((p) => p.isLocal).map((p) => (
                    <option
                      key={p.value}
                      value={p.value}
                      disabled={configuredProviders.has(p.value)}
                    >
                      {p.label} {configuredProviders.has(p.value) && "(configured)"}
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

            {/* API Key for cloud providers */}
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

            <Button
              type="submit"
              disabled={
                addMutation.isPending ||
                configuredProviders.has(newProvider) ||
                (!isLocalProvider && !newApiKey) ||
                (isLocalProvider && !newBaseUrl && !selectedProviderConfig?.defaultUrl)
              }
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
