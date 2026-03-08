import { useAuth } from "@/contexts/AuthContext";
import { Routes, Route, Navigate } from "react-router-dom";
import {
  SettingsLayout,
  AIProviders,
  AIModels,
  Repositories,
  Agents,
} from "@/components/settings";

export function Settings() {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="text-center py-20">
        <p className="text-muted-foreground">Please log in to access settings.</p>
      </div>
    );
  }

  return (
    <SettingsLayout>
      <Routes>
        <Route index element={<Navigate to="providers" replace />} />
        <Route path="providers" element={<AIProviders />} />
        <Route path="models" element={<AIModels />} />
        <Route path="repositories" element={<Repositories />} />
        <Route path="agents" element={<Agents />} />
      </Routes>
    </SettingsLayout>
  );
}
