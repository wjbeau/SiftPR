import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { github, GitHubFile, codebase, review } from "@/lib/api";
import { useAnalysis, makeAnalysisKey, type AnalysisMode } from "@/contexts/AnalysisContext";

export function useReviewData(owner: string | undefined, repo: string | undefined, prNumber: string | undefined) {
  const prUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}`;
  const repoFullName = `${owner}/${repo}`;
  const prNumberInt = prNumber ? parseInt(prNumber, 10) : 0;

  // Analysis context
  const analysisCtx = useAnalysis();
  const analysisKey = owner && repo && prNumber ? makeAnalysisKey(owner, repo, prNumber) : "";
  const { isAnalyzing, analysis, analysisError, analysisMode, lastAnalysisMode, agentProgress, isGroupingFiles } = analysisCtx.getEntry(analysisKey);
  const setAnalysisMode = useCallback((mode: AnalysisMode) => analysisCtx.setAnalysisMode(analysisKey, mode), [analysisCtx, analysisKey]);

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

  // Viewed files state + initialization
  const [selectedFile, setSelectedFile] = useState<GitHubFile | null>(null);
  const [viewedFiles, setViewedFiles] = useState<Set<string>>(new Set());

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
  const [viewMode, setViewMode] = useState<"all" | "since_review">("all");
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

  const cancelAnalysis = useCallback(() => {
    if (!prUrl || !analysisKey) return;
    analysisCtx.cancelAnalysis(analysisKey, prUrl);
  }, [prUrl, analysisKey, analysisCtx]);

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

  return {
    prUrl,
    repoFullName,
    prNumberInt,
    // Queries
    pr,
    files,
    reviewState,
    filesSinceReview,
    linkedRepo,
    isLoading,
    // Analysis
    isAnalyzing,
    analysis,
    analysisError,
    analysisMode,
    lastAnalysisMode,
    setAnalysisMode,
    runAnalysis,
    cancelAnalysis,
    agentProgress,
    isGroupingFiles,
    selectedFileAnalysis,
    // File state
    selectedFile,
    setSelectedFile,
    viewedFiles,
    toggleFileViewed,
    viewMode,
    setViewMode,
    displayFiles,
    // Derived
    hasReviewedBefore,
    hasNewChanges,
    sortedFiles,
    navigateToNextFile,
    navigateToPrevFile,
  };
}
