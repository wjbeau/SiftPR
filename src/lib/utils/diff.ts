import type { GitHubFile } from "@/lib/api";
import type { DiffRow, DiffLine, AIAnnotation } from "@/lib/types/review";

export function parseDiff(patch: string): DiffRow[] {
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
export function generateAIAnnotations(file: GitHubFile, rows: DiffRow[]): AIAnnotation[] {
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
