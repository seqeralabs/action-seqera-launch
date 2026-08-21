import { beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";
import type { JsonValue } from "../src/json.js";
import { runAction } from "../src/action/run.js";

// `core.summary` caches its file path on first use, so every test in this file
// shares one path and truncates it instead of allocating a new one.
const summaryPath = join(mkdtempSync(join(tmpdir(), "seqera-run-summary-")), "summary.md");
const outputPath = join(mkdtempSync(join(tmpdir(), "seqera-run-output-")), "output.txt");

const json = (body: JsonValue) =>
  new MockHttpResponse({ statusCode: 200, headers: {} }, JSON.stringify(body));

const computeEnvs = () =>
  json({
    computeEnvs: [{ id: "ce-1", name: "my-ce", status: "AVAILABLE", workDir: "s3://bucket/work" }],
  });

beforeEach(() => {
  writeFileSync(summaryPath, "");
  writeFileSync(outputPath, "");
  process.env["GITHUB_STEP_SUMMARY"] = summaryPath;
  process.env["GITHUB_OUTPUT"] = outputPath;
  process.env["INPUT_ACCESS-TOKEN"] = "token";
  process.env["INPUT_API-ENDPOINT"] = "https://api.example.com";
  process.env["INPUT_PIPELINE"] = "https://github.com/nextflow-io/hello";
  process.env["INPUT_COMPUTE-ENV"] = "my-ce";
  process.env["INPUT_WORKSPACE-ID"] = "123";
  process.env["INPUT_WAIT"] = "running";
  process.env["INPUT_STUB-RUN"] = "true";
});

describe("runAction job summary", () => {
  it("writes a summary when the launch succeeds", async () => {
    const http = new MockHttpClient()
      .when("/compute-envs", computeEnvs)
      .when("/workflow/launch", () => json({ workflowId: "wf-ok" }))
      .when("/workflow/wf-ok", () =>
        json({
          orgName: "org",
          workspaceName: "ws",
          workflow: { id: "wf-ok", status: "RUNNING", errorMessage: null },
        }),
      );

    await Effect.runPromise(runAction(http));

    const written = readFileSync(summaryPath, "utf8");
    expect(written).toContain("Seqera Platform Launch");
    expect(written).toContain("wf-ok");
    expect(written).toContain("Launch step completed successfully.");
  });

  it("writes a summary when the workflow fails", async () => {
    const http = new MockHttpClient()
      .when("/compute-envs", computeEnvs)
      .when("/workflow/launch", () => json({ workflowId: "wf-bad" }))
      .when("/workflow/wf-bad/tasks", () => json({ tasks: [] }))
      .when("/workflow/wf-bad", () =>
        json({
          orgName: "org",
          workspaceName: "ws",
          workflow: { id: "wf-bad", status: "FAILED", errorMessage: "pipeline blew up" },
        }),
      );

    const exit = await Effect.runPromiseExit(runAction(http));
    expect(exit._tag).toBe("Failure");

    const written = readFileSync(summaryPath, "utf8");
    expect(written).toContain("Seqera Platform Launch");
    expect(written).toContain("wf-bad");
    expect(written).toContain("Launch step failed.");
  });
});
