import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { RepoList } from "@/components/dashboard/RepoList";
import { PRTree } from "@/components/dashboard/PRTree";
import { GitHubRepo } from "@/lib/api";

export function Home() {
  const { isAuthenticated } = useAuth();
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h1 className="text-4xl font-bold mb-4">Welcome to SiftPR</h1>
        <p className="text-lg text-muted-foreground mb-8 text-center max-w-lg">
          AI-powered PR review tool that helps you identify important changes
          and organize your code review workflow.
        </p>
        <Button asChild size="lg">
          <Link to="/login">Login with GitHub to get started</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex gap-0 -mx-8 -my-8">
      {/* Left panel - Repository list */}
      <div className="w-1/3 min-w-[280px] max-w-[400px] border-r bg-muted/30">
        <RepoList selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />
      </div>

      {/* Right panel - PR tree */}
      <div className="flex-1">
        <PRTree repo={selectedRepo} />
      </div>
    </div>
  );
}
