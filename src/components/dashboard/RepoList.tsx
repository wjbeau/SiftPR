import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, RefreshCw } from "lucide-react";
import { github, favorites, GitHubRepo } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const STORAGE_KEY_REPOS = "siftpr-cached-repos";
const STORAGE_KEY_FAVORITES = "siftpr-cached-favorites";

interface RepoListProps {
  selectedRepo: GitHubRepo | null;
  onSelectRepo: (repo: GitHubRepo) => void;
}

// Load cached data from localStorage
function getCachedRepos(): GitHubRepo[] | undefined {
  try {
    const cached = localStorage.getItem(STORAGE_KEY_REPOS);
    return cached ? JSON.parse(cached) : undefined;
  } catch {
    return undefined;
  }
}

function getCachedFavorites(): number[] | undefined {
  try {
    const cached = localStorage.getItem(STORAGE_KEY_FAVORITES);
    return cached ? JSON.parse(cached) : undefined;
  } catch {
    return undefined;
  }
}

export function RepoList({ selectedRepo, onSelectRepo }: RepoListProps) {
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  const { data: repos, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["repos"],
    queryFn: () => github.getRepos(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    placeholderData: getCachedRepos,
  });

  const { data: favoriteIds = [] } = useQuery({
    queryKey: ["favorites"],
    queryFn: () => favorites.get(),
    staleTime: 1000 * 60 * 5,
    placeholderData: getCachedFavorites,
  });

  // Cache repos to localStorage when they change
  useEffect(() => {
    if (repos && repos.length > 0) {
      localStorage.setItem(STORAGE_KEY_REPOS, JSON.stringify(repos));
    }
  }, [repos]);

  // Cache favorites to localStorage when they change
  useEffect(() => {
    if (favoriteIds && favoriteIds.length > 0) {
      localStorage.setItem(STORAGE_KEY_FAVORITES, JSON.stringify(favoriteIds));
    }
  }, [favoriteIds]);

  const addFavorite = useMutation({
    mutationFn: (repo: GitHubRepo) => favorites.add(repo.id, repo.full_name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const removeFavorite = useMutation({
    mutationFn: (repoId: number) => favorites.remove(repoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favorites"] }),
  });

  const toggleFavorite = (repo: GitHubRepo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (favoriteIds.includes(repo.id)) {
      removeFavorite.mutate(repo.id);
    } else {
      addFavorite.mutate(repo);
    }
  };

  // Filter repos by search
  const filteredRepos = useMemo(() => {
    if (!repos) return [];
    if (!search.trim()) return repos;
    const query = search.toLowerCase();
    return repos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.full_name.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query)
    );
  }, [repos, search]);

  // Group repos by owner (organization/user)
  const groupedRepos = useMemo(() => {
    const groups = new Map<string, GitHubRepo[]>();
    for (const repo of filteredRepos) {
      const owner = repo.owner.login;
      if (!groups.has(owner)) {
        groups.set(owner, []);
      }
      groups.get(owner)!.push(repo);
    }
    // Sort groups by name
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredRepos]);

  // Get favorite repos
  const favoriteRepos = useMemo(() => {
    if (!repos) return [];
    return repos.filter((repo) => favoriteIds.includes(repo.id));
  }, [repos, favoriteIds]);

  // Filter favorites by search too
  const filteredFavorites = useMemo(() => {
    if (!search.trim()) return favoriteRepos;
    const query = search.toLowerCase();
    return favoriteRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.full_name.toLowerCase().includes(query) ||
        repo.description?.toLowerCase().includes(query)
    );
  }, [favoriteRepos, search]);

  // Only show loading state on initial load (no cached data)
  const showLoading = isLoading && !repos;

  if (showLoading) {
    return (
      <div className="p-4">
        <div className="text-sm text-muted-foreground">Loading repositories...</div>
      </div>
    );
  }

  if (error && !repos) {
    return (
      <div className="p-4">
        <div className="text-sm text-destructive">Failed to load repositories</div>
      </div>
    );
  }

  // Default open sections - favorites if any, plus first org
  const defaultOpen = [
    ...(filteredFavorites.length > 0 ? ["favorites"] : []),
    ...(groupedRepos.length > 0 ? [groupedRepos[0][0]] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search repositories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 flex-1"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh repositories"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {isFetching && repos && (
          <div className="text-xs text-muted-foreground">Refreshing...</div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {filteredRepos.length === 0 && filteredFavorites.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {search ? "No repositories match your search" : "No repositories found"}
          </div>
        ) : (
          <Accordion type="multiple" defaultValue={defaultOpen} className="w-full">
            {/* Favorites section */}
            {filteredFavorites.length > 0 && (
              <AccordionItem value="favorites">
                <AccordionTrigger className="bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
                    <span>Favorites</span>
                    <span className="text-xs text-muted-foreground">
                      ({filteredFavorites.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ul>
                    {filteredFavorites.map((repo) => (
                      <RepoItem
                        key={repo.id}
                        repo={repo}
                        isSelected={selectedRepo?.id === repo.id}
                        isFavorite={true}
                        onSelect={() => onSelectRepo(repo)}
                        onToggleFavorite={(e) => toggleFavorite(repo, e)}
                      />
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Organization sections */}
            {groupedRepos.map(([owner, ownerRepos]) => (
              <AccordionItem key={owner} value={owner}>
                <AccordionTrigger>
                  <div className="flex items-center gap-2">
                    <img
                      src={ownerRepos[0].owner.avatar_url}
                      alt={owner}
                      className="h-4 w-4 rounded-full"
                    />
                    <span>{owner}</span>
                    <span className="text-xs text-muted-foreground">
                      ({ownerRepos.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <ul>
                    {ownerRepos.map((repo) => (
                      <RepoItem
                        key={repo.id}
                        repo={repo}
                        isSelected={selectedRepo?.id === repo.id}
                        isFavorite={favoriteIds.includes(repo.id)}
                        onSelect={() => onSelectRepo(repo)}
                        onToggleFavorite={(e) => toggleFavorite(repo, e)}
                      />
                    ))}
                  </ul>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </div>
    </div>
  );
}

interface RepoItemProps {
  repo: GitHubRepo;
  isSelected: boolean;
  isFavorite: boolean;
  onSelect: () => void;
  onToggleFavorite: (e: React.MouseEvent) => void;
}

function RepoItem({
  repo,
  isSelected,
  isFavorite,
  onSelect,
  onToggleFavorite,
}: RepoItemProps) {
  const { data: prCount } = useQuery({
    queryKey: ["repo-pr-count", repo.owner.login, repo.name],
    queryFn: () => github.getRepoPRCount(repo.owner.login, repo.name),
    staleTime: 1000 * 60 * 2, // 2 minutes
  });

  return (
    <li>
      <button
        onClick={onSelect}
        className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 ${
          isSelected ? "bg-accent" : ""
        }`}
      >
        <button
          onClick={onToggleFavorite}
          className="p-0.5 hover:bg-muted rounded transition-colors flex-shrink-0"
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className={`h-3.5 w-3.5 ${
              isFavorite
                ? "text-yellow-500 fill-yellow-500"
                : "text-muted-foreground hover:text-yellow-500"
            }`}
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-medium truncate text-sm">{repo.name}</span>
              {repo.private && (
                <span className="text-[10px] bg-muted px-1 py-0.5 rounded flex-shrink-0">
                  private
                </span>
              )}
            </div>
            {prCount !== undefined && prCount > 0 && (
              <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full flex-shrink-0">
                {prCount}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}
