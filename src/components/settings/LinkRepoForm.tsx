import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { codebase, GitHubRepo } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Folder,
  Download,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

interface LinkRepoFormProps {
  availableRepos: GitHubRepo[] | undefined;
}

export function LinkRepoForm({ availableRepos }: LinkRepoFormProps) {
  const queryClient = useQueryClient();
  const [linkRepoName, setLinkRepoName] = useState("");
  const [linkLocalPath, setLinkLocalPath] = useState("");
  const [cloneRepoName, setCloneRepoName] = useState("");
  const [cloneDestPath, setCloneDestPath] = useState("");

  const linkRepoMutation = useMutation({
    mutationFn: (data: { repoFullName: string; localPath: string }) =>
      codebase.linkRepo(data.repoFullName, data.localPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["codebase", "linked"] });
      setLinkRepoName("");
      setLinkLocalPath("");
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

  return (
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
            {availableRepos && availableRepos.length > 0 ? (
              <select
                id="link-repo-name"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={linkRepoName}
                onChange={(e) => setLinkRepoName(e.target.value)}
                required
              >
                <option value="">-- Select a repository --</option>
                {availableRepos.map((repo) => (
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
            {availableRepos && availableRepos.length > 0 ? (
              <select
                id="clone-repo-name"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={cloneRepoName}
                onChange={(e) => setCloneRepoName(e.target.value)}
                required
              >
                <option value="">-- Select a repository --</option>
                {availableRepos.map((repo) => (
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
  );
}
