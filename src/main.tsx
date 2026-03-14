import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { logger } from "@/lib/logger";

// Check if an error indicates an unauthorized/expired token
function isUnauthorizedError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes("unauthorized") || message === "unauthorized";
  }
  if (typeof error === "string") {
    const message = error.toLowerCase();
    return message.includes("unauthorized") || message === "unauthorized";
  }
  return false;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: (failureCount, error) => {
        // Don't retry on unauthorized errors
        if (isUnauthorizedError(error)) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});

// Handle global errors - clears auth state on Unauthorized
function handleUnauthorizedError(error: unknown): void {
  if (isUnauthorizedError(error)) {
    logger.log("[Auth] Unauthorized error detected, clearing auth state");
    // Clear auth state - this will show the login screen
    queryClient.setQueryData(["auth", "me"], null);
    // Clear localStorage caches
    localStorage.removeItem("siftpr-cached-repos");
    localStorage.removeItem("siftpr-cached-favorites");
    // Clear all other cached queries
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
  }
}

// Set up global query/mutation error handlers
queryClient.getQueryCache().config.onError = handleUnauthorizedError;
queryClient.getMutationCache().config.onError = handleUnauthorizedError;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
