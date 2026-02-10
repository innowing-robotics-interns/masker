import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/datasets": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/predict": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
