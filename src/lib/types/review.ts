import type { AgentType } from "@/lib/api";

export type ViewMode = "all" | "since_review";

export interface PendingComment {
  id?: string;
  file: string;
  line: number;
  lineEnd: number;
  body: string;
  newLineNum?: number;
  newLineNumStart?: number;
}

export type ReviewAction = "approve" | "request_changes" | "comment";

export interface DiffLine {
  type: "add" | "remove" | "context" | "header" | "expandable";
  content: string;
  oldLineNum?: number;
  newLineNum?: number;
  expandRange?: { oldStart: number; newStart: number; oldEnd: number; newEnd: number };
}

export interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
  index: number;
}

export interface AIAnnotation {
  lineIndex: number;
  type: "warning" | "info" | "suggestion";
  message: string;
  severity?: string;
  category?: string;
  sources?: AgentType[];
  suggestion?: string | null;
}

export interface LineSelection {
  startIndex: number;
  endIndex: number;
}

export interface ExpandedSection {
  rowIndex: number;
  lines: string[];
  loading: boolean;
  error: string | null;
}
