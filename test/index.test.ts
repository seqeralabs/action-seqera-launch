import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("builds a bundle that the Actions runtime can load", async () => {
    const bundle = await readFile("dist/index.js", "utf8");
    expect(bundle.length).toBeGreaterThan(0);
  });
});
