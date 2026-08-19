import { describe, expect, it } from "vitest";
import { workflowWatchUrl, workspaceRef } from "../src/monitoring/workflow-url.js";

describe("workflowWatchUrl", () => {
  it("maps the cloud API host to the watch URL", () => {
    expect(workflowWatchUrl("https://api.cloud.seqera.io", "seqera", "demo", "abc123")).toBe(
      "https://cloud.seqera.io/orgs/seqera/workspaces/demo/watch/abc123",
    );
  });

  it("builds workspace refs", () => {
    expect(workspaceRef("seqera", "demo")).toBe("seqera/demo");
  });
});
