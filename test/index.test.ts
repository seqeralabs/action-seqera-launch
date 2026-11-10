import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("builds a bundle that the Actions runtime can load", async () => {
    for (const file of ["dist/index.js", "dist/studio.js"]) {
      const bundle = await readFile(file, "utf8");
      expect(bundle.length).toBeGreaterThan(0);
    }
  });
});
