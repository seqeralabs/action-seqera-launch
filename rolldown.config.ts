import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  output: {
    file: "dist/index.js",
    format: "esm",
    // The Actions runtime loads exactly one file, so never split chunks.
    codeSplitting: false,
    minify: true,
  },
  platform: "node",
});
