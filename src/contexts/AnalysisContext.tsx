import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from "react";
import { ai, analysis as analysisApi, OrchestratedAnalysis } from "@/lib/api";
import { logger } from "@/lib/logger";

export type AnalysisMode = "pr_only" | "with_context";

export interface AnalysisEntry {
  isAnalyzing: boolean;
  analysis: OrchestratedAnalysis | null;
  analysisError: string | null;
  analysisMode: AnalysisMode;
  lastAnalysisMode: AnalysisMode | null;
}

const defaultEntry: AnalysisEntry = {
  isAnalyzing: false,
  analysis: null,
  analysisError: null,
  analysisMode: "pr_only",
  lastAnalysisMode: null,
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
        };

        // Fire the async work
        const withContext = mode === "with_context";
        logger.log("Starting analysis for:", prUrl, "with context:", withContext);

        ai.analyzePROrchestrated(prUrl, withContext)
          .then(async (result) => {
            logger.log("Analysis result:", result);
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
      value={{ getEntry, runAnalysis, setAnalysisMode, loadCachedAnalysis }}
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
