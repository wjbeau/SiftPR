import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { codebase, github } from "@/lib/api";
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
import {
  Folder,
  Trash2,
  GitBranch,
  Clock,
  RefreshCw,
  Loader2,
  AlertTriangle,
  FolderGit,
  Download,
  FolderOpen,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export function Repositories() {
  const queryClient = useQueryClient();
  const [linkRepoName, setLinkRepoName] = useState("");
  const [linkLocalPath, setLinkLocalPath] = useState("");
  const [cloneRepoName, setCloneRepoName] = useState("");
  const [cloneDestPath, setCloneDestPath] = useState("");
  const [analyzingRepo, setAnalyzingRepo] = useState<string | null>(null);

  // GitHub repos query
  const { data: githubRepos } = useQuery({
    queryKey: ["github", "repos"],
    queryFn: () => github.getRepos(),
  });

  // Linked repos query
  const { data: linkedRepos, isLoading: linkedReposLoading } = useQuery({
    queryKey: ["codebase", "linked"],
    queryFn: () => codebase.getLinkedRepos(),
  });

  const linkRepoMutation = useMutation({
    mutationFn: (data: { repoFullName: string; localPath: string }) =>
      codebase.linkRepo(data.repoFullName, data.localPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setLinkRepoName("");
      setLinkLocalPath("");
    },
  });

  const unlinkRepoMutation = useMutation({
    mutationFn: (repoFullName: string) => codebase.unlinkRepo(repoFullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
    },
  });

  const analyzeRepoMutation = useMutation({
    mutationFn: (repoFullName: string) => codebase.analyze(repoFullName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setAnalyzingRepo(null);
    },
    onError: () => {
      setAnalyzingRepo(null);
    },
  });

  const cloneRepoMutation = useMutation({
    mutationFn: (data: { repoFullName: string; destinationPath: string }) =>
      codebase.cloneRepo(data.repoFullName, data.destinationPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setCloneRepoName("");
      setCloneDestPath("");
    },
  });

  const handleLinkRepo = (e: React.FormEvent) => {
    e.preventDefault();
    linkRepoMutation.mutate({ repoFullName: linkRepoName, localPath: linkLocalPath });
  };

  const handleCloneRepo = (e: React.FormEvent) => {
    e.preventDefault();
    cloneRepoMutation.mutate({ repoFullName: cloneRepoName, destinationPath: cloneDestPath });
  };

  const handleBrowseFolder = async (setPath: (path: string) => void) => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Repository Folder",
    });
    if (selected && typeof selected === "string") {
      setPath(selected);
    }
  };

  const handleAnalyzeRepo = (repoFullName: string) => {
    setAnalyzingRepo(repoFullName);
    analyzeRepoMutation.mutate(repoFullName);
  };

  // Filter out already linked repos
  const availableReposToLink = githubRepos?.filter(
    (repo) => !linkedRepos?.some((lr) => lr.repo_full_name === repo.full_name)
  );

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold">Repositories</h2>
        <p className="text-muted-foreground">
          Link local repository clones for enhanced AI analysis with codebase context.
        </p>
      </div>

      {/* Warning about branch switching */}
      <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Important: Repository Changes
              </p>
              <p className="text-amber-700 dark:text-amber-300 mt-1">
                When reviewing PRs, SiftPR may need to switch branches in linked repositories to analyze code.
                We recommend using a dedicated clone for reviews if you have uncommitted changes you want to preserve.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Linked Repositories */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FolderGit className="h-4 w-4" />
            Linked Repositories
          </CardTitle>
          <CardDescription>
            Local repository clones that provide codebase context for AI reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {linkedReposLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : linkedRepos && linkedRepos.length > 0 ? (
            <div className="space-y-3">
              {linkedRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-green-100 dark:bg-green-950">
                        <GitBranch className="h-4 w-4 text-green-600 dark:text-green-400" />
                      </div>
                      <div>
                        <div className="font-medium">{repo.repo_full_name}</div>
                        <div className="text-sm text-muted-foreground flex items-center gap-1">
                          <Folder className="h-3 w-3" />
                          {repo.local_path}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => unlinkRepoMutation.mutate(repo.repo_full_name)}
                      disabled={unlinkRepoMutation.isPending}
                      title="Unlink repository"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <div className="text-muted-foreground">
                      {repo.last_analyzed_commit ? (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Last analyzed: {repo.last_analyzed_commit.slice(0, 7)}
                          {repo.profile_data && (
                            <span className="ml-2 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-2 py-0.5 rounded">
                              {repo.profile_data.file_count} files
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          Not analyzed yet
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleAnalyzeRepo(repo.repo_full_name)}
                      disabled={analyzingRepo === repo.repo_full_name}
                    >
                      {analyzingRepo === repo.repo_full_name ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          {repo.last_analyzed_commit ? "Re-analyze" : "Analyze"}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No repositories linked yet. Link or clone one below.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Add Repository */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Repository</CardTitle>
          <CardDescription>
            Link an existing local clone or create a new dedicated clone for reviews.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="link">
            <TabsList className="mb-4">
              <TabsTrigger value="link" className="flex items-center gap-2">
                <Folder className="h-4 w-4" />
                Link Existing
              </TabsTrigger>
              <TabsTrigger value="clone" className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Clone New
              </TabsTrigger>
            </TabsList>

            <TabsContent value="link">
              <form onSubmit={handleLinkRepo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="link-repo-name">GitHub Repository</Label>
                  {availableReposToLink && availableReposToLink.length > 0 ? (
                    <select
                      id="link-repo-name"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={linkRepoName}
                      onChange={(e) => setLinkRepoName(e.target.value)}
                      required
                    >
                      <option value="">-- Select a repository --</option>
                      {availableReposToLink.map((repo) => (
                        <option key={repo.id} value={repo.full_name}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="link-repo-name"
                      type="text"
                      placeholder="owner/repo"
                      value={linkRepoName}
                      onChange={(e) => setLinkRepoName(e.target.value)}
                      required
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="link-local-path">Local Path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="link-local-path"
                      type="text"
                      placeholder="/Users/you/projects/repo"
                      value={linkLocalPath}
                      onChange={(e) => setLinkLocalPath(e.target.value)}
                      required
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleBrowseFolder(setLinkLocalPath)}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Select or enter the path to your local clone
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={linkRepoMutation.isPending || !linkRepoName || !linkLocalPath}
                >
                  {linkRepoMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Linking...
                    </>
                  ) : (
                    "Link Repository"
                  )}
                </Button>

                {linkRepoMutation.isError && (
                  <p className="text-sm text-destructive">
                    {(linkRepoMutation.error as Error).message}
                  </p>
                )}
              </form>
            </TabsContent>

            <TabsContent value="clone">
              <form onSubmit={handleCloneRepo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="clone-repo-name">GitHub Repository</Label>
                  {availableReposToLink && availableReposToLink.length > 0 ? (
                    <select
                      id="clone-repo-name"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={cloneRepoName}
                      onChange={(e) => setCloneRepoName(e.target.value)}
                      required
                    >
                      <option value="">-- Select a repository --</option>
                      {availableReposToLink.map((repo) => (
                        <option key={repo.id} value={repo.full_name}>
                          {repo.full_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="clone-repo-name"
                      type="text"
                      placeholder="owner/repo"
                      value={cloneRepoName}
                      onChange={(e) => setCloneRepoName(e.target.value)}
                      required
                    />
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="clone-dest-path">Destination Folder</Label>
                  <div className="flex gap-2">
                    <Input
                      id="clone-dest-path"
                      type="text"
                      placeholder="/Users/you/siftpr-repos"
                      value={cloneDestPath}
                      onChange={(e) => setCloneDestPath(e.target.value)}
                      className="flex-1"
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handleBrowseFolder(setCloneDestPath)}
                    >
                      <FolderOpen className="h-4 w-4 mr-2" />
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The repository will be cloned into a subfolder at this location
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={cloneRepoMutation.isPending || !cloneRepoName || !cloneDestPath}
                >
                  {cloneRepoMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Cloning...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4 mr-2" />
                      Clone Repository
                    </>
                  )}
                </Button>

                {cloneRepoMutation.isError && (
                  <p className="text-sm text-destructive">
                    {(cloneRepoMutation.error as Error).message}
                  </p>
                )}
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
