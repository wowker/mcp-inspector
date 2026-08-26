import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiOrigin = process.env.MCP_INSPECTOR_API_ORIGIN;

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist/client",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: apiOrigin === undefined ? undefined : { "/api": apiOrigin },
  },
});
