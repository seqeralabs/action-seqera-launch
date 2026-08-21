import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSeqeraClient } from "../src/api/client.js";
import {
  buildJobSummaryOptions,
  reportWorkflowFailure,
  writeJobSummary,
} from "../src/monitoring/report.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

describe("writeJobSummary", () => {
  // The add* helpers only fill an in-memory buffer, so assert against the
  // file the runner actually renders rather than against the call.
  it("flushes the summary to GITHUB_STEP_SUMMARY", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "summary-")), "summary.md");
    writeFileSync(path, "");
    const previous = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = path;

    try {
      await Effect.runPromise(
        writeJobSummary(
          buildJobSummaryOptions({
            workflowId: "wf-9",
            workflowUrl: "https://example.com/watch/9",
            workspaceRef: "org/ws",
            status: "FAILED",
            errorMessage: "boom",
            succeeded: false,
          }),
        ),
      );

      const written = readFileSync(path, "utf8");
      expect(written).toContain("Seqera Platform Launch");
      expect(written).toContain("wf-9");
      expect(written).toContain("boom");
      expect(written).toContain("Launch step failed.");
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
      } else {
        process.env.GITHUB_STEP_SUMMARY = previous;
      }
    }
  });
});

describe("buildJobSummaryOptions", () => {
  it("includes status and error message when both are present", () => {
    const options = buildJobSummaryOptions({
      workflowId: "wf-1",
      workflowUrl: "https://example.com/watch/1",
      workspaceRef: "org/ws",
      succeeded: false,
      status: "FAILED",
      errorMessage: "boom",
    });

    expect(options).toEqual({
      workflowId: "wf-1",
      workflowUrl: "https://example.com/watch/1",
      workspaceRef: "org/ws",
      status: "FAILED",
      errorMessage: "boom",
      succeeded: false,
    });
  });

  it("omits optional fields when unset", () => {
    const options = buildJobSummaryOptions({
      workflowId: "wf-2",
      workflowUrl: "https://example.com/watch/2",
      workspaceRef: "org/ws",
      succeeded: true,
    });

    expect(options.status).toBeUndefined();
    expect(options.errorMessage).toBeUndefined();
  });
});

describe("reportWorkflowFailure", () => {
  it("fetches failed task logs and returns the workflow watch URL", async () => {
    const longLine = "x".repeat(200);
    const stderr = Array.from({ length: 50 }, () => longLine).join("\n");

    const http = new MockHttpClient()
      .when(
        "/workflow/42/tasks",
        () =>
          new MockHttpResponse(
            { statusCode: 200, headers: {} },
            JSON.stringify({
              tasks: [{ task: { taskId: 7, name: "bad-step", errorMessage: "step failed" } }],
            }),
          ),
      )
      .when(
        "/workflow/42/task/7/log",
        () =>
          new MockHttpResponse(
            { statusCode: 200, headers: {} },
            JSON.stringify({
              log: {
                entries: [{ stderr }],
              },
            }),
          ),
      );

    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    const url = await Effect.runPromise(
      reportWorkflowFailure(
        client,
        "https://api.example.com",
        {
          orgName: "org",
          workspaceName: "ws",
          workflow: {
            errorMessage: "workflow failed",
            errorReport: "report",
            exitStatus: 1,
          },
        },
        "42",
        undefined,
      ),
    );

    expect(url).toBe("https://example.com/orgs/org/workspaces/ws/watch/42");
  });
});
