import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server/main.ts"],
  format: ["esm"],
  target: "node22",
  outDir: "dist/server",
  clean: true,
  splitting: false,
});
