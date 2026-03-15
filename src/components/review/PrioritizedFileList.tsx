import { useState, useMemo } from "react";
import { Loader2, Sparkles, AlertTriangle, BookOpen, Files, ChevronDown, Check, Eye, EyeOff } from "lucide-react";
import { GitHubFile, OrchestratedAnalysis } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface PrioritizedFileListProps {
  files: GitHubFile[];
  selectedFile: GitHubFile | null;
  onSelectFile: (file: GitHubFile) => void;
  viewedFiles: Set<string>;
  onToggleViewed: (filename: string) => void;
  analysis: OrchestratedAnalysis | null;
  isAnalyzing: boolean;
  onRunAnalysis: () => void;
}

export function FileStatusIcon({ status }: { status: string }) {
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

export function PrioritizedFileList({
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
    sectionFiles: GitHubFile[],
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
            {sectionFiles.length}
          </span>
        </button>

        {isExpanded && (
          <div className="pb-2">
            {description && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                {description}
              </p>
            )}
            {sectionFiles.length > 0 ? (
              sectionFiles.map((f) => renderFileItem(f))
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
