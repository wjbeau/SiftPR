import {
  Shield,
  Layers,
  Paintbrush,
  Zap,
  Search,
  ScanSearch,
} from "lucide-react";
import type { AgentType } from "@/lib/api";

export const AGENT_ICONS: Record<string, { icon: typeof Shield; color: string; bgColor: string }> = {
  security: {
    icon: Shield,
    color: "text-red-500",
    bgColor: "bg-red-100 dark:bg-red-950",
  },
  architecture: {
    icon: Layers,
    color: "text-blue-500",
    bgColor: "bg-blue-100 dark:bg-blue-950",
  },
  style: {
    icon: Paintbrush,
    color: "text-green-500",
    bgColor: "bg-green-100 dark:bg-green-950",
  },
  performance: {
    icon: Zap,
    color: "text-amber-500",
    bgColor: "bg-amber-100 dark:bg-amber-950",
  },
  research: {
    icon: Search,
    color: "text-violet-500",
    bgColor: "bg-violet-100 dark:bg-violet-950",
  },
  profiler: {
    icon: ScanSearch,
    color: "text-cyan-500",
    bgColor: "bg-cyan-100 dark:bg-cyan-950",
  },
};

export const AGENT_STATUS_MESSAGES: Record<AgentType, string[]> = {
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

export function getAgentIcon(type: AgentType) {
  switch (type) {
    case "security":
      return Shield;
    case "architecture":
      return Layers;
    case "style":
      return Paintbrush;
    case "performance":
      return Zap;
  }
}

export function getAgentColors(type: AgentType) {
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
}

export function getRiskColor(level: string) {
  switch (level.toLowerCase()) {
    case "high":
      return "text-red-600 bg-red-100 dark:bg-red-950/50";
    case "medium":
      return "text-amber-600 bg-amber-100 dark:bg-amber-950/50";
    default:
      return "text-green-600 bg-green-100 dark:bg-green-950/50";
  }
}

export function getSeverityColor(severity: string) {
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
}
