import { defineConfig } from "rolldown";

const entries = [
  { input: "src/index.ts", file: "dist/index.js" },
  { input: "src/studio.ts", file: "dist/studio.js" },
];

export default defineConfig(
  entries.map(({ input, file }) => ({
    input,
    output: {
      file,
      format: "esm" as const,
      // The Actions runtime loads exactly one file per action, so never split chunks.
      codeSplitting: false,
      minify: true,
    },
    platform: "node" as const,
  })),
);
