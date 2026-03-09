import { createContext, useContext, ReactNode, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { auth, User } from "@/lib/api";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
  refetch: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => auth.getUser(),
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });

  // Listen for OAuth callback from deep link
  useEffect(() => {
    const unlisten = listen<string>("oauth-callback", async (event) => {
      console.log("OAuth callback received:", event.payload);
      try {
        const user = await auth.exchangeCode(event.payload);
        queryClient.setQueryData(["auth", "me"], user);
      } catch (error) {
        console.error("Failed to exchange OAuth code:", error);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  const user = data ?? null;

  const handleLogout = async () => {
    await auth.logout();
    // Clear localStorage caches first
    localStorage.removeItem("siftpr-cached-repos");
    localStorage.removeItem("siftpr-cached-favorites");
    // Set auth to null (triggers re-render)
    queryClient.setQueryData(["auth", "me"], null);
    // Clear all other cached queries
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        logout: handleLogout,
        refetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
