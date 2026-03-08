import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { open } from "@tauri-apps/plugin-shell";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function Login() {
  const { isAuthenticated, isLoading, refetch } = useAuth();
  const navigate = useNavigate();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [isExchanging, setIsExchanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/");
    }
  }, [isAuthenticated, navigate]);

  const handleLogin = async () => {
    try {
      setIsSigningIn(true);
      setError(null);
      const url = await auth.getOAuthUrl();
      await open(url);
      // The deep link handler will complete the OAuth flow
    } catch (error) {
      console.error("Failed to start OAuth:", error);
      setError("Failed to open browser");
      setIsSigningIn(false);
    }
  };

  const handleManualCode = async () => {
    if (!manualCode.trim()) return;
    try {
      setIsExchanging(true);
      setError(null);
      await auth.exchangeCode(manualCode.trim());
      refetch();
    } catch (error) {
      console.error("Failed to exchange code:", error);
      setError("Failed to exchange code. It may have expired.");
      setIsExchanging(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Welcome to SiftPR</CardTitle>
          <CardDescription>
            Sign in with GitHub to start reviewing pull requests with AI-powered
            insights
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full"
            size="lg"
            onClick={handleLogin}
            disabled={isSigningIn || isExchanging}
          >
            <svg
              className="mr-2 h-5 w-5"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            {isSigningIn ? "Opening browser..." : "Continue with GitHub"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            We'll open your browser to sign in with GitHub. After authorizing,
            you'll be redirected back to the app.
          </p>

          {isSigningIn && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                If the redirect didn't work, paste the <code className="bg-muted px-1 rounded">code</code> parameter from the URL:
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Paste code here..."
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  disabled={isExchanging}
                />
                <Button
                  onClick={handleManualCode}
                  disabled={!manualCode.trim() || isExchanging}
                >
                  {isExchanging ? "..." : "Submit"}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive text-center">{error}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
