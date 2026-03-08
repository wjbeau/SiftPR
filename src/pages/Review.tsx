import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, FileCode, Loader2, Sparkles, Calendar, MessageSquare, User, Users, GitPullRequest, RefreshCw, ClipboardList, AlertTriangle, BookOpen, Files, ChevronDown, Check, CheckCircle2, XCircle, MessageCircle, Eye, EyeOff, Plus, Send, Filter, History, Pencil, Trash2, X } from "lucide-react";
import { github, GitHubFile, GitHubPR, review } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatDistanceToNow } from "@/lib/utils";

type ViewMode = "all" | "since_review";

interface PendingComment {
  file: string;
  line: number;
  lineEnd: number;
  body: string;
}

type ReviewAction = "approve" | "request_changes" | "comment";

export function Review() {
  const { owner, repo, prNumber } = useParams<{
    owner: string;
    repo: string;
    prNumber: string;
  }>();

  const [selectedFile, setSelectedFile] = useState<GitHubFile | null>(null);
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [, setShowReviewDialog] = useState(false);
  const [reviewBody, setReviewBody] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const prNumberInt = prNumber ? parseInt(prNumber, 10) : 0;

  const toggleFileViewed = useCallback((filename: string) => {
    setViewedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) {
        next.delete(filename);
      } else {
        next.add(filename);
      }
      return next;
    });
  }, []);

  const addComment = useCallback((file: string, lineStart: number, lineEnd: number, body: string) => {
    setPendingComments((prev) => [...prev, { file, line: lineStart, lineEnd, body }]);
  }, []);

  const editComment = useCallback((index: number, newBody: string) => {
    setPendingComments((prev) => prev.map((c, i) => i === index ? { ...c, body: newBody } : c));
  }, []);

  const deleteComment = useCallback((index: number) => {
    setPendingComments((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const { data: pr, isLoading: prLoading } = useQuery({
    queryKey: ["pr", owner, repo, prNumber],
    queryFn: () => github.getPR(prUrl),
    enabled: !!owner && !!repo && !!prNumber,
  });

  const { data: files, isLoading: filesLoading } = useQuery({
    queryKey: ["pr-files", owner, repo, prNumber],
    queryFn: () => github.getPRFiles(prUrl),
    enabled: !!owner && !!repo && !!prNumber,
  });

  // Get previous review state
  const { data: reviewState } = useQuery({
    queryKey: ["review-state", owner, repo, prNumber],
    queryFn: () => review.getState(owner!, repo!, prNumberInt),
    enabled: !!owner && !!repo && !!prNumber,
  });

  // Get files changed since last review
  const { data: filesSinceReview } = useQuery({
    queryKey: ["files-since-review", owner, repo, reviewState?.last_reviewed_commit, pr?.head.sha],
    queryFn: () =>
      github.compareCommits(
        owner!,
        repo!,
        reviewState!.last_reviewed_commit,
        pr!.head.sha
      ),
    enabled: !!owner && !!repo && !!reviewState?.last_reviewed_commit && !!pr?.head.sha &&
             reviewState.last_reviewed_commit !== pr.head.sha,
  });

  // Initialize viewed files from saved state (only on first load)
  const [hasInitializedViewedFiles, setHasInitializedViewedFiles] = useState(false);
  useEffect(() => {
    if (reviewState?.viewed_files && !hasInitializedViewedFiles) {
      setViewedFiles(new Set(reviewState.viewed_files));
      setHasInitializedViewedFiles(true);
    }
  }, [reviewState?.viewed_files, hasInitializedViewedFiles]);

  // Determine which files to show based on view mode
  const displayFiles = useMemo(() => {
    if (viewMode === "since_review" && filesSinceReview) {
      return filesSinceReview;
    }
    return files || [];
  }, [viewMode, files, filesSinceReview]);

  const hasReviewedBefore = !!reviewState?.last_reviewed_commit;
  const hasNewChanges = hasReviewedBefore && pr?.head.sha !== reviewState?.last_reviewed_commit;

  const submitReview = useCallback(async (action: ReviewAction) => {
    // TODO: Implement GitHub API call to submit review
    console.log("Submitting review:", { action, body: reviewBody, comments: pendingComments });

    // Save the review state (mark current commit as reviewed)
    if (owner && repo && prNumberInt && pr?.head.sha) {
      try {
        await review.saveState(
          owner,
          repo,
          prNumberInt,
          pr.head.sha,
          Array.from(viewedFiles)
        );
      } catch (e) {
        console.error("Failed to save review state:", e);
      }
    }

    alert(`Review submitted: ${action}\n\nThis will integrate with GitHub API soon.`);
    setPendingComments([]);
    setReviewBody("");
    setShowReviewDialog(false);
  }, [reviewBody, pendingComments, owner, repo, prNumberInt, pr?.head.sha, viewedFiles]);

  const isLoading = prLoading || filesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!pr) {
    return (
      <div className="p-8">
        <p className="text-destructive">Failed to load pull request</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col -mx-8 -my-8">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-4 flex-shrink-0">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">#{prNumber}</span>
            <h1 className="font-semibold truncate">{pr.title}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {owner}/{repo} · {pr.user.login} · {pr.base.ref} ← {pr.head.ref}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={prUrl} target="_blank" rel="noopener noreferrer">
            View on GitHub
          </a>
        </Button>
      </div>

      {/* Main content - Tabbed layout */}
      <Tabs defaultValue="summary" className="flex-1 overflow-hidden">
        <div className="border-b px-4">
          <TabsList>
            <TabsTrigger value="summary" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="changes" className="gap-2">
              <FileCode className="h-4 w-4" />
              Changes
              {files && (
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">
                  {files.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="overflow-hidden">
          <Tabs defaultValue="overview" className="h-full">
            <div className="border-b px-6 bg-muted/30">
              <TabsList className="bg-transparent">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="ai-analytics" className="gap-2">
                  <Sparkles className="h-3.5 w-3.5" />
                  AI Analytics
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="overflow-y-auto p-6 pb-12">
              <OverviewPanel pr={pr} files={files || []} />
            </TabsContent>

            <TabsContent value="ai-analytics" className="overflow-y-auto p-6 pb-12">
              <AIAnalyticsPanel />
            </TabsContent>
          </Tabs>
        </TabsContent>

        <TabsContent value="changes" className="!flex-col overflow-hidden">
          {/* Review Actions Bar */}
          <div className="border-b px-4 py-2 flex items-center justify-between bg-muted/30 flex-shrink-0">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {viewedFiles.size} of {displayFiles.length} files viewed
              </span>
              {pendingComments.length > 0 && (
                <span className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {pendingComments.length} pending comment{pendingComments.length !== 1 ? "s" : ""}
                </span>
              )}
              {/* View mode toggle - only show if we've reviewed before */}
              {hasReviewedBefore && (
                <div className="flex items-center border rounded-md overflow-hidden">
                  <button
                    onClick={() => setViewMode("all")}
                    className={cn(
                      "px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors",
                      viewMode === "all"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    )}
                  >
                    <Filter className="h-3 w-3" />
                    All
                  </button>
                  <button
                    onClick={() => setViewMode("since_review")}
                    className={cn(
                      "px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors",
                      viewMode === "since_review"
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                      hasNewChanges && viewMode !== "since_review" && "text-amber-600"
                    )}
                  >
                    <History className="h-3 w-3" />
                    New
                    {hasNewChanges && filesSinceReview && (
                      <span className="bg-amber-500 text-white text-[10px] px-1 rounded-full">
                        {filesSinceReview.length}
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReviewDialog(true)}
                className="gap-1.5"
              >
                <MessageSquare className="h-4 w-4" />
                Comment
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => submitReview("approve")}
                className="gap-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => submitReview("request_changes")}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <XCircle className="h-4 w-4" />
                Request Changes
              </Button>
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden">
            {/* Prioritized File List */}
            <div className="w-80 border-r flex flex-col overflow-hidden flex-shrink-0">
              <div className="flex-1 overflow-y-auto">
                <PrioritizedFileList
                  files={displayFiles}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                  viewedFiles={viewedFiles}
                  onToggleViewed={toggleFileViewed}
                />
              </div>
            </div>

            {/* Diff Viewer */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-3 border-b flex items-center justify-between flex-shrink-0">
                <span className="font-medium">{selectedFile ? selectedFile.filename : "Select a file to view diff"}</span>
                {selectedFile && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">
                      <span className="text-green-600">+{selectedFile.additions}</span>
                      {" / "}
                      <span className="text-red-600">-{selectedFile.deletions}</span>
                    </span>
                    <Button
                      variant={viewedFiles.has(selectedFile.filename) ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleFileViewed(selectedFile.filename)}
                      className="gap-1.5"
                    >
                      {viewedFiles.has(selectedFile.filename) ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Viewed
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5" />
                          Mark as viewed
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>

              {/* AI Context Section */}
              {selectedFile && (
                <AIContextPanel file={selectedFile} />
              )}

              <div className="flex-1 overflow-auto">
                <DiffPanel
                  file={selectedFile}
                  onAddComment={addComment}
                  onEditComment={editComment}
                  onDeleteComment={deleteComment}
                  pendingComments={pendingComments}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface OverviewPanelProps {
  pr: GitHubPR;
  files: GitHubFile[];
}

function OverviewPanel({ pr, files }: OverviewPanelProps) {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Collect unique participants (author + assignees)
  const participants = useMemo(() => {
    const users = new Map<string, { login: string; avatar_url: string | null }>();
    users.set(pr.user.login, pr.user);
    pr.assignees?.forEach((a) => {
      if (a && !users.has(a.login)) {
        users.set(a.login, a);
      }
    });
    return Array.from(users.values());
  }, [pr]);

  return (
    <div className="flex gap-8 h-full">
      {/* Left - PR Description */}
      <div className="flex-1 min-w-0">
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-1">Description</h2>
          <p className="text-sm text-muted-foreground">
            {pr.base.ref} ← {pr.head.ref}
          </p>
        </div>

        {pr.body ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{pr.body}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted-foreground italic">No description provided.</p>
        )}
      </div>

      {/* Right - Stats Panel */}
      <div className="w-64 flex-shrink-0">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
          Details
        </h3>

        <div className="space-y-4">
          {/* Author */}
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Author</div>
              <div className="flex items-center gap-2 mt-1">
                {pr.user.avatar_url && (
                  <img
                    src={pr.user.avatar_url}
                    alt={pr.user.login}
                    className="h-5 w-5 rounded-full"
                  />
                )}
                <span className="text-sm font-medium">{pr.user.login}</span>
              </div>
            </div>
          </div>

          {/* Participants */}
          {participants.length > 1 && (
            <div className="flex items-start gap-3">
              <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground">Participants</div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {participants.map((p) => (
                    <div key={p.login} title={p.login}>
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt={p.login}
                          className="h-5 w-5 rounded-full"
                        />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-xs">
                          {p.login[0].toUpperCase()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Date Opened */}
          <div className="flex items-start gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Opened</div>
              <div className="text-sm">{formatDistanceToNow(pr.created_at)}</div>
            </div>
          </div>

          {/* Status */}
          <div className="flex items-start gap-3">
            <GitPullRequest className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-sm flex items-center gap-2">
                <span className={cn(
                  "capitalize",
                  pr.state === "open" && "text-green-600",
                  pr.state === "closed" && "text-red-600",
                  pr.state === "merged" && "text-purple-600"
                )}>
                  {pr.draft ? "Draft" : pr.state}
                </span>
              </div>
            </div>
          </div>

          {/* Comments */}
          {(pr.comments !== null || pr.review_comments !== null) && (
            <div className="flex items-start gap-3">
              <MessageSquare className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <div className="text-xs text-muted-foreground">Comments</div>
                <div className="text-sm">
                  {(pr.comments || 0) + (pr.review_comments || 0)} total
                </div>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Changes
            </h3>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">Files</div>
                <div className="text-lg font-semibold">{files.length}</div>
              </div>
              <div className="p-3 bg-muted rounded-lg">
                <div className="text-xs text-muted-foreground">Lines</div>
                <div className="text-lg font-semibold">
                  {totalAdditions + totalDeletions}
                </div>
              </div>
            </div>

            <div className="mt-3 p-3 bg-muted rounded-lg">
              <div className="flex justify-between text-sm">
                <span className="text-green-600 font-medium">+{totalAdditions}</span>
                <span className="text-red-600 font-medium">-{totalDeletions}</span>
              </div>
              <div className="mt-2 h-2 bg-background rounded-full overflow-hidden flex">
                <div
                  className="bg-green-500 h-full"
                  style={{
                    width: `${(totalAdditions / (totalAdditions + totalDeletions || 1)) * 100}%`,
                  }}
                />
                <div
                  className="bg-red-500 h-full"
                  style={{
                    width: `${(totalDeletions / (totalAdditions + totalDeletions || 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AIAnalyticsPanel() {
  const handleRefresh = () => {
    // TODO: Implement AI analysis refresh
    console.log("Refreshing AI analysis...");
  };

  return (
    <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
      <div className="p-4 bg-purple-100 dark:bg-purple-950/50 rounded-full mb-6">
        <Sparkles className="h-12 w-12 text-purple-500" />
      </div>

      <h2 className="text-xl font-semibold mb-2">AI-Powered Analysis</h2>
      <p className="text-muted-foreground mb-6">
        Get intelligent insights about this pull request including risk assessment,
        code quality analysis, and suggested review focus areas.
      </p>

      <div className="p-4 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800 mb-6">
        <p className="text-sm text-amber-700 dark:text-amber-300">
          This feature is coming soon. Configure your AI provider in Settings to enable analysis.
        </p>
      </div>

      <Button onClick={handleRefresh} variant="outline" className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Run Analysis
      </Button>
    </div>
  );
}

interface PrioritizedFileListProps {
  files: GitHubFile[];
  selectedFile: GitHubFile | null;
  onSelectFile: (file: GitHubFile) => void;
  viewedFiles: Set<string>;
  onToggleViewed: (filename: string) => void;
}

function PrioritizedFileList({
  files,
  selectedFile,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
}: PrioritizedFileListProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["key-changes", "context", "other"])
  );

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // TODO: This will be populated by AI analysis
  // For now, we'll simulate some prioritization based on file characteristics
  const { keyChanges, contextFiles, otherFiles } = useMemo(() => {
    // Placeholder logic - AI will provide real prioritization
    // For now: files with most changes are "key", test files are "context", rest are "other"
    const sorted = [...files].sort(
      (a, b) => (b.additions + b.deletions) - (a.additions + a.deletions)
    );

    const keyChanges: GitHubFile[] = [];
    const contextFiles: GitHubFile[] = [];
    const otherFiles: GitHubFile[] = [];

    for (const file of sorted) {
      const filename = file.filename.toLowerCase();
      if (filename.includes("test") || filename.includes("spec") || filename.includes(".mock")) {
        contextFiles.push(file);
      } else if (keyChanges.length < 3 && (file.additions + file.deletions) > 10) {
        keyChanges.push(file);
      } else {
        otherFiles.push(file);
      }
    }

    return { keyChanges, contextFiles, otherFiles };
  }, [files]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">No files changed</div>
    );
  }

  const renderFileItem = (file: GitHubFile) => {
    const fileName = file.filename.split("/").pop() || file.filename;
    const dirPath = file.filename.includes("/")
      ? file.filename.split("/").slice(0, -1).join("/")
      : null;
    const isSelected = selectedFile?.filename === file.filename;
    const isViewed = viewedFiles.has(file.filename);

    return (
      <div
        key={file.filename}
        className={cn(
          "group flex items-center gap-1 hover:bg-accent",
          isSelected && "bg-accent",
          isViewed && "opacity-60"
        )}
      >
        <button
          onClick={() => onSelectFile(file)}
          className="flex-1 text-left px-3 py-2 text-sm flex flex-col gap-0.5 min-w-0"
        >
          <span className="flex items-center justify-between gap-2">
            <span className={cn(
              "truncate flex items-center gap-1.5",
              !isViewed && "font-medium"
            )}>
              {isViewed ? (
                <Check className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
              ) : (
                <FileStatusIcon status={file.status} />
              )}
              {fileName}
            </span>
            <span className="flex-shrink-0 text-xs">
              <span className="text-green-600">+{file.additions}</span>
              {" "}
              <span className="text-red-600">-{file.deletions}</span>
            </span>
          </span>
          {dirPath && (
            <span className="text-xs text-muted-foreground truncate pl-5">
              {dirPath}
            </span>
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleViewed(file.filename);
          }}
          className="p-1.5 mr-2 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
          title={isViewed ? "Mark as unviewed" : "Mark as viewed"}
        >
          {isViewed ? (
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Eye className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>
      </div>
    );
  };

  const renderSection = (
    id: string,
    title: string,
    icon: React.ReactNode,
    files: GitHubFile[],
    emptyMessage?: string,
    description?: string
  ) => {
    const isExpanded = expandedSections.has(id);

    return (
      <div key={id} className="border-b last:border-b-0">
        <button
          onClick={() => toggleSection(id)}
          className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-muted/50 transition-colors"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              !isExpanded && "-rotate-90"
            )}
          />
          {icon}
          <span className="font-medium text-sm">{title}</span>
          <span className="text-xs text-muted-foreground ml-auto">
            {files.length}
          </span>
        </button>

        {isExpanded && (
          <div className="pb-2">
            {description && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                {description}
              </p>
            )}
            {files.length > 0 ? (
              files.map(renderFileItem)
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">
                {emptyMessage || "No files"}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* AI Analysis banner */}
      <div className="p-3 bg-purple-50 dark:bg-purple-950/30 border-b">
        <div className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
          <Sparkles className="h-4 w-4" />
          <span>AI prioritization coming soon</span>
        </div>
      </div>

      {renderSection(
        "key-changes",
        "Key Changes",
        <AlertTriangle className="h-4 w-4 text-amber-500" />,
        keyChanges,
        "Run AI analysis to identify key changes",
        "Most important changes to review first"
      )}

      {renderSection(
        "context",
        "Related Context",
        <BookOpen className="h-4 w-4 text-blue-500" />,
        contextFiles,
        "No related context identified",
        "Supporting files and test coverage"
      )}

      {renderSection(
        "other",
        "Other Changes",
        <Files className="h-4 w-4 text-muted-foreground" />,
        otherFiles,
        "No other files"
      )}
    </div>
  );
}

function FileStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "added":
      return <span className="text-green-600 font-bold text-xs">A</span>;
    case "removed":
      return <span className="text-red-600 font-bold text-xs">D</span>;
    case "modified":
      return <span className="text-yellow-600 font-bold text-xs">M</span>;
    case "renamed":
      return <span className="text-blue-600 font-bold text-xs">R</span>;
    default:
      return <span className="text-muted-foreground font-bold text-xs">?</span>;
  }
}

interface AIContextPanelProps {
  file: GitHubFile;
}

function AIContextPanel({ file }: AIContextPanelProps) {
  // TODO: This will be populated by actual AI analysis
  // For now, generate placeholder context based on file characteristics
  const context = useMemo(() => {
    const filename = file.filename.toLowerCase();
    const isTest = filename.includes("test") || filename.includes("spec");
    const isConfig = filename.includes("config") || filename.includes(".json") || filename.includes(".yaml") || filename.includes(".toml");
    const isStyle = filename.includes(".css") || filename.includes(".scss") || filename.includes("style");
    const isMigration = filename.includes("migration");
    const isLargeChange = (file.additions + file.deletions) > 50;

    let importance = "";
    let description = "";

    if (isTest) {
      importance = "Test coverage change";
      description = `Updates test cases with ${file.additions} new lines. Verify test coverage is adequate for the related changes.`;
    } else if (isConfig) {
      importance = "Configuration change";
      description = "Configuration changes can affect application behavior. Review for security implications and environment compatibility.";
    } else if (isMigration) {
      importance = "Database migration";
      description = "Schema changes require careful review. Check for backwards compatibility and data integrity.";
    } else if (isStyle) {
      importance = "Styling update";
      description = "Visual changes to the application. Consider checking for responsiveness and accessibility.";
    } else if (isLargeChange) {
      importance = "Significant code change";
      description = `This file has ${file.additions + file.deletions} lines changed. Consider reviewing in detail for logic correctness.`;
    } else {
      importance = "Code modification";
      description = "Standard code change. Review for correctness and adherence to project conventions.";
    }

    return { importance, description };
  }, [file]);

  return (
    <div className="px-4 py-2.5 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-b flex-shrink-0">
      <div className="flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              {context.importance}
            </span>
            <span className="text-xs text-muted-foreground">• AI Analysis</span>
          </div>
          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
            {context.description}
          </p>
        </div>
      </div>
    </div>
  );
}

interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "expandable";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
  // For expandable headers, store the line range
  expandRange?: { oldStart: number; newStart: number; oldEnd: number; newEnd: number };
}

interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
  index: number;
}

interface AIAnnotation {
  lineIndex: number;
  type: "warning" | "info" | "suggestion";
  message: string;
}

interface LineSelection {
  startIndex: number;
  endIndex: number;
}

function parseDiff(patch: string): DiffRow[] {
  const lines = patch.split("\n");
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let rowIndex = 0;
  let prevOldLine = 0;
  let prevNewLine = 0;

  // Temporary buffers for matching removed/added lines
  const removeBuffer: DiffLine[] = [];
  const addBuffer: DiffLine[] = [];

  const flushBuffers = () => {
    // Pair up removes and adds
    const maxLen = Math.max(removeBuffer.length, addBuffer.length);
    for (let i = 0; i < maxLen; i++) {
      rows.push({
        left: removeBuffer[i] || null,
        right: addBuffer[i] || null,
        index: rowIndex++,
      });
    }
    removeBuffer.length = 0;
    addBuffer.length = 0;
  };

  for (const line of lines) {
    if (line.startsWith("@@")) {
      flushBuffers();
      // Parse line numbers from hunk header: @@ -start,count +start,count @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        const newOldLine = parseInt(match[1], 10);
        const newNewLine = parseInt(match[2], 10);

        // Check if there's a gap (collapsed lines)
        if (rows.length > 0 && (newOldLine > prevOldLine + 1 || newNewLine > prevNewLine + 1)) {
          rows.push({
            left: {
              type: "expandable",
              content: `Expand ${Math.max(newOldLine - prevOldLine - 1, newNewLine - prevNewLine - 1)} hidden lines`,
              expandRange: {
                oldStart: prevOldLine + 1,
                oldEnd: newOldLine - 1,
                newStart: prevNewLine + 1,
                newEnd: newNewLine - 1,
              },
            },
            right: {
              type: "expandable",
              content: `Expand ${Math.max(newOldLine - prevOldLine - 1, newNewLine - prevNewLine - 1)} hidden lines`,
              expandRange: {
                oldStart: prevOldLine + 1,
                oldEnd: newOldLine - 1,
                newStart: prevNewLine + 1,
                newEnd: newNewLine - 1,
              },
            },
            index: rowIndex++,
          });
        }

        oldLine = newOldLine;
        newLine = newNewLine;
      }
      rows.push({
        left: { type: "header", content: line },
        right: { type: "header", content: line },
        index: rowIndex++,
      });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      addBuffer.push({
        type: "add",
        content: line.slice(1),
        newLineNum: newLine++,
      });
      prevNewLine = newLine - 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removeBuffer.push({
        type: "remove",
        content: line.slice(1),
        oldLineNum: oldLine++,
      });
      prevOldLine = oldLine - 1;
    } else if (!line.startsWith("+++") && !line.startsWith("---")) {
      flushBuffers();
      const contextLine: DiffLine = {
        type: "context",
        content: line.startsWith(" ") ? line.slice(1) : line,
        oldLineNum: oldLine++,
        newLineNum: newLine++,
      };
      prevOldLine = oldLine - 1;
      prevNewLine = newLine - 1;
      rows.push({
        left: contextLine,
        right: contextLine,
        index: rowIndex++,
      });
    }
  }
  flushBuffers();

  return rows;
}

// Generate mock AI annotations based on file content
function generateAIAnnotations(file: GitHubFile, rows: DiffRow[]): AIAnnotation[] {
  const annotations: AIAnnotation[] = [];
  const filename = file.filename.toLowerCase();

  rows.forEach((row) => {
    const line = row.right;
    if (!line || line.type === "header" || line.type === "expandable") return;

    const content = line.content.toLowerCase();

    // Security concerns
    if (content.includes("password") || content.includes("secret") || content.includes("api_key") || content.includes("token")) {
      annotations.push({
        lineIndex: row.index,
        type: "warning",
        message: "Potential sensitive data exposure. Ensure this is not hardcoded credentials.",
      });
    }

    // Error handling
    if ((content.includes("catch") && content.includes("{}")) || content.includes("// todo") || content.includes("// fixme")) {
      annotations.push({
        lineIndex: row.index,
        type: "suggestion",
        message: "Consider improving error handling or addressing this TODO comment.",
      });
    }

    // Console statements in production code
    if (content.includes("console.log") && !filename.includes("test")) {
      annotations.push({
        lineIndex: row.index,
        type: "info",
        message: "Debug statement detected. Consider removing before production.",
      });
    }

    // Large additions might need review
    if (line.type === "add" && line.content.length > 120) {
      annotations.push({
        lineIndex: row.index,
        type: "info",
        message: "Long line detected. Consider breaking into multiple lines for readability.",
      });
    }
  });

  return annotations;
}

interface DiffPanelProps {
  file: GitHubFile | null;
  onAddComment?: (file: string, lineStart: number, lineEnd: number, body: string) => void;
  onEditComment?: (index: number, newBody: string) => void;
  onDeleteComment?: (index: number) => void;
  pendingComments?: PendingComment[];
}

function DiffPanel({ file, onAddComment, onEditComment, onDeleteComment, pendingComments = [] }: DiffPanelProps) {
  const [commentingLines, setCommentingLines] = useState<LineSelection | null>(null);
  const [commentText, setCommentText] = useState("");
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [currentHover, setCurrentHover] = useState<number | null>(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  const diffRows = useMemo(() => {
    if (!file?.patch) return [];
    return parseDiff(file.patch);
  }, [file?.patch]);

  const aiAnnotations = useMemo(() => {
    if (!file) return [];
    return generateAIAnnotations(file, diffRows);
  }, [file, diffRows]);

  const annotationsByLine = useMemo(() => {
    const map = new Map<number, AIAnnotation[]>();
    aiAnnotations.forEach((a) => {
      const existing = map.get(a.lineIndex) || [];
      existing.push(a);
      map.set(a.lineIndex, existing);
    });
    return map;
  }, [aiAnnotations]);

  // Get comments for this file with their original indices
  const fileComments = useMemo(() => {
    return pendingComments
      .map((c, index) => ({ ...c, originalIndex: index }))
      .filter((c) => c.file === file?.filename);
  }, [pendingComments, file?.filename]);

  if (!file) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a file from the list to view its diff
      </div>
    );
  }

  if (!file.patch) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No diff available for this file (binary or too large)
      </div>
    );
  }

  const handleMouseDown = (index: number, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent text selection
    setSelectionStart(index);
    setCurrentHover(index);
  };

  const handleMouseEnter = (index: number) => {
    if (selectionStart !== null) {
      setCurrentHover(index);
    }
  };

  const handleMouseUp = () => {
    if (selectionStart !== null && currentHover !== null) {
      const start = Math.min(selectionStart, currentHover);
      const end = Math.max(selectionStart, currentHover);
      setCommentingLines({ startIndex: start, endIndex: end });
    }
    setSelectionStart(null);
    setCurrentHover(null);
  };

  const handleSubmitComment = () => {
    if (commentingLines && commentText.trim() && onAddComment) {
      onAddComment(file.filename, commentingLines.startIndex, commentingLines.endIndex, commentText.trim());
      setCommentText("");
      setCommentingLines(null);
    }
  };

  const handleStartEdit = (originalIndex: number, currentBody: string) => {
    setEditingCommentIndex(originalIndex);
    setEditingCommentText(currentBody);
  };

  const handleSaveEdit = () => {
    if (editingCommentIndex !== null && editingCommentText.trim() && onEditComment) {
      onEditComment(editingCommentIndex, editingCommentText.trim());
      setEditingCommentIndex(null);
      setEditingCommentText("");
    }
  };

  const handleCancelEdit = () => {
    setEditingCommentIndex(null);
    setEditingCommentText("");
  };

  const handleDelete = (originalIndex: number) => {
    if (onDeleteComment) {
      onDeleteComment(originalIndex);
    }
  };

  const handleExpandSection = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    // TODO: Fetch actual file content to show expanded lines
  };

  const isLineSelected = (index: number) => {
    if (!commentingLines) return false;
    return index >= commentingLines.startIndex && index <= commentingLines.endIndex;
  };

  const isLineInDrag = (index: number) => {
    if (selectionStart === null || currentHover === null) return false;
    const min = Math.min(selectionStart, currentHover);
    const max = Math.max(selectionStart, currentHover);
    return index >= min && index <= max;
  };

  const isDragging = selectionStart !== null;

  const renderGutter = (row: DiffRow, side: "left" | "right") => {
    const line = side === "left" ? row.left : row.right;
    const annotations = side === "right" ? annotationsByLine.get(row.index) : undefined;
    const hasAnnotation = annotations && annotations.length > 0;
    const isHovered = hoveredAnnotation === row.index;

    if (!line || line.type === "header" || line.type === "expandable") {
      return null;
    }

    return (
      <div className="w-6 flex-shrink-0 flex items-center justify-center relative">
        {hasAnnotation && side === "right" && (
          <div
            className="relative"
            onMouseEnter={() => setHoveredAnnotation(row.index)}
            onMouseLeave={() => setHoveredAnnotation(null)}
          >
            {annotations[0].type === "warning" ? (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 cursor-pointer" />
            ) : annotations[0].type === "suggestion" ? (
              <Sparkles className="h-3.5 w-3.5 text-purple-500 cursor-pointer" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 text-blue-500 cursor-pointer" />
            )}

            {/* Tooltip */}
            {isHovered && (
              <div className="absolute left-6 top-0 z-50 w-64 p-2 bg-popover border rounded-md shadow-lg text-xs font-sans">
                {annotations.map((a, i) => (
                  <div key={i} className={cn("flex gap-2", i > 0 && "mt-2 pt-2 border-t")}>
                    {a.type === "warning" ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                    ) : a.type === "suggestion" ? (
                      <Sparkles className="h-3.5 w-3.5 text-purple-500 flex-shrink-0 mt-0.5" />
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                    )}
                    <span className="text-foreground">{a.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLine = (line: DiffLine | null, side: "left" | "right", rowIndex: number) => {
    const isSelected = isLineSelected(rowIndex);
    const inDragRange = isLineInDrag(rowIndex);

    if (!line) {
      return (
        <div className="flex h-full flex-1">
          <span className="w-10 px-2 text-right text-muted-foreground/50 select-none text-xs bg-muted/30 flex items-center justify-end" />
          <pre className="flex-1 px-2 py-0.5 bg-muted/20"> </pre>
        </div>
      );
    }

    if (line.type === "expandable") {
      return (
        <button
          onClick={() => handleExpandSection(rowIndex)}
          className="w-full flex items-center justify-center gap-2 py-1.5 bg-muted/50 hover:bg-muted text-muted-foreground text-xs transition-colors"
        >
          <ChevronDown className="h-3.5 w-3.5" />
          <span>{line.content}</span>
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      );
    }

    if (line.type === "header") {
      return (
        <div className="flex bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 flex-1">
          <span className="w-10 px-2 text-right select-none text-xs flex items-center justify-end">
            ···
          </span>
          <pre className="flex-1 px-2 py-0.5 text-xs truncate">{line.content}</pre>
        </div>
      );
    }

    const lineNum = side === "left" ? line.oldLineNum : line.newLineNum;

    let bgClass = "";
    let textClass = "";
    if (line.type === "add") {
      bgClass = "bg-green-100 dark:bg-green-950/50";
      textClass = "text-green-800 dark:text-green-200";
    } else if (line.type === "remove") {
      bgClass = "bg-red-100 dark:bg-red-950/50";
      textClass = "text-red-800 dark:text-red-200";
    }

    // Selection highlighting - show blue background for drag selection
    if (inDragRange && side === "right") {
      bgClass = "bg-blue-200 dark:bg-blue-900/70";
    } else if (isSelected && side === "right") {
      bgClass = cn(bgClass, "ring-2 ring-inset ring-blue-400 dark:ring-blue-600");
    }

    return (
      <div
        className={cn(
          "flex group flex-1",
          bgClass,
          side === "right" && "cursor-pointer"
        )}
        style={{ userSelect: isDragging ? "none" : "auto" }}
        onMouseDown={(e) => side === "right" && line.type !== "header" && handleMouseDown(rowIndex, e)}
        onMouseEnter={() => side === "right" && handleMouseEnter(rowIndex)}
        onMouseUp={() => side === "right" && handleMouseUp()}
      >
        <span
          className={cn(
            "w-10 px-2 text-right select-none text-xs flex items-center justify-end",
            line.type === "context" ? "text-muted-foreground" : textClass
          )}
        >
          {lineNum}
        </span>
        <pre className={cn("flex-1 px-2 py-0.5 whitespace-pre-wrap break-all select-none", textClass)}>
          {line.content || " "}
        </pre>
      </div>
    );
  };

  return (
    <div className="font-mono text-sm h-full" onMouseLeave={() => isDragging && handleMouseUp()}>
      <div className="flex border-b bg-muted/50 text-xs text-muted-foreground">
        <div className="w-6" /> {/* Gutter spacer */}
        <div className="flex-1 px-4 py-1.5 border-r">Original</div>
        <div className="w-6" /> {/* Gutter spacer */}
        <div className="flex-1 px-4 py-1.5">Modified</div>
      </div>
      <div>
        {diffRows.map((row) => {
          // Get comments that start on this line
          const lineComments = fileComments.filter((c) => c.line === row.index);
          const isCommentingThisLine =
            commentingLines && row.index === commentingLines.endIndex;
          const isExpandable = row.left?.type === "expandable";

          if (isExpandable && expandedSections.has(row.index)) {
            // Show placeholder for expanded content
            return (
              <div key={row.index} className="border-b border-border/50 bg-muted/30 p-2 text-center text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                Loading expanded content...
              </div>
            );
          }

          return (
            <div key={row.index}>
              <div className="flex border-b border-border/50 group/row">
                {/* Left gutter */}
                {renderGutter(row, "left")}

                {/* Left side (original) */}
                <div className="flex-1 border-r border-border/50 min-w-0 flex">
                  {renderLine(row.left, "left", row.index)}
                </div>

                {/* Right gutter */}
                {renderGutter(row, "right")}

                {/* Right side (modified) */}
                <div className="flex-1 min-w-0 relative flex">
                  {renderLine(row.right, "right", row.index)}
                  {/* Comment indicator for selected lines */}
                  {row.right && row.right.type !== "header" && row.right.type !== "expandable" && !isDragging && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          setCommentingLines({ startIndex: row.index, endIndex: row.index });
                        }}
                        className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900"
                        title="Add comment"
                      >
                        <Plus className="h-3.5 w-3.5 text-blue-500" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Comment input - shown at end of selection */}
              {isCommentingThisLine && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <MessageCircle className="h-4 w-4 text-blue-500" />
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300 font-sans">
                        {commentingLines.startIndex === commentingLines.endIndex
                          ? `Comment on line ${row.right?.newLineNum || row.index + 1}`
                          : `Comment on lines ${commentingLines.startIndex + 1}-${commentingLines.endIndex + 1}`}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setCommentingLines(null);
                        setCommentText("");
                      }}
                      className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                    >
                      <X className="h-4 w-4 text-blue-500" />
                    </button>
                  </div>
                  <textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Write a comment..."
                    className="w-full p-2 text-sm bg-background border rounded resize-none font-sans"
                    rows={3}
                    autoFocus
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCommentingLines(null);
                        setCommentText("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSubmitComment}
                      disabled={!commentText.trim()}
                      className="gap-1.5"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Add Comment
                    </Button>
                  </div>
                </div>
              )}

              {/* Show pending comments with edit/delete */}
              {lineComments.map((comment) => {
                const isEditing = editingCommentIndex === comment.originalIndex;

                return (
                  <div
                    key={comment.originalIndex}
                    className="p-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-800"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <MessageCircle className="h-3.5 w-3.5 text-blue-500" />
                        <span className="text-xs text-blue-600 dark:text-blue-400 font-medium font-sans">
                          Pending comment
                          {comment.lineEnd !== comment.line && (
                            <span className="text-muted-foreground ml-1">
                              (lines {comment.line + 1}-{comment.lineEnd + 1})
                            </span>
                          )}
                        </span>
                      </div>
                      {!isEditing && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStartEdit(comment.originalIndex, comment.body)}
                            className="p-1 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                            title="Edit comment"
                          >
                            <Pencil className="h-3.5 w-3.5 text-blue-500" />
                          </button>
                          <button
                            onClick={() => handleDelete(comment.originalIndex)}
                            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900"
                            title="Delete comment"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <>
                        <textarea
                          value={editingCommentText}
                          onChange={(e) => setEditingCommentText(e.target.value)}
                          className="w-full p-2 text-sm bg-background border rounded resize-none font-sans"
                          rows={3}
                          autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleSaveEdit}
                            disabled={!editingCommentText.trim()}
                            className="gap-1.5"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Save
                          </Button>
                        </div>
                      </>
                    ) : (
                      <p className="text-sm font-sans whitespace-pre-wrap">{comment.body}</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
