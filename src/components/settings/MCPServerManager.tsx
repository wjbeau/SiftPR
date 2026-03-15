import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { mcp, MCPServerConfig, MCPTool } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Check,
  AlertCircle,
  Plus,
  Trash2,
  Plug,
  TestTube2,
  X,
} from "lucide-react";

export function MCPServersSection({ agentType }: { agentType: string }) {
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
