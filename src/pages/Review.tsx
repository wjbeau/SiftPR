import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FileCode, Loader2, ClipboardList, MessageCircle, MessageSquare, Eye, Check, Filter, History, Trash2 } from "lucide-react";
import { github, GitHubFile, codebase, draftComments, review } from "@/lib/api";
import { useAnalysis, makeAnalysisKey, type AnalysisMode } from "@/contexts/AnalysisContext";
import { logger } from "@/lib/logger";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/types/review";
import { useDraftComments } from "@/lib/hooks/useDraftComments";
import { useSubmitReview } from "@/lib/hooks/useSubmitReview";
import { OverviewPanel } from "@/components/review/OverviewPanel";
import { AISummarySection } from "@/components/review/AISummarySection";
import { AIAnalyticsPanel } from "@/components/review/AIAnalyticsPanel";
import { PrioritizedFileList } from "@/components/review/PrioritizedFileList";
import { AIContextPanel } from "@/components/review/AIContextPanel";
import { DiffPanel } from "@/components/review/DiffPanel";
import { SubmitReviewDialog } from "@/components/review/SubmitReviewDialog";

export function Review() {
  const { owner, repo, prNumber } = useParams<{
    owner: string;
    repo: string;
    prNumber: string;
  }>();
  const { user } = useAuth();

  const [selectedFile, setSelectedFile] = useState<GitHubFile | null>(null);
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const repoFullName = `${owner}/${repo}`;
  const prNumberInt = prNumber ? parseInt(prNumber, 10) : 0;

  // Analysis context
  const analysisCtx = useAnalysis();
  const analysisKey = owner && repo && prNumber ? makeAnalysisKey(owner, repo, prNumber) : "";
  const { isAnalyzing, analysis, analysisError, analysisMode, lastAnalysisMode } = analysisCtx.getEntry(analysisKey);
  const setAnalysisMode = useCallback((mode: AnalysisMode) => analysisCtx.setAnalysisMode(analysisKey, mode), [analysisCtx, analysisKey]);

  // Draft comments
  const { pendingComments, setPendingComments, addComment, editComment, deleteComment } = useDraftComments(owner, repo, prNumberInt);

  // Queries
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

  const { data: reviewState } = useQuery({
    queryKey: ["review-state", owner, repo, prNumber],
    queryFn: () => review.getState(owner!, repo!, prNumberInt),
    enabled: !!owner && !!repo && !!prNumber,
  });

  const { data: filesSinceReview } = useQuery({
    queryKey: ["files-since-review", owner, repo, reviewState?.last_reviewed_commit, pr?.head.sha],
    queryFn: () =>
      github.compareCommits(owner!, repo!, reviewState!.last_reviewed_commit, pr!.head.sha),
    enabled: !!owner && !!repo && !!reviewState?.last_reviewed_commit && !!pr?.head.sha &&
             reviewState.last_reviewed_commit !== pr.head.sha,
  });

  const { data: linkedRepo } = useQuery({
    queryKey: ["codebase", "linked", repoFullName],
    queryFn: () => codebase.getLinkedRepo(repoFullName),
    enabled: !!owner && !!repo,
  });

  // Submit review
  const { isSubmittingReview, submitError, showReviewDialog, setShowReviewDialog, reviewBody, setReviewBody, submitReview } =
    useSubmitReview(owner, repo, prNumberInt, pr, viewedFiles, pendingComments, setPendingComments);

  // Initialize viewed files from saved state
  const [hasInitializedViewedFiles, setHasInitializedViewedFiles] = useState(false);
  useEffect(() => {
    if (reviewState?.viewed_files && !hasInitializedViewedFiles) {
      setViewedFiles(new Set(reviewState.viewed_files));
      setHasInitializedViewedFiles(true);
    }
  }, [reviewState?.viewed_files, hasInitializedViewedFiles]);

  // Load saved analysis when PR data is available
  useEffect(() => {
    if (pr?.head.sha && owner && repo && prNumberInt && analysisKey) {
      analysisCtx.loadCachedAnalysis(analysisKey, owner, repo, prNumberInt, pr.head.sha);
    }
  }, [pr?.head.sha, owner, repo, prNumberInt, analysisKey, analysisCtx]);

  const toggleFileViewed = useCallback((filename: string) => {
    setViewedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }, []);

  // Determine which files to show based on view mode
  const displayFiles = useMemo(() => {
    if (viewMode === "since_review" && filesSinceReview) return filesSinceReview;
    return files || [];
  }, [viewMode, files, filesSinceReview]);

  const hasReviewedBefore = !!reviewState?.last_reviewed_commit;
  const hasNewChanges = hasReviewedBefore && pr?.head.sha !== reviewState?.last_reviewed_commit;

  const runAnalysis = useCallback(() => {
    if (!prUrl || !owner || !repo || !pr?.head.sha || !analysisKey) return;
    analysisCtx.runAnalysis(analysisKey, prUrl, analysisMode, owner, repo, prNumberInt, pr.head.sha);
  }, [prUrl, analysisMode, owner, repo, prNumberInt, pr?.head.sha, analysisKey, analysisCtx]);

  // Get file analysis for selected file
  const selectedFileAnalysis = useMemo(() => {
    if (!analysis || !selectedFile) return null;
    return analysis.file_analyses.find(fa => fa.filename === selectedFile.filename) || null;
  }, [analysis, selectedFile]);

  // Compute sorted file list matching sidebar order
  const sortedFiles = useMemo(() => {
    if (!displayFiles.length) return [];

    if (analysis?.file_groups && analysis.file_groups.length > 0) {
      const importanceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const sortedGroups = [...analysis.file_groups].sort(
        (a, b) => (importanceOrder[a.importance] ?? 2) - (importanceOrder[b.importance] ?? 2)
      );
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
      for (const file of displayFiles) {
        if (!seen.has(norm(file.filename))) ordered.push(file);
      }
      return ordered;
    }

    if (analysis?.file_priorities) {
      const highPriorityFiles = new Set(analysis.file_priorities.filter(fp => fp.priority_score >= 6).map(fp => fp.filename));
      const mediumPriorityFiles = new Set(analysis.file_priorities.filter(fp => fp.priority_score >= 3 && fp.priority_score < 6).map(fp => fp.filename));
      const keyChanges: GitHubFile[] = [];
      const contextFiles: GitHubFile[] = [];
      const otherFiles: GitHubFile[] = [];
      for (const file of displayFiles) {
        if (highPriorityFiles.has(file.filename)) keyChanges.push(file);
        else if (mediumPriorityFiles.has(file.filename)) contextFiles.push(file);
        else otherFiles.push(file);
      }
      return [...keyChanges, ...contextFiles, ...otherFiles];
    }

    const sorted = [...displayFiles].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
    const keyChanges: GitHubFile[] = [];
    const contextFiles: GitHubFile[] = [];
    const otherFiles: GitHubFile[] = [];
    for (const file of sorted) {
      const filename = file.filename.toLowerCase();
      if (filename.includes("test") || filename.includes("spec") || filename.includes(".mock")) contextFiles.push(file);
      else if (keyChanges.length < 3 && (file.additions + file.deletions) > 10) keyChanges.push(file);
      else otherFiles.push(file);
    }
    return [...keyChanges, ...contextFiles, ...otherFiles];
  }, [displayFiles, analysis]);

  // File navigation
  const navigateToNextFile = useCallback(() => {
    if (!sortedFiles.length) return;
    const currentIndex = selectedFile ? sortedFiles.findIndex(f => f.filename === selectedFile.filename) : -1;
    setSelectedFile(sortedFiles[currentIndex < sortedFiles.length - 1 ? currentIndex + 1 : 0]);
  }, [sortedFiles, selectedFile]);

  const navigateToPrevFile = useCallback(() => {
    if (!sortedFiles.length) return;
    const currentIndex = selectedFile ? sortedFiles.findIndex(f => f.filename === selectedFile.filename) : sortedFiles.length;
    setSelectedFile(sortedFiles[currentIndex > 0 ? currentIndex - 1 : sortedFiles.length - 1]);
  }, [sortedFiles, selectedFile]);

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
        <p className="text-sm text-muted-foreground mt-2">Close this tab to return to the dashboard.</p>
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
          <a href={prUrl} target="_blank" rel="noopener noreferrer">View on GitHub</a>
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
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded-full">{files.length}</span>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="summary" className="overflow-y-auto">
          {showFullAnalysis ? (
            <div className="p-6 pb-12">
              <div className="mb-4">
                <Button variant="ghost" size="sm" onClick={() => setShowFullAnalysis(false)} className="gap-1.5">
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
              {hasReviewedBefore && (
                <div className="flex items-center border rounded-md overflow-hidden">
                  <button
                    onClick={() => setViewMode("all")}
                    className={cn(
                      "px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors",
                      viewMode === "all" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"
                    )}
                  >
                    <Filter className="h-3 w-3" />
                    All
                  </button>
                  <button
                    onClick={() => setViewMode("since_review")}
                    className={cn(
                      "px-2.5 py-1 text-xs flex items-center gap-1.5 transition-colors",
                      viewMode === "since_review" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
                      hasNewChanges && viewMode !== "since_review" && "text-amber-600"
                    )}
                  >
                    <History className="h-3 w-3" />
                    New
                    {hasNewChanges && filesSinceReview && (
                      <span className="bg-amber-500 text-white text-[10px] px-1 rounded-full">{filesSinceReview.length}</span>
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
                        <><Check className="h-3.5 w-3.5" />Viewed</>
                      ) : (
                        <><Eye className="h-3.5 w-3.5" />Mark as viewed</>
                      )}
                    </Button>
                  </div>
                )}
              </div>

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
      <SubmitReviewDialog
        showReviewDialog={showReviewDialog}
        setShowReviewDialog={setShowReviewDialog}
        pendingComments={pendingComments}
        reviewBody={reviewBody}
        setReviewBody={setReviewBody}
        submitError={submitError}
        isSubmittingReview={isSubmittingReview}
        submitReview={submitReview}
        userLogin={user?.github_username}
        prAuthorLogin={pr?.user.login}
      />
    </div>
  );
}
