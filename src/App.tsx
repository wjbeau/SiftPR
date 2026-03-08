import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import { Review } from "./pages/Review";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/review/:owner/:repo/:prNumber" element={<Review />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

export default App;
