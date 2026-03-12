import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { TabsProvider } from "./contexts/TabsContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Review } from "./pages/Review";
import DebugPanel from "./components/DebugPanel";

// Version info - increment manually when releasing (lol)
const APP_VERSION = "0.1.0-dev";
const BUILD_DATE = "2026-03-11";

function App() {
  // Store version info globally for diagnostics
  (window as any).__SIFTPR_VERSION = APP_VERSION;
  (window as any).__SIFTPR_BUILD = BUILD_DATE;

  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <TabsProvider>
                <Layout />
              </TabsProvider>
            }
          >
            <Route path="/" element={<Home />} />
            <Route path="/settings/*" element={<Settings />} />
            <Route path="/review/:owner/:repo/:prNumber" element={<Review />} />
          </Route>
        </Routes>
        <DebugPanel />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
