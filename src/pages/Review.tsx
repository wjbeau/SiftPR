import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, FileCode, Loader2, Sparkles, Calendar, MessageSquare, User, Users, GitPullRequest, RefreshCw, ClipboardList, AlertTriangle, BookOpen, Files, ChevronDown, ChevronUp, Check, CheckCircle2, XCircle, MessageCircle, Eye, EyeOff, Plus, Send, Filter, History, Pencil, Trash2, X, Shield, Layers, Paintbrush, Zap, FolderOpen, Settings, Download, FileText } from "lucide-react";
import { github, GitHubFile, GitHubPR, GitHubReview, review, ai, analysis as analysisApi, OrchestratedAnalysis, FileAnalysis, LineAnnotation, AgentType, codebase, LinkedRepo, ReviewComment, draftComments } from "@/lib/api";
import { logger } from "@/lib/logger";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatDistanceToNow } from "@/lib/utils";
import { CommentToolbar } from "@/components/CommentToolbar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatAnalysisAsMarkdown, downloadMarkdown, downloadAsHTML } from "@/lib/exportAnalysis";

type ViewMode = "all" | "since_review";

interface PendingComment {
  id?: string;
  file: string;
  line: number;
  lineEnd: number;
  body: string;
  newLineNum?: number; // Actual end file line number for GitHub API
  newLineNumStart?: number; // Actual start file line number for GitHub API (multi-line)
}

type ReviewAction = "approve" | "request_changes" | "comment";

