import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
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

type AIProvider = "openai" | "anthropic" | "openrouter";

const PROVIDERS: { value: AIProvider; label: string; models: string[] }[] = [
  {
    value: "openai",
    label: "OpenAI",
    models: ["gpt-4o", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo"],
  },
  {
    value: "anthropic",
    label: "Anthropic",
    models: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514", "meta-llama/llama-3-70b-instruct"],
  },
];

export function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newProvider, setNewProvider] = useState<AIProvider>("openai");
  const [newApiKey, setNewApiKey] = useState("");
  const [newModel, setNewModel] = useState("gpt-4o");

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

  const handleAddProvider = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      provider: newProvider,
      apiKey: newApiKey,
      model: newModel,
    });
  };

  const selectedProviderConfig = PROVIDERS.find((p) => p.value === newProvider);

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
              {data.map((setting) => (
                <div
                  key={setting.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <div className="font-medium">
                      {PROVIDERS.find((p) => p.value === setting.provider)?.label}
                      {setting.is_active && (
                        <span className="ml-2 text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Model: {setting.model_preference}
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
              ))}
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
                onChange={(e) => {
                  const provider = e.target.value as AIProvider;
                  setNewProvider(provider);
                  setNewModel(PROVIDERS.find((p) => p.value === provider)?.models[0] || "");
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="sk-..."
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <select
                id="model"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
              >
                {selectedProviderConfig?.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            <Button type="submit" disabled={addMutation.isPending}>
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
