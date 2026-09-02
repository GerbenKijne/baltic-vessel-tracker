import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Resolves to <repo-root>/packages/contracts/typescript both when run from
// the monorepo checkout and inside the Docker build (which copies contracts
// two levels up from the app dir to mirror this same relative distance —
// see apps/web/Dockerfile).
const contractsDir = path.resolve(__dirname, "../../packages/contracts/typescript");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@contracts": contractsDir,
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true, ws: true },
    },
  },
});
