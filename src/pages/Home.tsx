import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function Home() {
  const { isAuthenticated } = useAuth();
  const [prUrl, setPrUrl] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO: Navigate to review page with PR analysis
    console.log("Reviewing PR:", prUrl);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <h1 className="text-4xl font-bold mb-4">Welcome to SiftPR</h1>
        <p className="text-lg text-muted-foreground mb-8 text-center max-w-lg">
          AI-powered PR review tool that helps you identify important changes
          and organize your code review workflow.
        </p>
        <Button asChild size="lg">
          <Link to="/login">Login with GitHub to get started</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Review a Pull Request</h1>
      <p className="text-muted-foreground mb-8">
        Paste a GitHub PR URL to start your AI-powered review.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Enter PR URL</CardTitle>
          <CardDescription>
            Paste the URL of the GitHub pull request you want to review
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pr-url">Pull Request URL</Label>
              <Input
                id="pr-url"
                type="url"
                placeholder="https://github.com/owner/repo/pull/123"
                value={prUrl}
                onChange={(e) => setPrUrl(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full">
              Start Review
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="mt-8">
        <h2 className="text-xl font-semibold mb-4">Recent Reviews</h2>
        <p className="text-muted-foreground">
          No reviews yet. Start by reviewing a pull request above.
        </p>
      </div>
    </div>
  );
}