export function Review() {
  const { owner, repo, prNumber } = useParams<{
    owner: string;
    repo: string;
    prNumber: string;
  }>();
  const { user } = useAuth();

  const [selectedFile, setSelectedFile] = useState<GitHubFile | null>(null);
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [pendingComments, setPendingComments] = useState<PendingComment[]>([]);
  const [showReviewDialog, setShowReviewDialog] = useState(false);
  const [reviewBody, setReviewBody] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [analysis, setAnalysis] = useState<OrchestratedAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisMode, setAnalysisMode] = useState<"pr_only" | "with_context">("pr_only");
  const [lastAnalysisMode, setLastAnalysisMode] = useState<"pr_only" | "with_context" | null>(null);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const repoFullName = `${owner}/${repo}`;
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

  const addComment = useCallback((file: string, lineStart: number, lineEnd: number, body: string, newLineNum?: number, newLineNumStart?: number) => {
    setPendingComments((prev) => {
      const newComment: PendingComment = { file, line: lineStart, lineEnd, body, newLineNum, newLineNumStart };
      // Fire-and-forget save to backend
      if (owner && repo && prNumberInt) {
        draftComments.save(owner, repo, prNumberInt, file, lineStart, lineEnd, body, newLineNum, newLineNumStart)
          .then((saved) => {
            setPendingComments((current) => {
              // Find the comment we just added (by reference match on body/file/line) and add the ID
              const idx = current.findIndex(
                (c) => !c.id && c.file === file && c.line === lineStart && c.lineEnd === lineEnd && c.body === body
              );
              if (idx >= 0) {
                const updated = [...current];
                updated[idx] = { ...updated[idx], id: saved.id };
                return updated;
              }
              return current;
            });
          })
          .catch((err) => logger.error("Failed to save draft comment:", err));
      }
      return [...prev, newComment];
    });
  }, [owner, repo, prNumberInt]);

  const editComment = useCallback((index: number, newBody: string) => {
    setPendingComments((prev) => {
      const comment = prev[index];
      if (comment?.id) {
        draftComments.update(comment.id, newBody).catch((err) =>
          logger.error("Failed to update draft comment:", err)
        );
      }
      return prev.map((c, i) => i === index ? { ...c, body: newBody } : c);
    });
  }, []);

  const deleteComment = useCallback((index: number) => {
    setPendingComments((prev) => {
      const comment = prev[index];
      if (comment?.id) {
        draftComments.delete(comment.id).catch((err) =>
          logger.error("Failed to delete draft comment:", err)
        );
      }
      return prev.filter((_, i) => i !== index);
    });
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

  // Get linked repo for local context
  const { data: linkedRepo } = useQuery({
    queryKey: ["codebase", "linked", repoFullName],
    queryFn: () => codebase.getLinkedRepo(repoFullName),
    enabled: !!owner && !!repo,
  });

  // Initialize viewed files from saved state (only on first load)
  const [hasInitializedViewedFiles, setHasInitializedViewedFiles] = useState(false);
  useEffect(() => {
    if (reviewState?.viewed_files && !hasInitializedViewedFiles) {
      setViewedFiles(new Set(reviewState.viewed_files));
      setHasInitializedViewedFiles(true);
    }
  }, [reviewState?.viewed_files, hasInitializedViewedFiles]);

  // Load draft comments on mount
  const [hasLoadedDrafts, setHasLoadedDrafts] = useState(false);
  useEffect(() => {
    if (owner && repo && prNumberInt && !hasLoadedDrafts) {
      setHasLoadedDrafts(true);
      draftComments.get(owner, repo, prNumberInt)
        .then((drafts) => {
          if (drafts.length > 0) {
            setPendingComments(drafts.map((d) => ({
              id: d.id,
              file: d.file_path,
              line: d.line_start,
              lineEnd: d.line_end,
              body: d.body,
              newLineNum: d.new_line_num ?? undefined,
              newLineNumStart: d.new_line_num_start ?? undefined,
            })));
          }
        })
        .catch((err) => logger.error("Failed to load draft comments:", err));
    }
  }, [owner, repo, prNumberInt, hasLoadedDrafts]);

  // Load saved analysis when PR data is available
  const [hasLoadedAnalysis, setHasLoadedAnalysis] = useState(false);
  useEffect(() => {
    if (pr?.head.sha && owner && repo && prNumberInt && !hasLoadedAnalysis && !analysis) {
      setHasLoadedAnalysis(true);
      analysisApi.get(owner, repo, prNumberInt, pr.head.sha)
        .then((savedAnalysis) => {
          if (savedAnalysis) {
            logger.log("Loaded saved analysis for commit:", pr.head.sha);
            setAnalysis(savedAnalysis);
          }
        })
        .catch((err) => {
          logger.error("Failed to load saved analysis:", err);
        });
    }
  }, [pr?.head.sha, owner, repo, prNumberInt, hasLoadedAnalysis, analysis]);

  // Determine which files to show based on view mode
  const displayFiles = useMemo(() => {
    if (viewMode === "since_review" && filesSinceReview) {
      return filesSinceReview;
    }
    return files || [];
  }, [viewMode, files, filesSinceReview]);

  const hasReviewedBefore = !!reviewState?.last_reviewed_commit;
  const hasNewChanges = hasReviewedBefore && pr?.head.sha !== reviewState?.last_reviewed_commit;

  const runAnalysis = useCallback(async () => {
    if (!prUrl || !owner || !repo || !pr?.head.sha) return;
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const withContext = analysisMode === "with_context";
      logger.log("Starting analysis for:", prUrl, "with context:", withContext);
      const result = await ai.analyzePROrchestrated(prUrl, withContext);
      logger.log("Analysis result:", result);
      setAnalysis(result);
      setLastAnalysisMode(analysisMode);

      // Save analysis to cache
      try {
        await analysisApi.save(owner, repo, prNumberInt, pr.head.sha, result);
        logger.log("Analysis saved to cache");
      } catch (saveErr) {
        logger.error("Failed to save analysis:", saveErr);
      }
    } catch (e) {
      logger.error("Analysis failed:", e);
      // Tauri errors come as strings or objects with message property
      const errorMsg = typeof e === "string"
        ? e
        : (e as { message?: string })?.message || JSON.stringify(e);
      setAnalysisError(errorMsg);
      // Clear stale analysis so the error is visible to the user
      // (the UI only shows errors when analysis is null)
      setAnalysis(null);
    } finally {
      setIsAnalyzing(false);
    }
  }, [prUrl, analysisMode, owner, repo, prNumberInt, pr?.head.sha]);

  // Get file analysis for selected file
  const selectedFileAnalysis = useMemo(() => {
    if (!analysis || !selectedFile) return null;
    const result = analysis.file_analyses.find(fa => fa.filename === selectedFile.filename) || null;
    logger.log("[Review] selectedFile:", selectedFile?.filename);
    logger.log("[Review] file_analyses filenames:", analysis.file_analyses.map(fa => fa.filename));
    logger.log("[Review] selectedFileAnalysis:", result);
    logger.log("[Review] selectedFileAnalysis annotations:", result?.annotations);
    return result;
  }, [analysis, selectedFile]);

  // Compute sorted file list matching sidebar order
  const sortedFiles = useMemo(() => {
    if (!displayFiles.length) return [];

    // If we have file groups from AI, use group ordering (high -> medium -> low)
    if (analysis?.file_groups && analysis.file_groups.length > 0) {
      const importanceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const sortedGroups = [...analysis.file_groups].sort(
        (a, b) => (importanceOrder[a.importance] ?? 2) - (importanceOrder[b.importance] ?? 2)
      );
      // Normalize filenames — AI may return with/without leading slash
      const norm = (f: string) => f.replace(/^\/+/, "");
      const fileMap = new Map(displayFiles.map((f) => [norm(f.filename), f]));
      const ordered: GitHubFile[] = [];
      const seen = new Set<string>();

      for (const group of sortedGroups) {
        for (const gf of group.files) {
          const key = norm(gf.filename);
          if (!seen.has(key) && fileMap.has(key)) {
            ordered.push(fileMap.get(key)!);
            seen.add(key);
          }
        }
      }
      // Add any files not in groups
      for (const file of displayFiles) {
        if (!seen.has(norm(file.filename))) {
          ordered.push(file);
        }
      }
      return ordered;
    }

    // Fallback: use file priorities
    if (analysis?.file_priorities) {
      const highPriorityFiles = new Set(
        analysis.file_priorities
          .filter(fp => fp.priority_score >= 6)
          .map(fp => fp.filename)
      );
      const mediumPriorityFiles = new Set(
        analysis.file_priorities
          .filter(fp => fp.priority_score >= 3 && fp.priority_score < 6)
          .map(fp => fp.filename)
      );

      const keyChanges: GitHubFile[] = [];
      const contextFiles: GitHubFile[] = [];
      const otherFiles: GitHubFile[] = [];

      for (const file of displayFiles) {
        if (highPriorityFiles.has(file.filename)) {
          keyChanges.push(file);
        } else if (mediumPriorityFiles.has(file.filename)) {
          contextFiles.push(file);
        } else {
          otherFiles.push(file);
        }
      }

      return [...keyChanges, ...contextFiles, ...otherFiles];
    }

    // Fallback: sort by change size, group tests separately
    const sorted = [...displayFiles].sort(
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

    return [...keyChanges, ...contextFiles, ...otherFiles];
  }, [displayFiles, analysis]);

  // File navigation using sorted order
  const navigateToNextFile = useCallback(() => {
    if (!sortedFiles.length) return;
    const currentIndex = selectedFile ? sortedFiles.findIndex(f => f.filename === selectedFile.filename) : -1;
    const nextIndex = currentIndex < sortedFiles.length - 1 ? currentIndex + 1 : 0;
    setSelectedFile(sortedFiles[nextIndex]);
  }, [sortedFiles, selectedFile]);

  const navigateToPrevFile = useCallback(() => {
    if (!sortedFiles.length) return;
    const currentIndex = selectedFile ? sortedFiles.findIndex(f => f.filename === selectedFile.filename) : sortedFiles.length;
    const prevIndex = currentIndex > 0 ? currentIndex - 1 : sortedFiles.length - 1;
    setSelectedFile(sortedFiles[prevIndex]);
  }, [sortedFiles, selectedFile]);

  const submitReview = useCallback(async (action: ReviewAction) => {
    if (!owner || !repo || !prNumberInt) return;

    setIsSubmittingReview(true);
    setSubmitError(null);

    try {
      // Convert action to GitHub event format
      const event = action === "approve"
        ? "APPROVE"
        : action === "request_changes"
        ? "REQUEST_CHANGES"
        : "COMMENT";

      // Convert pending comments to GitHub format using actual line numbers
      const comments: ReviewComment[] = pendingComments.map((c) => {
        const line = c.newLineNum ?? null;
        const side = line ? ("RIGHT" as const) : null;
        const isMultiLine = c.newLineNumStart != null && line != null && c.newLineNumStart !== line;
        return {
          path: c.file,
          line,
          side,
          start_line: isMultiLine ? c.newLineNumStart : undefined,
          start_side: isMultiLine ? side : undefined,
          body: c.body,
        };
      });

      // Submit the review to GitHub
      await github.submitReview(
        owner,
        repo,
        prNumberInt,
        event,
        reviewBody,
        comments
      );

      // Save the review state (mark current commit as reviewed)
      if (pr?.head.sha) {
        try {
          await review.saveState(
            owner,
            repo,
            prNumberInt,
            pr.head.sha,
            Array.from(viewedFiles)
          );
        } catch (e) {
          logger.error("Failed to save review state:", e);
        }
      }

      // Clear drafts from DB then clear form
      draftComments.clear(owner, repo, prNumberInt).catch((err) =>
        logger.error("Failed to clear draft comments:", err)
      );
      setPendingComments([]);
      setReviewBody("");
      setShowReviewDialog(false);
    } catch (e) {
      logger.error("Failed to submit review:", e);
      const errorMsg = typeof e === "string"
        ? e
        : (e as { message?: string })?.message || "Failed to submit review";
      setSubmitError(errorMsg);
    } finally {
      setIsSubmittingReview(false);
    }
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
        <p className="text-sm text-muted-foreground mt-2">
          Close this tab to return to the dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Header */}
      <div className="border-b px-4 py-3 flex items-center gap-4 flex-shrink-0">
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

        <TabsContent value="summary" className="overflow-y-auto">
          {showFullAnalysis ? (
            <div className="p-6 pb-12">
              <div className="mb-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFullAnalysis(false)}
                  className="gap-1.5"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Summary
                </Button>
              </div>
              <AIAnalyticsPanel
                analysis={analysis}
                isAnalyzing={isAnalyzing}
                error={analysisError}
                onRunAnalysis={runAnalysis}
                linkedRepo={linkedRepo}
                analysisMode={analysisMode}
                onSetAnalysisMode={setAnalysisMode}
                lastAnalysisMode={lastAnalysisMode}
                pr={pr}
                owner={owner}
                repo={repo}
              />
            </div>
          ) : (
            <div className="p-6 pb-12 space-y-6">
              {/* AI Summary Section */}
              <AISummarySection
                analysis={analysis}
                isAnalyzing={isAnalyzing}
                error={analysisError}
                onRunAnalysis={runAnalysis}
                onViewFullAnalysis={() => setShowFullAnalysis(true)}
                linkedRepo={linkedRepo}
                analysisMode={analysisMode}
                onSetAnalysisMode={setAnalysisMode}
                lastAnalysisMode={lastAnalysisMode}
              />

              {/* PR Overview */}
              <OverviewPanel pr={pr} files={files || []} owner={owner!} repo={repo!} prNumber={prNumberInt!} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="changes" className="!flex-col overflow-hidden">
          {/* Review Actions Bar */}
          <div className="border-b px-4 py-2 flex items-center justify-between bg-muted/30 flex-shrink-0">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                {viewedFiles.size} of {displayFiles.length} files viewed
              </span>
              {pendingComments.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <MessageCircle className="h-3.5 w-3.5" />
                    {pendingComments.length} pending comment{pendingComments.length !== 1 ? "s" : ""}
                  </span>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Discard ${pendingComments.length} pending comment${pendingComments.length !== 1 ? "s" : ""} and review body?`)) return;
                      if (owner && repo && prNumberInt) {
                        draftComments.clear(owner, repo, prNumberInt).catch((err) =>
                          logger.error("Failed to clear draft comments:", err)
                        );
                      }
                      setPendingComments([]);
                      setReviewBody("");
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive border border-transparent hover:border-destructive/30 rounded px-1.5 py-0.5 transition-colors"
                    title="Discard all pending comments"
                  >
                    <Trash2 className="h-3 w-3" />
                    Discard
                  </button>
                </div>
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
                disabled={isSubmittingReview}
                className="gap-1.5"
              >
                <MessageSquare className="h-4 w-4" />
                Submit Review
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
                  analysis={analysis}
                  isAnalyzing={isAnalyzing}
                  onRunAnalysis={runAnalysis}
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
                <AIContextPanel file={selectedFile} fileAnalysis={selectedFileAnalysis} />
              )}

              <div className="flex-1 overflow-auto">
                <DiffPanel
                  file={selectedFile}
                  owner={owner!}
                  repo={repo!}
                  baseSha={pr?.base.sha || ""}
                  headSha={pr?.head.sha || ""}
                  onAddComment={addComment}
                  onEditComment={editComment}
                  onDeleteComment={deleteComment}
                  pendingComments={pendingComments}
                  aiAnnotations={selectedFileAnalysis?.annotations || []}
                  onNavigateNextFile={navigateToNextFile}
                  onNavigatePrevFile={navigateToPrevFile}
                />
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Review submission dialog */}
      {showReviewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowReviewDialog(false)}>
          <div className="bg-background border rounded-lg shadow-xl w-[520px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">Submit Review</h3>
              <button onClick={() => setShowReviewDialog(false)} className="p-1 rounded hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-4 py-3 flex-1 overflow-auto">
              {pendingComments.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm text-muted-foreground mb-2">
                    {pendingComments.length} inline comment{pendingComments.length !== 1 ? "s" : ""} will be included
                  </p>
                  <div className="max-h-32 overflow-auto border rounded p-2 space-y-1.5">
                    {pendingComments.map((c, i) => (
                      <div key={i} className="text-xs">
                        <span className="font-mono text-muted-foreground">{c.file.split("/").pop()}</span>
                        {c.newLineNum && <span className="text-muted-foreground">:{c.newLineNum}</span>}
                        <span className="text-muted-foreground"> — </span>
                        <span className="truncate">{c.body.length > 80 ? c.body.slice(0, 80) + "…" : c.body}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="text-sm font-medium">Review summary</label>
              <textarea
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                placeholder="Leave a comment on this pull request…"
                className="w-full mt-1.5 p-2 text-sm bg-background border rounded resize-none focus:ring-2 focus:ring-ring focus:outline-none"
                rows={5}
                autoFocus
              />

              {submitError && (
                <p className="text-xs text-destructive mt-2">{submitError}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  submitReview("comment");
                }}
                disabled={isSubmittingReview || (!reviewBody.trim() && pendingComments.length === 0)}
                className="gap-1.5"
              >
                {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquare className="h-4 w-4" />}
                Comment
              </Button>
              {user?.github_username !== pr?.user.login && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => submitReview("approve")}
                    disabled={isSubmittingReview}
                    className="gap-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                  >
                    {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => submitReview("request_changes")}
                    disabled={isSubmittingReview || !reviewBody.trim()}
                    className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    {isSubmittingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                    Request Changes
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface OverviewPanelProps {
  pr: GitHubPR;
  files: GitHubFile[];
  owner: string;
  repo: string;
  prNumber: number;
}

// Get the latest review state per user (only APPROVED or CHANGES_REQUESTED count)
function getReviewSummary(reviews: GitHubReview[] | undefined) {
  if (!reviews || reviews.length === 0) return { approved: [], changesRequested: [] };

  // Get the latest review per user
  const latestByUser = new Map<string, GitHubReview>();
  for (const review of reviews) {
    if (review.state === "APPROVED" || review.state === "CHANGES_REQUESTED") {
      const existing = latestByUser.get(review.user.login);
      if (!existing || (review.submitted_at && existing.submitted_at && review.submitted_at > existing.submitted_at)) {
        latestByUser.set(review.user.login, review);
      }
    }
  }

  const approved: GitHubReview[] = [];
  const changesRequested: GitHubReview[] = [];

  for (const review of latestByUser.values()) {
    if (review.state === "APPROVED") {
      approved.push(review);
    } else if (review.state === "CHANGES_REQUESTED") {
      changesRequested.push(review);
    }
  }

  return { approved, changesRequested };
}

function OverviewPanel({ pr, files, owner, repo, prNumber }: OverviewPanelProps) {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Fetch reviews for this PR
  const { data: reviews } = useQuery({
    queryKey: ["pr-reviews", owner, repo, prNumber],
    queryFn: () => github.getPRReviews(owner, repo, prNumber),
    staleTime: 1000 * 60 * 2,
  });

  const { approved, changesRequested } = useMemo(() => getReviewSummary(reviews), [reviews]);

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

          {/* Reviews */}
          {(approved.length > 0 || changesRequested.length > 0) && (
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Reviews</div>
                {approved.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Approved</span>
                    </span>
                    <span className="flex -space-x-1">
                      {approved.map((r) => (
                        r.user.avatar_url ? (
                          <img key={r.user.login} src={r.user.avatar_url} alt={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full ring-1 ring-green-200 dark:ring-green-800" />
                        ) : (
                          <span key={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full bg-green-200 dark:bg-green-800 flex items-center justify-center text-[10px] ring-1 ring-green-200 dark:ring-green-800">{r.user.login[0]}</span>
                        )
                      ))}
                    </span>
                  </div>
                )}
                {changesRequested.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 px-1.5 py-0.5 rounded inline-flex items-center gap-1.5">
                      <XCircle className="h-3 w-3" />
                      <span>Changes requested</span>
                    </span>
                    <span className="flex -space-x-1">
                      {changesRequested.map((r) => (
                        r.user.avatar_url ? (
                          <img key={r.user.login} src={r.user.avatar_url} alt={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full ring-1 ring-red-200 dark:ring-red-800" />
                        ) : (
                          <span key={r.user.login} title={r.user.login} className="h-5 w-5 rounded-full bg-red-200 dark:bg-red-800 flex items-center justify-center text-[10px] ring-1 ring-red-200 dark:ring-red-800">{r.user.login[0]}</span>
                        )
                      ))}
                    </span>
                  </div>
                )}
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

const AGENT_STATUS_MESSAGES: Record<AgentType, string[]> = {
  security: [
    "Scanning for vulnerabilities...",
    "Checking authentication patterns...",
    "Analyzing input validation...",
    "Reviewing access controls...",
  ],
  architecture: [
    "Evaluating code structure...",
    "Checking design patterns...",
    "Analyzing module boundaries...",
    "Reviewing dependencies...",
  ],
  style: [
    "Checking naming conventions...",
    "Reviewing code consistency...",
    "Analyzing documentation...",
    "Looking for code smells...",
  ],
  performance: [
    "Analyzing algorithm complexity...",
    "Checking for N+1 queries...",
    "Reviewing async patterns...",
    "Looking for memory issues...",
  ],
};

function AnalysisLoadingState() {
  const [messageIndices, setMessageIndices] = useState<Record<AgentType, number>>({
    security: 0,
    architecture: 0,
    style: 0,
    performance: 0,
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndices((prev) => {
        const agents: AgentType[] = ["security", "architecture", "style", "performance"];
        const randomAgent = agents[Math.floor(Math.random() * agents.length)];
        return {
          ...prev,
          [randomAgent]: (prev[randomAgent] + 1) % AGENT_STATUS_MESSAGES[randomAgent].length,
        };
      });
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const agents: { type: AgentType; label: string; icon: React.ReactNode; color: string }[] = [
    { type: "security", label: "Security", icon: <Shield className="h-4 w-4" />, color: "text-red-500" },
    { type: "architecture", label: "Architecture", icon: <Layers className="h-4 w-4" />, color: "text-blue-500" },
    { type: "style", label: "Style", icon: <Paintbrush className="h-4 w-4" />, color: "text-purple-500" },
    { type: "performance", label: "Performance", icon: <Zap className="h-4 w-4" />, color: "text-amber-500" },
  ];

  return (
    <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
      <div className="p-4 bg-purple-100 dark:bg-purple-950/50 rounded-full mb-6">
        <Sparkles className="h-10 w-10 text-purple-500 animate-pulse" />
      </div>

      <h2 className="text-xl font-semibold mb-2">Analyzing Pull Request</h2>
      <p className="text-muted-foreground mb-6">
        Running 4 specialized agents in parallel
      </p>

      <div className="w-full space-y-3 mb-6">
        {agents.map(({ type, label, icon, color }) => (
          <div
            key={type}
            className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
          >
            <div className={cn("p-2 rounded-lg bg-background", color)}>
              {icon}
            </div>
            <div className="flex-1 text-left">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{label}</span>
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground transition-all duration-300">
                {AGENT_STATUS_MESSAGES[type][messageIndices[type]]}
              </p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">This typically takes 30-60 seconds</p>
    </div>
  );
}

interface AISummarySectionProps {
  analysis: OrchestratedAnalysis | null;
  isAnalyzing: boolean;
  error: string | null;
  onRunAnalysis: () => void;
  onViewFullAnalysis: () => void;
  linkedRepo: LinkedRepo | null | undefined;
  analysisMode: "pr_only" | "with_context";
  onSetAnalysisMode: (mode: "pr_only" | "with_context") => void;
  lastAnalysisMode: "pr_only" | "with_context" | null;
}

function AISummarySection({
  analysis,
  isAnalyzing,
  error,
  onRunAnalysis,
  onViewFullAnalysis,
  linkedRepo,
  analysisMode,
  onSetAnalysisMode,
  lastAnalysisMode,
}: AISummarySectionProps) {
  const hasLinkedRepo = linkedRepo && linkedRepo.profile_data;

  const getRiskColor = (level: string) => {
    switch (level.toLowerCase()) {
      case "high":
        return "text-red-600 bg-red-100 dark:bg-red-950/50";
      case "medium":
        return "text-amber-600 bg-amber-100 dark:bg-amber-950/50";
      default:
        return "text-green-600 bg-green-100 dark:bg-green-950/50";
    }
  };

  // Analyzing state - compact loading indicator
  if (isAnalyzing) {
    return (
      <div className="rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg">
            <Loader2 className="h-5 w-5 text-purple-500 animate-spin" />
          </div>
          <div className="flex-1">
            <h3 className="font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-500" />
              Running AI Analysis
            </h3>
            <p className="text-sm text-muted-foreground">
              4 specialized agents analyzing this PR...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Analysis complete - show summary
  if (analysis) {
    // Debug: Log all findings with their line numbers
    logger.log("[Analysis] All findings with line numbers:");
    analysis.agent_responses.forEach(r => {
      r.findings.forEach(f => {
        logger.log(`  [${r.agent_type}] ${f.file}:${f.line ?? 'NO LINE'} - ${f.message.substring(0, 50)}...`);
      });
    });
    logger.log("[Analysis] file_analyses count:", analysis.file_analyses.length);
    analysis.file_analyses.forEach(fa => {
      logger.log(`  File: ${fa.filename}, annotations: ${fa.annotations.length}, agent_findings: ${fa.agent_findings.length}`);
    });
    const totalFindings = analysis.agent_responses.reduce((sum, r) => sum + r.findings.length, 0);
    const criticalCount = analysis.agent_responses.reduce(
      (sum, r) => sum + r.findings.filter(f => f.severity === "critical" || f.severity === "high").length,
      0
    );

    return (
      <div className="rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex-shrink-0">
              <Sparkles className="h-5 w-5 text-purple-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-medium">AI Analysis</h3>
                <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", getRiskColor(analysis.risk_level))}>
                  {analysis.risk_level.charAt(0).toUpperCase() + analysis.risk_level.slice(1)} Risk
                </span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {analysis.summary}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                {lastAnalysisMode && (
                  <span className="flex items-center gap-1">
                    {lastAnalysisMode === "with_context" ? (
                      <><FolderOpen className="h-3 w-3" /> With Context</>
                    ) : (
                      <><FileCode className="h-3 w-3" /> PR Only</>
                    )}
                  </span>
                )}
                <span>{totalFindings} finding{totalFindings !== 1 ? "s" : ""}</span>
                {criticalCount > 0 && (
                  <span className="text-red-600 dark:text-red-400 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {criticalCount} critical/high
                  </span>
                )}
                <span>~{((analysis.total_token_usage?.total_tokens || 0) / 1000).toFixed(1)}k tokens</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Mode toggle for re-run */}
            <div className="flex border rounded-md overflow-hidden">
              <button
                onClick={() => onSetAnalysisMode("pr_only")}
                className={cn(
                  "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                  analysisMode === "pr_only"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted"
                )}
                title="PR diff only"
              >
                <FileCode className="h-3 w-3" />
                PR
              </button>
              <button
                onClick={() => hasLinkedRepo && onSetAnalysisMode("with_context")}
                disabled={!hasLinkedRepo}
                className={cn(
                  "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                  analysisMode === "with_context"
                    ? "bg-primary text-primary-foreground"
                    : "bg-background hover:bg-muted",
                  !hasLinkedRepo && "opacity-50 cursor-not-allowed"
                )}
                title={hasLinkedRepo ? "Include codebase context" : "Link local repo in Settings"}
              >
                <FolderOpen className="h-3 w-3" />
                Context
              </button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onRunAnalysis}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Re-run
            </Button>
            <Button
              size="sm"
              onClick={onViewFullAnalysis}
              className="gap-1.5"
            >
              View Details
              <ChevronDown className="h-3.5 w-3.5 -rotate-90" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // No analysis yet - show run controls
  return (
    <div className="rounded-lg border bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-purple-100 dark:bg-purple-900/50 rounded-lg flex-shrink-0">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-medium mb-1">AI-Powered Analysis</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Get risk assessment, code quality analysis, and review priorities.
            </p>

            {/* Analysis Mode Toggle */}
            <div className="flex items-center gap-2">
              <div className="flex border rounded-md overflow-hidden">
                <button
                  onClick={() => onSetAnalysisMode("pr_only")}
                  className={cn(
                    "px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5",
                    analysisMode === "pr_only"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted"
                  )}
                >
                  <FileCode className="h-3.5 w-3.5" />
                  PR Only
                </button>
                <button
                  onClick={() => hasLinkedRepo && onSetAnalysisMode("with_context")}
                  disabled={!hasLinkedRepo}
                  className={cn(
                    "px-3 py-1.5 text-xs transition-colors flex items-center gap-1.5",
                    analysisMode === "with_context"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background hover:bg-muted",
                    !hasLinkedRepo && "opacity-50 cursor-not-allowed"
                  )}
                  title={hasLinkedRepo ? "Include codebase context" : "Link local repo in Settings"}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  With Context
                </button>
              </div>
              {!hasLinkedRepo && (
                <Link
                  to="/settings/repositories"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  <Settings className="h-3 w-3" />
                  Link repo
                </Link>
              )}
            </div>
          </div>
        </div>

        <Button onClick={onRunAnalysis} className="gap-2 flex-shrink-0">
          <Sparkles className="h-4 w-4" />
          Run Analysis
        </Button>
      </div>

      {error && (
        <div className="mt-3 p-3 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}

interface AIAnalyticsPanelProps {
  analysis: OrchestratedAnalysis | null;
  isAnalyzing: boolean;
  error: string | null;
  onRunAnalysis: () => void;
  linkedRepo: LinkedRepo | null | undefined;
  analysisMode: "pr_only" | "with_context";
  onSetAnalysisMode: (mode: "pr_only" | "with_context") => void;
  lastAnalysisMode: "pr_only" | "with_context" | null;
  pr: GitHubPR | undefined;
  owner: string | undefined;
  repo: string | undefined;
}

function AIAnalyticsPanel({ analysis, isAnalyzing, error, onRunAnalysis, linkedRepo, analysisMode, onSetAnalysisMode, lastAnalysisMode, pr, owner, repo }: AIAnalyticsPanelProps) {
  const [expandedAgents, setExpandedAgents] = useState<Set<AgentType>>(new Set());

  const toggleAgent = (agentType: AgentType) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentType)) {
        next.delete(agentType);
      } else {
        next.add(agentType);
      }
      return next;
    });
  };

  const getAgentIcon = (type: AgentType) => {
    switch (type) {
      case "security":
        return <Shield className="h-5 w-5" />;
      case "architecture":
        return <Layers className="h-5 w-5" />;
      case "style":
        return <Paintbrush className="h-5 w-5" />;
      case "performance":
        return <Zap className="h-5 w-5" />;
    }
  };

  const getAgentColors = (type: AgentType) => {
    switch (type) {
      case "security":
        return { icon: "text-red-500", bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-800" };
      case "architecture":
        return { icon: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-800" };
      case "style":
        return { icon: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-950/30", border: "border-purple-200 dark:border-purple-800" };
      case "performance":
        return { icon: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-800" };
    }
  };

  const getRiskColor = (level: string) => {
    switch (level.toLowerCase()) {
      case "high":
        return "text-red-600 bg-red-100 dark:bg-red-950/50";
      case "medium":
        return "text-amber-600 bg-amber-100 dark:bg-amber-950/50";
      default:
        return "text-green-600 bg-green-100 dark:bg-green-950/50";
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case "critical":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "high":
        return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
      case "medium":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
      case "low":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  // Sort agent responses by priority (highest severity findings first)
  const sortedAgentResponses = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.agent_responses].sort((a, b) => {
      // Calculate priority score based on findings severity
      const getScore = (response: typeof a) => {
        let score = 0;
        for (const f of response.findings) {
          if (f.severity === "critical") score += 100;
          else if (f.severity === "high") score += 50;
          else if (f.severity === "medium") score += 10;
          else if (f.severity === "low") score += 1;
        }
        // Also factor in risk assessment
        if (response.summary.risk_assessment === "high") score += 30;
        else if (response.summary.risk_assessment === "medium") score += 15;
        return score;
      };
      return getScore(b) - getScore(a);
    });
  }, [analysis]);

  // Show empty state if no analysis
  if (!analysis && !isAnalyzing) {
    const hasLinkedRepo = linkedRepo && linkedRepo.profile_data;

    return (
      <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto">
        <div className="p-4 bg-purple-100 dark:bg-purple-950/50 rounded-full mb-6">
          <Sparkles className="h-12 w-12 text-purple-500" />
        </div>

        <h2 className="text-xl font-semibold mb-2">AI-Powered Analysis</h2>
        <p className="text-muted-foreground mb-4">
          Get intelligent insights about this pull request including risk assessment,
          code quality analysis, and suggested review focus areas.
        </p>

        {/* Analysis Mode Toggle */}
        <div className="w-full p-4 bg-muted/50 rounded-lg mb-6">
          <div className="flex items-center justify-center gap-2 mb-3">
            <span className="text-sm font-medium">Analysis Mode</span>
          </div>
          <div className="flex border rounded-lg overflow-hidden">
            <button
              onClick={() => onSetAnalysisMode("pr_only")}
              className={cn(
                "flex-1 px-4 py-2 text-sm transition-colors flex items-center justify-center gap-2",
                analysisMode === "pr_only"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              )}
            >
              <FileCode className="h-4 w-4" />
              PR Only
            </button>
            <button
              onClick={() => hasLinkedRepo && onSetAnalysisMode("with_context")}
              disabled={!hasLinkedRepo}
              className={cn(
                "flex-1 px-4 py-2 text-sm transition-colors flex items-center justify-center gap-2",
                analysisMode === "with_context"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
                !hasLinkedRepo && "opacity-50 cursor-not-allowed"
              )}
              title={hasLinkedRepo ? "Analyze with local codebase context" : "Link a local repo in Settings to enable"}
            >
              <FolderOpen className="h-4 w-4" />
              With Context
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {analysisMode === "pr_only" ? (
              "Analyze just the changed files in this PR"
            ) : (
              "Include patterns and conventions from your local codebase"
            )}
          </p>
          {!hasLinkedRepo && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <Settings className="h-3.5 w-3.5" />
              <Link to="/settings/repositories" className="hover:underline">
                Link a local repository to enable context mode
              </Link>
            </div>
          )}
          {linkedRepo && !linkedRepo.profile_data && (
            <div className="mt-3 flex items-center justify-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Local repo linked but not analyzed yet. <Link to="/settings/repositories" className="hover:underline">Run analysis in Settings</Link></span>
            </div>
          )}
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-800 mb-6">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <Button onClick={onRunAnalysis} className="gap-2">
          <Sparkles className="h-4 w-4" />
          Run Analysis
        </Button>
      </div>
    );
  }

  // Show loading state
  if (isAnalyzing) {
    return <AnalysisLoadingState />;
  }

  // Show analysis results
  if (!analysis) return null;

  const totalFindings = analysis.agent_responses.reduce((sum, r) => sum + r.findings.length, 0);
  const totalTokens = analysis.total_token_usage?.total_tokens || 0;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header with risk level */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-100 dark:bg-purple-950/50 rounded-lg">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">AI Analysis Complete</h2>
            <p className="text-sm text-muted-foreground">
              {totalFindings} finding{totalFindings !== 1 ? "s" : ""} · {(analysis.total_processing_time_ms / 1000).toFixed(1)}s · ~{(totalTokens / 1000).toFixed(1)}k tokens
              {lastAnalysisMode && (
                <> · {lastAnalysisMode === "with_context" ? "With Context" : "PR Only"}</>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("px-3 py-1 rounded-full text-sm font-medium", getRiskColor(analysis.risk_level))}>
            {analysis.risk_level.charAt(0).toUpperCase() + analysis.risk_level.slice(1)} Risk
          </span>
          {/* Mode toggle for re-run */}
          <div className="flex border rounded-md overflow-hidden">
            <button
              onClick={() => onSetAnalysisMode("pr_only")}
              className={cn(
                "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                analysisMode === "pr_only"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted"
              )}
              title="PR diff only"
            >
              <FileCode className="h-3 w-3" />
              PR
            </button>
            <button
              onClick={() => linkedRepo?.profile_data && onSetAnalysisMode("with_context")}
              disabled={!linkedRepo?.profile_data}
              className={cn(
                "px-2 py-1 text-xs transition-colors flex items-center gap-1",
                analysisMode === "with_context"
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
                !linkedRepo?.profile_data && "opacity-50 cursor-not-allowed"
              )}
              title={linkedRepo?.profile_data ? "Include codebase context" : "Link local repo in Settings"}
            >
              <FolderOpen className="h-3 w-3" />
              Context
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={onRunAnalysis} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            Re-analyze
          </Button>
          {pr && owner && repo && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Download className="h-3.5 w-3.5" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    const markdown = formatAnalysisAsMarkdown(
                      analysis,
                      pr,
                      owner,
                      repo,
                      lastAnalysisMode || undefined
                    );
                    try {
                      await downloadMarkdown(markdown, `${repo}-pr-${pr.number}-analysis.md`);
                    } catch (err) {
                      logger.error("Failed to save markdown:", err);
                    }
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Download Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={async () => {
                    const markdown = formatAnalysisAsMarkdown(
                      analysis,
                      pr,
                      owner,
                      repo,
                      lastAnalysisMode || undefined
                    );
                    try {
                      await downloadAsHTML(
                        markdown,
                        `PR Analysis - ${repo} #${pr.number}`,
                        `${repo}-pr-${pr.number}-analysis.html`
                      );
                    } catch (err) {
                      logger.error("Failed to save HTML:", err);
                    }
                  }}
                >
                  <FileCode className="h-4 w-4 mr-2" />
                  Download HTML
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Failed agents warning */}
      {analysis.failed_agents.length > 0 && (
        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">
              {analysis.failed_agents.length} agent(s) failed
            </span>
          </div>
          <ul className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            {analysis.failed_agents.map((fa) => (
              <li key={fa.agent_type}>• {fa.agent_type}: {fa.error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Agent Results - Stacked and sorted by severity */}
      <div className="space-y-3">
        {sortedAgentResponses.map((response) => {
          const colors = getAgentColors(response.agent_type);
          const isExpanded = expandedAgents.has(response.agent_type);
          const hasFindings = response.findings.length > 0;

          // Count findings by severity
          const severityCounts = response.findings.reduce((acc, f) => {
            acc[f.severity] = (acc[f.severity] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          return (
            <div
              key={response.agent_type}
              className={cn("rounded-lg border", colors.border, colors.bg)}
            >
              {/* Agent Header - Always visible */}
              <button
                onClick={() => hasFindings && toggleAgent(response.agent_type)}
                className={cn(
                  "w-full p-4 flex items-start gap-3 text-left",
                  hasFindings && "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                )}
                disabled={!hasFindings}
              >
                <div className={cn("p-2 rounded-lg bg-white dark:bg-black/20", colors.icon)}>
                  {getAgentIcon(response.agent_type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold capitalize">{response.agent_type}</span>
                    <span className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      getRiskColor(response.summary.risk_assessment)
                    )}>
                      {response.summary.risk_assessment}
                    </span>
                    {hasFindings && (
                      <span className="text-xs text-muted-foreground">
                        {response.findings.length} finding{response.findings.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {response.token_usage && (
                      <span className="text-xs text-muted-foreground ml-auto">
                        ~{(response.token_usage.total_tokens / 1000).toFixed(1)}k tokens
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {response.summary.overview}
                  </p>
                  {/* Severity badges */}
                  {hasFindings && Object.keys(severityCounts).length > 0 && (
                    <div className="flex gap-1.5 mt-2">
                      {["critical", "high", "medium", "low", "info"].map(sev =>
                        severityCounts[sev] ? (
                          <span key={sev} className={cn("text-xs px-1.5 py-0.5 rounded", getSeverityColor(sev))}>
                            {severityCounts[sev]} {sev}
                          </span>
                        ) : null
                      )}
                    </div>
                  )}
                </div>
                {hasFindings && (
                  <ChevronDown className={cn(
                    "h-5 w-5 text-muted-foreground transition-transform flex-shrink-0",
                    isExpanded && "rotate-180"
                  )} />
                )}
              </button>

              {/* Expanded Findings */}
              {isExpanded && hasFindings && (
                <div className="border-t border-inherit">
                  <div className="p-4 space-y-3">
                    {response.findings.map((finding, idx) => (
                      <div key={idx} className="flex items-start gap-3 p-3 bg-white dark:bg-black/20 rounded-lg">
                        <span className={cn(
                          "text-xs px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5",
                          getSeverityColor(finding.severity)
                        )}>
                          {finding.severity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <span className="font-mono truncate">{finding.file}</span>
                            {finding.line && <span>Line {finding.line}</span>}
                            <span className="px-1.5 py-0.5 bg-muted rounded">{finding.category}</span>
                          </div>
                          <p className="text-sm">{finding.message}</p>
                          {finding.suggestion && (
                            <p className="text-sm text-muted-foreground mt-1 italic">
                              Suggestion: {finding.suggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Suggested Review Order */}
      {analysis.suggested_review_order.length > 0 && (
        <div className="p-4 bg-muted/50 rounded-lg">
          <h3 className="font-medium mb-3 flex items-center gap-2">
            <Files className="h-4 w-4 text-muted-foreground" />
            Suggested Review Order
          </h3>
          <ol className="space-y-1 text-sm">
            {analysis.suggested_review_order.slice(0, 5).map((file, i) => (
              <li key={file} className="flex items-center gap-2 text-muted-foreground">
                <span className="w-5 h-5 bg-background rounded-full flex items-center justify-center text-xs font-medium">
                  {i + 1}
                </span>
                <span className="truncate font-mono text-xs">{file}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

interface PrioritizedFileListProps {
  files: GitHubFile[];
  selectedFile: GitHubFile | null;
  onSelectFile: (file: GitHubFile) => void;
  viewedFiles: Set<string>;
  onToggleViewed: (filename: string) => void;
  analysis: OrchestratedAnalysis | null;
  isAnalyzing: boolean;
  onRunAnalysis: () => void;
}

function PrioritizedFileList({
  files,
  selectedFile,
  onSelectFile,
  viewedFiles,
  onToggleViewed,
  analysis,
  isAnalyzing,
  onRunAnalysis,
}: PrioritizedFileListProps) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  // Check if we have file groups from AI
  const hasFileGroups = !!(analysis?.file_groups && analysis.file_groups.length > 0);

  // Sort file groups by importance
  const sortedFileGroups = useMemo(() => {
    if (!hasFileGroups) return [];
    const importanceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return [...analysis!.file_groups!].sort(
      (a, b) => (importanceOrder[a.importance] ?? 2) - (importanceOrder[b.importance] ?? 2)
    );
  }, [analysis, hasFileGroups]);

  // Fallback: Use AI analysis priorities or file characteristics for 3-bucket approach
  const { keyChanges, contextFiles, otherFiles } = useMemo(() => {
    if (hasFileGroups) return { keyChanges: [], contextFiles: [], otherFiles: [] };

    if (analysis?.file_priorities) {
      const highPriorityFiles = new Set(
        analysis.file_priorities
          .filter(fp => fp.priority_score >= 6)
          .map(fp => fp.filename)
      );
      const mediumPriorityFiles = new Set(
        analysis.file_priorities
          .filter(fp => fp.priority_score >= 3 && fp.priority_score < 6)
          .map(fp => fp.filename)
      );

      const keyChanges: GitHubFile[] = [];
      const contextFiles: GitHubFile[] = [];
      const otherFiles: GitHubFile[] = [];

      for (const file of files) {
        if (highPriorityFiles.has(file.filename)) {
          keyChanges.push(file);
        } else if (mediumPriorityFiles.has(file.filename)) {
          contextFiles.push(file);
        } else {
          otherFiles.push(file);
        }
      }

      return { keyChanges, contextFiles, otherFiles };
    }

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
  }, [files, analysis, hasFileGroups]);

  if (files.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">No files changed</div>
    );
  }

  const renderFileItem = (file: GitHubFile, deprioritized = false) => {
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
          isViewed && "opacity-60",
          deprioritized && !isViewed && "opacity-70"
        )}
      >
        <button
          onClick={() => onSelectFile(file)}
          className={cn(
            "flex-1 text-left px-3 text-sm flex flex-col gap-0.5 min-w-0",
            deprioritized ? "py-1" : "py-2"
          )}
        >
          <span className="flex items-center justify-between gap-2">
            <span className={cn(
              "truncate flex items-center gap-1.5",
              !isViewed && !deprioritized && "font-medium",
              deprioritized && "text-xs text-muted-foreground"
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
    const isExpanded = !collapsedSections.has(id);

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
              files.map((f) => renderFileItem(f))
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
        {isAnalyzing ? (
          <div className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Running AI analysis...</span>
          </div>
        ) : analysis ? (
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
              <Sparkles className="h-4 w-4" />
              <span>AI prioritization active</span>
            </div>
            <button
              onClick={onRunAnalysis}
              className="text-xs text-purple-500 hover:underline"
            >
              Re-analyze
            </button>
          </div>
        ) : (
          <button
            onClick={onRunAnalysis}
            className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300 hover:text-purple-800 dark:hover:text-purple-200"
          >
            <Sparkles className="h-4 w-4" />
            <span>Run AI prioritization</span>
          </button>
        )}
      </div>

      {hasFileGroups ? (
        <>
          {sortedFileGroups.map((group) => {
            const groupId = `group-${group.name.toLowerCase().replace(/\s+/g, "-")}`;
            const isExpanded = !collapsedSections.has(groupId);
            const importanceBadge = group.importance === "high"
              ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
              : group.importance === "medium"
              ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";

            // Normalize filenames for lookup — AI may return with/without leading slash
            const normalizeFilename = (f: string) => f.replace(/^\/+/, "");
            const fileMap = new Map(files.map((f) => [normalizeFilename(f.filename), f]));

            // Count how many files actually resolve
            const resolvedCount = group.files.filter((gf) => fileMap.has(normalizeFilename(gf.filename))).length;

            // Skip empty groups (AI filenames didn't match)
            if (resolvedCount === 0) return null;

            return (
              <div key={groupId} className="border-b last:border-b-0">
                <button
                  onClick={() => toggleSection(groupId)}
                  className="w-full px-3 py-2.5 flex items-center gap-2 hover:bg-muted/50 transition-colors"
                >
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform",
                      !isExpanded && "-rotate-90"
                    )}
                  />
                  <span className="font-medium text-sm truncate">{group.name}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", importanceBadge)}>
                    {group.importance}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {resolvedCount}
                  </span>
                </button>

                {isExpanded && (
                  <div className="pb-2">
                    <p className="px-3 pb-2 text-xs text-muted-foreground">
                      {group.description}
                    </p>
                    {group.files.map((gf) => {
                      const file = fileMap.get(normalizeFilename(gf.filename));
                      if (!file) return null;
                      return renderFileItem(file, gf.deprioritized);
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {/* Files not in any group */}
          {(() => {
            const norm = (f: string) => f.replace(/^\/+/, "");
            const groupedFilenames = new Set(
              sortedFileGroups.flatMap((g) => g.files.map((f) => norm(f.filename)))
            );
            const ungrouped = files.filter((f) => !groupedFilenames.has(norm(f.filename)));
            if (ungrouped.length === 0) return null;
            return renderSection(
              "ungrouped",
              "Other Changes",
              <Files className="h-4 w-4 text-muted-foreground" />,
              ungrouped,
              "No other files"
            );
          })()}
        </>
      ) : (
        <>
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
        </>
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
  fileAnalysis: FileAnalysis | null;
}

function AIContextPanel({ file, fileAnalysis }: AIContextPanelProps) {
  // Use AI analysis if available, otherwise generate placeholder context
  const context = useMemo(() => {
    // If we have AI analysis, use it
    if (fileAnalysis && fileAnalysis.agent_findings.length > 0) {
      const topFinding = fileAnalysis.agent_findings[0];
      const findingCount = fileAnalysis.agent_findings.length;
      const severityCounts = fileAnalysis.agent_findings.reduce((acc, f) => {
        acc[f.severity] = (acc[f.severity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      let importance = "";
      if (severityCounts.critical || severityCounts.high) {
        importance = "Needs careful review";
      } else if (severityCounts.medium) {
        importance = "Review recommended";
      } else {
        importance = "Minor notes";
      }

      return {
        importance,
        description: `${findingCount} finding(s): ${topFinding.message}${findingCount > 1 ? ` (+${findingCount - 1} more)` : ""}`,
        isFromAI: true,
      };
    }

    // Fallback: Generate placeholder context based on file characteristics
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

    return { importance, description, isFromAI: false };
  }, [file, fileAnalysis]);

  return (
    <div className="px-4 py-2.5 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/30 dark:to-blue-950/30 border-b flex-shrink-0">
      <div className="flex items-start gap-3">
        <Sparkles className="h-4 w-4 text-purple-500 mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
              {context.importance}
            </span>
            <span className="text-xs text-muted-foreground">
              • {context.isFromAI ? "AI Analysis" : "Auto-detected"}
            </span>
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
  severity?: string;
  category?: string;
  sources?: AgentType[];
  suggestion?: string | null;
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

interface ExpandedSection {
  rowIndex: number;
  lines: string[];
  loading: boolean;
  error: string | null;
}

interface DiffPanelProps {
  file: GitHubFile | null;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  onAddComment?: (file: string, lineStart: number, lineEnd: number, body: string, newLineNum?: number, newLineNumStart?: number) => void;
  onEditComment?: (index: number, newBody: string) => void;
  onDeleteComment?: (index: number) => void;
  pendingComments?: PendingComment[];
  aiAnnotations?: LineAnnotation[];
  onNavigateNextFile?: () => void;
  onNavigatePrevFile?: () => void;
}

function DiffPanel({ file, owner, repo, baseSha, headSha: _headSha, onAddComment, onEditComment, onDeleteComment, pendingComments = [], aiAnnotations = [], onNavigateNextFile, onNavigatePrevFile }: DiffPanelProps) {
  // Note: _headSha is available for future use (e.g., verifying context lines match)
  const [commentingLines, setCommentingLines] = useState<LineSelection | null>(null);
  const [commentText, setCommentText] = useState("");
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [currentHover, setCurrentHover] = useState<number | null>(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState<number | null>(null);
  const [expandedSections, setExpandedSections] = useState<Map<number, ExpandedSection>>(new Map());
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);
  const [editingCommentText, setEditingCommentText] = useState("");

  // Navigation state
  const [currentNavigationIndex, setCurrentNavigationIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  // File content cache for expand
  const [fileContentCache, setFileContentCache] = useState<{ base: string | null; head: string | null }>({ base: null, head: null });

  const diffRows = useMemo(() => {
    if (!file?.patch) return [];
    return parseDiff(file.patch);
  }, [file?.patch]);

  // Build a mapping from file line numbers to row indices
  const lineNumToRowIndex = useMemo(() => {
    const map = new Map<number, number>();
    diffRows.forEach((row) => {
      // Map by new line number (right side) since that's what annotations reference
      if (row.right?.newLineNum) {
        map.set(row.right.newLineNum, row.index);
      }
      // Also map old line numbers for context/removed lines
      if (row.left?.oldLineNum) {
        // Don't overwrite if already mapped
        if (!map.has(row.left.oldLineNum)) {
          map.set(row.left.oldLineNum, row.index);
        }
      }
    });
    return map;
  }, [diffRows]);

  // Helper to find closest row for a line number not in the diff
  const findClosestRow = useCallback((lineNum: number): number | null => {
    // First try exact match
    const exact = lineNumToRowIndex.get(lineNum);
    if (exact !== undefined) return exact;

    // Find the closest row that's visible in the diff
    let closestRow: number | null = null;
    let closestDist = Infinity;

    for (const row of diffRows) {
      const rightLine = row.right?.newLineNum;
      const leftLine = row.left?.oldLineNum;

      if (rightLine !== undefined) {
        const dist = Math.abs(rightLine - lineNum);
        if (dist < closestDist) {
          closestDist = dist;
          closestRow = row.index;
        }
      }
      if (leftLine !== undefined) {
        const dist = Math.abs(leftLine - lineNum);
        if (dist < closestDist) {
          closestDist = dist;
          closestRow = row.index;
        }
      }
    }

    // Only return if within 5 lines of a visible row
    return closestDist <= 5 ? closestRow : null;
  }, [diffRows, lineNumToRowIndex]);

  // Use AI annotations from analysis if available, otherwise fall back to generated ones
  const effectiveAnnotations: AIAnnotation[] = useMemo(() => {
    if (aiAnnotations.length > 0) {
      // Debug logging
      logger.log("[DiffPanel] aiAnnotations received:", aiAnnotations);
      logger.log("[DiffPanel] lineNumToRowIndex size:", lineNumToRowIndex.size);
      logger.log("[DiffPanel] lineNumToRowIndex entries (first 20):",
        Array.from(lineNumToRowIndex.entries()).slice(0, 20));

      // Convert LineAnnotation to AIAnnotation format for display
      // Map line_number to the actual row index in the diff
      const mapped = aiAnnotations.map(a => {
        // If row_index is provided, use it directly; otherwise map from line_number
        let rowIndex = a.row_index;
        if (rowIndex === null || rowIndex === undefined) {
          const fromMap = lineNumToRowIndex.get(a.line_number);
          const fromClosest = findClosestRow(a.line_number);
          rowIndex = fromMap ?? fromClosest ?? -1;
          logger.log(`[DiffPanel] Mapping annotation line ${a.line_number}: fromMap=${fromMap}, fromClosest=${fromClosest}, final=${rowIndex}`);
        }
        return {
          lineIndex: rowIndex,
          type: a.annotation_type as "warning" | "info" | "suggestion",
          message: a.message,
          severity: a.severity,
          category: a.category,
          sources: a.sources,
          suggestion: a.suggestion,
        };
      });
      const filtered = mapped.filter(a => a.lineIndex >= 0);
      logger.log("[DiffPanel] effectiveAnnotations after filter:", filtered);
      return filtered;
    }
    if (!file) return [];
    return generateAIAnnotations(file, diffRows);
  }, [file, diffRows, aiAnnotations, lineNumToRowIndex, findClosestRow]);

  const annotationsByLine = useMemo(() => {
    const map = new Map<number, AIAnnotation[]>();
    effectiveAnnotations.forEach((a) => {
      const existing = map.get(a.lineIndex) || [];
      existing.push(a);
      map.set(a.lineIndex, existing);
    });
    return map;
  }, [effectiveAnnotations]);

  // Navigation: Compute indices of AI findings
  const findingIndices = useMemo(() => {
    return effectiveAnnotations
      .map(a => a.lineIndex)
      .filter((v, i, arr) => arr.indexOf(v) === i) // unique
      .sort((a, b) => a - b);
  }, [effectiveAnnotations]);

  // Navigation: Compute indices of changes (add/remove lines)
  const changeIndices = useMemo(() => {
    return diffRows
      .filter(row => row.left?.type === "add" || row.left?.type === "remove" ||
                     row.right?.type === "add" || row.right?.type === "remove")
      .map(row => row.index);
  }, [diffRows]);

  // Scroll to a specific row
  const scrollToRow = useCallback((rowIndex: number) => {
    const element = containerRef.current?.querySelector(`[data-row-index="${rowIndex}"]`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  // Navigation functions
  const navigateToNextFinding = useCallback(() => {
    if (findingIndices.length === 0) return;
    const current = currentNavigationIndex ?? -1;
    const nextIndex = findingIndices.find(i => i > current) ?? findingIndices[0];
    setCurrentNavigationIndex(nextIndex);
    scrollToRow(nextIndex);
  }, [findingIndices, currentNavigationIndex, scrollToRow]);

  const navigateToPrevFinding = useCallback(() => {
    if (findingIndices.length === 0) return;
    const current = currentNavigationIndex ?? diffRows.length;
    const prevIndex = [...findingIndices].reverse().find(i => i < current) ?? findingIndices[findingIndices.length - 1];
    setCurrentNavigationIndex(prevIndex);
    scrollToRow(prevIndex);
  }, [findingIndices, currentNavigationIndex, scrollToRow, diffRows.length]);

  const navigateToNextChange = useCallback(() => {
    if (changeIndices.length === 0) return;
    const current = currentNavigationIndex ?? -1;
    const nextIndex = changeIndices.find(i => i > current) ?? changeIndices[0];
    setCurrentNavigationIndex(nextIndex);
    scrollToRow(nextIndex);
  }, [changeIndices, currentNavigationIndex, scrollToRow]);

  const navigateToPrevChange = useCallback(() => {
    if (changeIndices.length === 0) return;
    const current = currentNavigationIndex ?? diffRows.length;
    const prevIndex = [...changeIndices].reverse().find(i => i < current) ?? changeIndices[changeIndices.length - 1];
    setCurrentNavigationIndex(prevIndex);
    scrollToRow(prevIndex);
  }, [changeIndices, currentNavigationIndex, scrollToRow, diffRows.length]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case "]":
          e.preventDefault();
          navigateToNextFinding();
          break;
        case "[":
          e.preventDefault();
          navigateToPrevFinding();
          break;
        case "n":
          e.preventDefault();
          onNavigateNextFile?.();
          break;
        case "p":
          e.preventDefault();
          onNavigatePrevFile?.();
          break;
        case "j":
          e.preventDefault();
          navigateToNextChange();
          break;
        case "k":
          e.preventDefault();
          navigateToPrevChange();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateToNextFinding, navigateToPrevFinding, navigateToNextChange, navigateToPrevChange, onNavigateNextFile, onNavigatePrevFile]);

  // Reset navigation when file changes
  useEffect(() => {
    setCurrentNavigationIndex(null);
    setExpandedSections(new Map());
    setFileContentCache({ base: null, head: null });
  }, [file?.filename]);

  // Get comments for this file with their original indices
  const fileComments = useMemo(() => {
    return pendingComments
      .map((c, index) => ({ ...c, originalIndex: index }))
      .filter((c) => c.file === file?.filename);
  }, [pendingComments, file?.filename]);

  // Get the selected code content for suggested changes
  const selectedCodeForSuggestion = useMemo(() => {
    if (!commentingLines || !diffRows.length) return undefined;
    const lines: string[] = [];
    for (let i = commentingLines.startIndex; i <= commentingLines.endIndex; i++) {
      const row = diffRows[i];
      if (row?.right?.content) {
        // Remove the leading + or - or space from the diff
        const content = row.right.content;
        const cleanContent = content.startsWith("+") || content.startsWith("-") || content.startsWith(" ")
          ? content.substring(1)
          : content;
        lines.push(cleanContent);
      }
    }
    return lines.length > 0 ? lines.join("\n") : undefined;
  }, [commentingLines, diffRows]);

  // Must define all hooks before any early returns to satisfy React's Rules of Hooks
  const handleExpandSection = useCallback(async (rowIndex: number, expandRange?: DiffLine["expandRange"]) => {
    if (!file || !expandRange) return;

    // Mark as loading
    setExpandedSections(prev => {
      const next = new Map(prev);
      next.set(rowIndex, { rowIndex, lines: [], loading: true, error: null });
      return next;
    });

    try {
      // Use cached content or fetch new
      let baseLines: string[];
      if (fileContentCache.base) {
        baseLines = fileContentCache.base.split("\n");
      } else {
        const baseContent = await github.getFileContent(owner, repo, file.filename, baseSha);
        setFileContentCache(prev => ({ ...prev, base: baseContent }));
        baseLines = baseContent.split("\n");
      }

      // Extract the lines we need (expandRange has oldStart, oldEnd which are 1-indexed)
      const expandedLines = baseLines.slice(expandRange.oldStart - 1, expandRange.oldEnd);

      setExpandedSections(prev => {
        const next = new Map(prev);
        next.set(rowIndex, {
          rowIndex,
          lines: expandedLines,
          loading: false,
          error: null
        });
        return next;
      });
    } catch (e) {
      const errorMsg = typeof e === "string" ? e : (e as { message?: string })?.message || "Failed to load content";
      setExpandedSections(prev => {
        const next = new Map(prev);
        next.set(rowIndex, { rowIndex, lines: [], loading: false, error: errorMsg });
        return next;
      });
    }
  }, [file, owner, repo, baseSha, fileContentCache.base]);

  // Early returns after all hooks
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
      // Look up actual line numbers for the GitHub API
      const startRow = diffRows[commentingLines.startIndex];
      const endRow = diffRows[commentingLines.endIndex];
      // Use new line number (right side) if available, fall back to old line number (left side)
      const newLineNum = endRow?.right?.newLineNum ?? endRow?.left?.oldLineNum;
      const newLineNumStart = startRow?.right?.newLineNum ?? startRow?.left?.oldLineNum;
      onAddComment(file.filename, commentingLines.startIndex, commentingLines.endIndex, commentText.trim(), newLineNum, newLineNumStart);
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
      return <div className="w-6 flex-shrink-0" />;
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
              <div className="absolute left-6 top-0 z-50 w-72 p-2 bg-popover border rounded-md shadow-lg text-xs font-sans">
                {annotations.map((a, i) => (
                  <div key={i} className={cn("flex flex-col gap-1", i > 0 && "mt-2 pt-2 border-t")}>
                    <div className="flex items-start gap-2">
                      {a.type === "warning" ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                      ) : a.type === "suggestion" ? (
                        <Sparkles className="h-3.5 w-3.5 text-purple-500 flex-shrink-0 mt-0.5" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
                      )}
                      <span className="text-foreground">{a.message}</span>
                    </div>
                    {a.sources && a.sources.length > 0 && (
                      <div className="flex gap-1 pl-5 mt-1">
                        {a.sources.map((source) => (
                          <span key={source} className="text-[10px] px-1.5 py-0.5 bg-muted rounded capitalize">
                            {source}
                          </span>
                        ))}
                      </div>
                    )}
                    {a.suggestion && (
                      <div className="pl-5 mt-1 text-muted-foreground italic">
                        Suggestion: {a.suggestion}
                      </div>
                    )}
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
          onClick={() => handleExpandSection(rowIndex, line.expandRange)}
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
    <div ref={containerRef} className="font-mono text-sm h-full flex flex-col" onMouseLeave={() => isDragging && handleMouseUp()}>
      {/* Sticky header with navigation toolbar */}
      <div className="flex border-b bg-muted/50 text-xs text-muted-foreground sticky top-0 z-10 flex-shrink-0">
        <div className="w-6" /> {/* Gutter spacer */}
        <div className="flex-1 px-4 py-1.5 border-r">Original</div>
        <div className="w-6" /> {/* Gutter spacer */}
        <div className="flex-1 px-4 py-1.5 flex items-center justify-between">
          <span>Modified</span>
          {/* Navigation toolbar */}
          <div className="flex items-center gap-2 font-sans">
            {/* AI Findings navigation */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={navigateToPrevFinding}
                disabled={findingIndices.length === 0}
                title="Previous AI finding ([)"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={navigateToNextFinding}
                disabled={findingIndices.length === 0}
                title="Next AI finding (])"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded ml-0.5" title="AI findings">
                <Sparkles className="h-2.5 w-2.5 inline mr-0.5" />
                {findingIndices.length}
              </span>
            </div>

            <div className="w-px h-3 bg-border" />

            {/* Changes navigation */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={navigateToPrevChange}
                disabled={changeIndices.length === 0}
                title="Previous change (k)"
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={navigateToNextChange}
                disabled={changeIndices.length === 0}
                title="Next change (j)"
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded ml-0.5" title="Changed lines">
                {changeIndices.length}
              </span>
            </div>

            <div className="w-px h-3 bg-border" />

            {/* File navigation */}
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onNavigatePrevFile}
                disabled={!onNavigatePrevFile}
                title="Previous file (p)"
              >
                <ArrowLeft className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onNavigateNextFile}
                disabled={!onNavigateNextFile}
                title="Next file (n)"
              >
                <ArrowLeft className="h-3 w-3 rotate-180" />
              </Button>
              <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded ml-0.5" title="Files">
                <Files className="h-2.5 w-2.5 inline" />
              </span>
            </div>
          </div>
        </div>
      </div>
      {/* Scrollable diff content */}
      <div className="flex-1 overflow-auto">
        {diffRows.map((row) => {
          // Get comments that start on this line
          const lineComments = fileComments.filter((c) => c.line === row.index);
          const isCommentingThisLine =
            commentingLines && row.index === commentingLines.endIndex;
          const isExpandable = row.left?.type === "expandable";

          if (isExpandable) {
            const expanded = expandedSections.get(row.index);

            if (expanded?.loading) {
              return (
                <div key={row.index} data-row-index={row.index} className="border-b border-border/50 bg-muted/30 p-2 text-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Loading expanded content...
                </div>
              );
            }

            if (expanded?.error) {
              return (
                <div key={row.index} data-row-index={row.index} className="border-b border-border/50 bg-red-50 dark:bg-red-950/30 p-2 text-center text-xs text-red-600 dark:text-red-400">
                  Failed to load: {expanded.error}
                  <button
                    onClick={() => handleExpandSection(row.index, row.left?.expandRange)}
                    className="ml-2 underline hover:no-underline"
                  >
                    Retry
                  </button>
                </div>
              );
            }

            if (expanded?.lines && expanded.lines.length > 0) {
              // Render the expanded context lines
              const expandRange = row.left?.expandRange;
              return (
                <div key={row.index} data-row-index={row.index}>
                  {expanded.lines.map((lineContent, i) => {
                    const lineNum = (expandRange?.oldStart ?? 1) + i;
                    return (
                      <div key={`expanded-${row.index}-${i}`} className="flex border-b border-border/50 bg-yellow-50/50 dark:bg-yellow-950/20">
                        <div className="w-6 flex-shrink-0" />
                        <div className="flex-1 border-r border-border/50 min-w-0 flex">
                          <span className="w-10 px-2 text-right text-muted-foreground select-none text-xs flex items-center justify-end bg-yellow-100/50 dark:bg-yellow-900/30">
                            {lineNum}
                          </span>
                          <pre className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">{lineContent || " "}</pre>
                        </div>
                        <div className="w-6 flex-shrink-0" />
                        <div className="flex-1 min-w-0 flex">
                          <span className="w-10 px-2 text-right text-muted-foreground select-none text-xs flex items-center justify-end bg-yellow-100/50 dark:bg-yellow-900/30">
                            {lineNum}
                          </span>
                          <pre className="flex-1 px-2 py-0.5 whitespace-pre-wrap break-all">{lineContent || " "}</pre>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            }

            // Not yet expanded - show expand button
            return (
              <div key={row.index} data-row-index={row.index} className="border-b border-border/50">
                <button
                  onClick={() => handleExpandSection(row.index, row.left?.expandRange)}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-muted/30 hover:bg-muted/50 text-muted-foreground text-xs transition-colors cursor-pointer"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  <span>{row.left?.content || "Expand hidden lines"}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          return (
            <div key={row.index} data-row-index={row.index}>
              <div className={cn(
                "flex border-b border-border/50 group/row",
                currentNavigationIndex === row.index && "ring-2 ring-inset ring-primary/50"
              )}>
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
                  <div className="border rounded overflow-hidden">
                    <CommentToolbar
                      textareaRef={commentTextareaRef}
                      value={commentText}
                      onChange={setCommentText}
                      selectedCode={selectedCodeForSuggestion}
                    />
                    <textarea
                      ref={commentTextareaRef}
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Write a comment... Use the toolbar above for formatting or type markdown directly."
                      className="w-full p-2 text-sm bg-background resize-none font-sans border-0 focus:ring-0 focus:outline-none"
                      rows={4}
                      autoFocus
                    />
                  </div>
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
                        <div className="border rounded overflow-hidden">
                          <CommentToolbar
                            textareaRef={editTextareaRef}
                            value={editingCommentText}
                            onChange={setEditingCommentText}
                          />
                          <textarea
                            ref={editTextareaRef}
                            value={editingCommentText}
                            onChange={(e) => setEditingCommentText(e.target.value)}
                            className="w-full p-2 text-sm bg-background resize-none font-sans border-0 focus:ring-0 focus:outline-none"
                            rows={4}
                            autoFocus
                          />
                        </div>
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
