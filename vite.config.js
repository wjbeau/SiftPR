import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// https://tauri.app/v2/guides/develop/vite
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    // Prevent vite from obscuring rust errors
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        watch: {
            ignored: ["**/src-tauri/**"],
        },
    },
});
