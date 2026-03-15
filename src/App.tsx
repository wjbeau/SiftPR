import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { AnalysisProvider } from "./contexts/AnalysisContext";
import { TabsProvider } from "./contexts/TabsContext";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Review } from "./pages/Review";

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AnalysisProvider>
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
        </AnalysisProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
