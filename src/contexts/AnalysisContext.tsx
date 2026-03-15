import { createContext, useContext, useCallback, useRef, useState, useEffect, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ai, analysis as analysisApi, OrchestratedAnalysis, type AnalysisEvent } from "@/lib/api";
import { logger } from "@/lib/logger";

export type AnalysisMode = "pr_only" | "with_context";

export type AgentStatus = "pending" | "running" | "completed" | "failed";

export interface AgentProgress {
  status: AgentStatus;
  mode?: string;
  findingCount?: number;
  timeMs?: number;
  error?: string;
  lastToolCall?: string;
  toolIteration?: number;
}

export interface AnalysisEntry {
  isAnalyzing: boolean;
  analysis: OrchestratedAnalysis | null;
  analysisError: string | null;
  analysisMode: AnalysisMode;
  lastAnalysisMode: AnalysisMode | null;
  agentProgress: Record<string, AgentProgress>;
  isGroupingFiles: boolean;
}

const defaultEntry: AnalysisEntry = {
  isAnalyzing: false,
  analysis: null,
  analysisError: null,
  analysisMode: "pr_only",
  lastAnalysisMode: null,
  agentProgress: {},
  isGroupingFiles: false,
};

interface AnalysisContextValue {
  getEntry: (key: string) => AnalysisEntry;
  runAnalysis: (
    key: string,
    prUrl: string,
    mode: AnalysisMode,
    owner: string,
    repo: string,
    prNumber: number,
    headSha: string
  ) => void;
  cancelAnalysis: (key: string, prUrl: string) => void;
  setAnalysisMode: (key: string, mode: AnalysisMode) => void;
  loadCachedAnalysis: (
    key: string,
    owner: string,
    repo: string,
    prNumber: number,
    headSha: string
  ) => void;
}

const AnalysisContext = createContext<AnalysisContextValue | null>(null);

