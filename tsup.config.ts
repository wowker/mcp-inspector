import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/server/main.ts",
    "workflows/script-worker": "src/server/workflows/script-worker.ts",
  },
  format: ["esm"],
  target: "node22",
  outDir: "dist/server",
  clean: true,
  splitting: false,
});
