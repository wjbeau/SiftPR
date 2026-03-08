import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { RepoList } from "@/components/dashboard/RepoList";
import { PRTree } from "@/components/dashboard/PRTree";
import type { GitHubRepo } from "@/lib/api";

const STORAGE_KEY_WIDTH = "siftpr-sidebar-width";
const STORAGE_KEY_REPO = "siftpr-selected-repo";
const DEFAULT_WIDTH = 240;
const MIN_WIDTH = 200;
const MAX_WIDTH = 500;

export function Home() {
  const { isAuthenticated } = useAuth();
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(() => {
    // Restore selected repo from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY_REPO);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    // Restore sidebar width from localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY_WIDTH);
      return saved ? Number.parseInt(saved, 10) : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist selected repo
  useEffect(() => {
    if (selectedRepo) {
      localStorage.setItem(STORAGE_KEY_REPO, JSON.stringify(selectedRepo));
    } else {
      localStorage.removeItem(STORAGE_KEY_REPO);
    }
  }, [selectedRepo]);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_WIDTH, String(sidebarWidth));
  }, [sidebarWidth]);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = e.clientX - containerRect.left;
      setSidebarWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

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
    <div
      ref={containerRef}
      className="h-[calc(100vh-8rem)] flex -mx-8 -my-8"
      style={{ cursor: isDragging ? "col-resize" : undefined }}
    >
      {/* Left panel - Repository list */}
      <div
        className="flex-shrink-0 border-r bg-muted/30"
        style={{ width: sidebarWidth }}
      >
        <RepoList selectedRepo={selectedRepo} onSelectRepo={setSelectedRepo} />
      </div>

      {/* Resize handle */}
      <div
        className="w-1 cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors flex-shrink-0"
        onMouseDown={handleMouseDown}
        style={{ backgroundColor: isDragging ? "hsl(var(--primary) / 0.4)" : undefined }}
      />

      {/* Right panel - PR tree */}
      <div className="flex-1 min-w-0">
        <PRTree repo={selectedRepo} />
      </div>
    </div>
  );
}