export function makeAnalysisKey(owner: string, repo: string, prNumber: string | number): string {
  return `${owner}/${repo}/${prNumber}`;
}

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, AnalysisEntry>>({});
  const loadedKeysRef = useRef<Set<string>>(new Set());
  const activeUrlsRef = useRef<Map<string, string>>(new Map()); // key -> prUrl

  const getEntry = useCallback(
    (key: string): AnalysisEntry => entries[key] ?? defaultEntry,
    [entries]
  );

  const updateEntry = useCallback(
    (key: string, patch: Partial<AnalysisEntry>) => {
      setEntries((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? defaultEntry), ...patch },
      }));
    },
    []
  );

  // Listen for analysis progress events from the backend
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    listen<AnalysisEvent>("analysis-progress", (event) => {
      const payload = event.payload;

      // Find which key this event is for (match by active URLs)
      const activeKey = Array.from(activeUrlsRef.current.entries())
        .find(([_k, _url]) => true)?.[0]; // Use the first active analysis

      if (!activeKey) return;

      setEntries((prev) => {
        const entry = prev[activeKey] ?? defaultEntry;
        const agentProgress = { ...entry.agentProgress };

        switch (payload.type) {
          case "AnalysisStarted":
            // Initialize all agents as pending
            for (const agent of ["security", "architecture", "style", "performance"]) {
              agentProgress[agent] = { status: "pending" };
            }
            return { ...prev, [activeKey]: { ...entry, agentProgress } };

          case "AgentStarted":
            agentProgress[payload.agent] = { status: "running", mode: payload.mode };
            return { ...prev, [activeKey]: { ...entry, agentProgress } };

          case "AgentToolCall":
            if (agentProgress[payload.agent]) {
              agentProgress[payload.agent] = {
                ...agentProgress[payload.agent],
                lastToolCall: payload.tool,
                toolIteration: payload.iteration,
              };
            }
            return { ...prev, [activeKey]: { ...entry, agentProgress } };

          case "AgentCompleted":
            agentProgress[payload.agent] = {
              status: "completed",
              findingCount: payload.finding_count,
              timeMs: payload.time_ms,
            };
            return { ...prev, [activeKey]: { ...entry, agentProgress } };

          case "AgentFailed":
            agentProgress[payload.agent] = {
              status: "failed",
              error: payload.error,
            };
            return { ...prev, [activeKey]: { ...entry, agentProgress } };

          case "FileGroupingStarted":
            return { ...prev, [activeKey]: { ...entry, isGroupingFiles: true } };

          case "FileGroupingCompleted":
            return { ...prev, [activeKey]: { ...entry, isGroupingFiles: false } };

          case "AnalysisCompleted":
          case "AnalysisCancelled":
            return prev; // Handled by the promise resolution

          default:
            return prev;
        }
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const runAnalysis = useCallback(
    (
      key: string,
      prUrl: string,
      mode: AnalysisMode,
      owner: string,
      repo: string,
      prNumber: number,
      headSha: string
    ) => {
      // Guard: no-op if already analyzing this key
      setEntries((prev) => {
        if (prev[key]?.isAnalyzing) return prev;

        const entry: AnalysisEntry = {
          ...(prev[key] ?? defaultEntry),
          isAnalyzing: true,
          analysisError: null,
          analysisMode: mode,
          agentProgress: {},
          isGroupingFiles: false,
        };

        // Track active URL
        activeUrlsRef.current.set(key, prUrl);

        // Fire the async work
        const withContext = mode === "with_context";
        logger.log("Starting analysis for:", prUrl, "with context:", withContext);

        ai.analyzePROrchestrated(prUrl, withContext)
          .then(async (result) => {
            logger.log("Analysis result:", result);
            activeUrlsRef.current.delete(key);
            updateEntry(key, {
              analysis: result,
              lastAnalysisMode: mode,
              isAnalyzing: false,
            });

            // Save to cache
            try {
              await analysisApi.save(owner, repo, prNumber, headSha, result);
              logger.log("Analysis saved to cache");
            } catch (saveErr) {
              logger.error("Failed to save analysis:", saveErr);
            }
          })
          .catch((e) => {
            logger.error("Analysis failed:", e);
            activeUrlsRef.current.delete(key);
            const errorMsg =
              typeof e === "string"
                ? e
                : (e as { message?: string })?.message || JSON.stringify(e);
            updateEntry(key, {
              analysisError: errorMsg,
              analysis: null,
              isAnalyzing: false,
            });
          });

        return { ...prev, [key]: entry };
      });
    },
    [updateEntry]
  );

  const cancelAnalysis = useCallback(
    (key: string, prUrl: string) => {
      ai.cancelAnalysis(prUrl).catch((e) => {
        logger.error("Failed to cancel analysis:", e);
      });
      activeUrlsRef.current.delete(key);
      updateEntry(key, {
        isAnalyzing: false,
        analysisError: "Analysis cancelled",
      });
    },
    [updateEntry]
  );

  const setAnalysisMode = useCallback(
    (key: string, mode: AnalysisMode) => {
      updateEntry(key, { analysisMode: mode });
    },
    [updateEntry]
  );

  const loadCachedAnalysis = useCallback(
    (
      key: string,
      owner: string,
      repo: string,
      prNumber: number,
      headSha: string
    ) => {
      const loadKey = `${key}:${headSha}`;
      if (loadedKeysRef.current.has(loadKey)) return;
      loadedKeysRef.current.add(loadKey);

      // Don't overwrite if we already have analysis or are currently analyzing
      setEntries((prev) => {
        const existing = prev[key];
        if (existing?.analysis || existing?.isAnalyzing) return prev;
        return prev; // continue — we just needed the guard check
      });

      // Check current state before fetching
      const current = entries[key];
      if (current?.analysis || current?.isAnalyzing) return;

      analysisApi
        .get(owner, repo, prNumber, headSha)
        .then((savedAnalysis) => {
          if (savedAnalysis) {
            logger.log("Loaded saved analysis for commit:", headSha);
            setEntries((prev) => {
              // Re-check: don't overwrite if analysis arrived while we were loading
              if (prev[key]?.analysis || prev[key]?.isAnalyzing) return prev;
              return {
                ...prev,
                [key]: { ...(prev[key] ?? defaultEntry), analysis: savedAnalysis },
              };
            });
          }
        })
        .catch((err) => {
          logger.error("Failed to load saved analysis:", err);
        });
    },
    [entries]
  );

  return (
    <AnalysisContext.Provider
      value={{ getEntry, runAnalysis, cancelAnalysis, setAnalysisMode, loadCachedAnalysis }}
    >
      {children}
    </AnalysisContext.Provider>
  );
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error("useAnalysis must be used within AnalysisProvider");
  return ctx;
}
