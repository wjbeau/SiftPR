import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import { userRepos } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface AddRepoByUrlProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AddRepoByUrl({ isOpen, onClose }: AddRepoByUrlProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Clear state when closed
  useEffect(() => {
    if (!isOpen) {
      setUrl("");
      setError(null);
    }
  }, [isOpen]);

  const addRepoMutation = useMutation({
    mutationFn: (repoUrl: string) => userRepos.addByUrl(repoUrl),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      queryClient.invalidateQueries({ queryKey: ["user-repos"] });
      setUrl("");
      setError(null);
      onClose();
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError(null);
    addRepoMutation.mutate(url.trim());
  };

  if (!isOpen) return null;

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <Input
          ref={inputRef}
          placeholder="Paste GitHub repo URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="h-8 flex-1 text-sm"
          disabled={addRepoMutation.isPending}
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="h-8 w-8 flex-shrink-0"
          disabled={addRepoMutation.isPending || !url.trim()}
          title="Add repository"
        >
          {addRepoMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </Button>
      </form>
      {error && (
        <p className="text-xs text-destructive px-1">{error}</p>
      )}
    </div>
  );
}
