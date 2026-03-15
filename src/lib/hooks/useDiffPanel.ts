import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { github, GitHubFile, LineAnnotation } from "@/lib/api";
import { logger } from "@/lib/logger";
import type { PendingComment, DiffLine, DiffRow, AIAnnotation, LineSelection, ExpandedSection } from "@/lib/types/review";

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

export function useDiffPanel(
  file: GitHubFile | null,
  owner: string,
  repo: string,
  baseSha: string,
  pendingComments: PendingComment[],
  aiAnnotations: LineAnnotation[],
  onNavigateNextFile?: () => void,
  onNavigatePrevFile?: () => void
) {
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

  // Selection helpers
  const isLineSelected = useCallback((index: number) => {
    if (!commentingLines) return false;
    return index >= commentingLines.startIndex && index <= commentingLines.endIndex;
  }, [commentingLines]);

  const isLineInDrag = useCallback((index: number) => {
    if (selectionStart === null || currentHover === null) return false;
    const min = Math.min(selectionStart, currentHover);
    const max = Math.max(selectionStart, currentHover);
    return index >= min && index <= max;
  }, [selectionStart, currentHover]);

  const isDragging = selectionStart !== null;

  return {
    // State
    commentingLines,
    setCommentingLines,
    commentText,
    setCommentText,
    selectionStart,
    setSelectionStart,
    currentHover,
    setCurrentHover,
    hoveredAnnotation,
    setHoveredAnnotation,
    expandedSections,
    editingCommentIndex,
    setEditingCommentIndex,
    editingCommentText,
    setEditingCommentText,
    currentNavigationIndex,

    // Refs
    containerRef,
    commentTextareaRef,
    editTextareaRef,

    // Memos
    diffRows,
    lineNumToRowIndex,
    effectiveAnnotations,
    annotationsByLine,
    findingIndices,
    changeIndices,
    fileComments,
    selectedCodeForSuggestion,

    // Callbacks
    findClosestRow,
    scrollToRow,
    navigateToNextFinding,
    navigateToPrevFinding,
    navigateToNextChange,
    navigateToPrevChange,
    handleExpandSection,

    // Selection helpers
    isLineSelected,
    isLineInDrag,
    isDragging,
  };
}
