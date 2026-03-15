import { useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowLeft, FileCode, Loader2, ClipboardList, Check, Eye } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDraftComments } from "@/lib/hooks/useDraftComments";
import { useSubmitReview } from "@/lib/hooks/useSubmitReview";
import { useReviewData } from "@/lib/hooks/useReviewData";
import { OverviewPanel } from "@/components/review/OverviewPanel";
import { AISummarySection } from "@/components/review/AISummarySection";
import { AIAnalyticsPanel } from "@/components/review/AIAnalyticsPanel";
import { PrioritizedFileList } from "@/components/review/PrioritizedFileList";
import { AIContextPanel } from "@/components/review/AIContextPanel";
import { DiffPanel } from "@/components/review/DiffPanel";
import { SubmitReviewDialog } from "@/components/review/SubmitReviewDialog";
import { ReviewActionsBar } from "@/components/review/ReviewActionsBar";

export function Review() {
  const { owner, repo, prNumber } = useParams<{
    owner: string;
    repo: string;
    prNumber: string;
  }>();
  const { user } = useAuth();

  const [showFullAnalysis, setShowFullAnalysis] = useState(false);

  const {
    prUrl, prNumberInt,
    pr, files, filesSinceReview, linkedRepo,
    isLoading,
    isAnalyzing, analysis, analysisError, analysisMode, lastAnalysisMode,
    setAnalysisMode, runAnalysis, cancelAnalysis, agentProgress, isGroupingFiles, selectedFileAnalysis,
    selectedFile, setSelectedFile, viewedFiles, toggleFileViewed,
    viewMode, setViewMode, displayFiles,
    hasReviewedBefore, hasNewChanges,
    navigateToNextFile, navigateToPrevFile,
  } = useReviewData(owner, repo, prNumber);

  // Draft comments
  const { pendingComments, setPendingComments, addComment, editComment, deleteComment } = useDraftComments(owner, repo, prNumberInt);

  // Submit review
  const { isSubmittingReview, submitError, showReviewDialog, setShowReviewDialog, reviewBody, setReviewBody, submitReview } =
    useSubmitReview(owner, repo, prNumberInt, pr, viewedFiles, pendingComments, setPendingComments);

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
                onCancelAnalysis={cancelAnalysis}
                linkedRepo={linkedRepo}
                analysisMode={analysisMode}
                onSetAnalysisMode={setAnalysisMode}
                lastAnalysisMode={lastAnalysisMode}
                pr={pr}
                owner={owner}
                repo={repo}
                agentProgress={agentProgress}
                isGroupingFiles={isGroupingFiles}
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
          <ReviewActionsBar
            viewedFiles={viewedFiles}
            displayFiles={displayFiles}
            pendingComments={pendingComments}
            setPendingComments={setPendingComments}
            setReviewBody={setReviewBody}
            hasReviewedBefore={hasReviewedBefore}
            hasNewChanges={hasNewChanges}
            filesSinceReview={filesSinceReview}
            viewMode={viewMode}
            setViewMode={setViewMode}
            setShowReviewDialog={setShowReviewDialog}
            isSubmittingReview={isSubmittingReview}
            owner={owner}
            repo={repo}
            prNumberInt={prNumberInt}
          />

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
