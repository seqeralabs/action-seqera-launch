import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createSeqeraClient } from "../src/api/client.js";
import { monitorWorkflow } from "../src/monitoring/poll.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

function testClient(http: MockHttpClient) {
  return createSeqeraClient({ baseUrl: "https://api.example.com", accessToken: "token" }, http);
}

const describeRunning = JSON.stringify({
  orgName: "seqera",
  workspaceName: "demo",
  workspaceId: 1,
  workflow: { id: "wf-1", status: "RUNNING" },
});

const describeSubmitted = JSON.stringify({
  orgName: "seqera",
  workspaceName: "demo",
  workspaceId: 1,
  workflow: { id: "wf-1", status: "SUBMITTED" },
});

const describeFailed = JSON.stringify({
  orgName: "seqera",
  workspaceName: "demo",
  workspaceId: 1,
  workflow: {
    id: "wf-1",
    status: "FAILED",
    errorMessage: "boom",
  },
});
// Shape returned by the real API for an in-flight run: the nullable error
// fields are present but null rather than omitted.
const describeSubmittedWithNulls = JSON.stringify({
  orgName: "seqera",
  workspaceName: "demo",
  workspaceId: 1,
  workflow: {
    id: "wf-1",
    status: "SUBMITTED",
    errorMessage: null,
    errorReport: null,
    exitStatus: null,
    runName: null,
  },
});

const describeSucceeded = JSON.stringify({
  orgName: "seqera",
  workspaceName: "demo",
  workspaceId: 1,
  workflow: { id: "wf-1", status: "SUCCEEDED" },
});

describe("monitorWorkflow", () => {
  it("returns immediately for wait none after launch describe", async () => {
    const http = new MockHttpClient().when(
      "/workflow/wf-1",
      () => new MockHttpResponse({ statusCode: 200, headers: {} }, describeRunning),
    );
    const client = testClient(http);

    const result = await Effect.runPromise(
      monitorWorkflow(client, "https://api.example.com", "wf-1", 1, "none", undefined, "ce-1"),
    );

    expect(result.waitOutcome).toBe("none");
  });

  it("exits running wait once the workflow leaves SUBMITTED", async () => {
    let calls = 0;
    const http = new MockHttpClient().when("/workflow/wf-1", () => {
      calls += 1;
      const body = calls === 1 ? describeSubmitted : describeRunning;
      return new MockHttpResponse({ statusCode: 200, headers: {} }, body);
    });
    const client = testClient(http);
    const result = await Effect.runPromise(
      monitorWorkflow(
        client,
        "https://api.example.com",
        "wf-1",
        1,
        "running",
        undefined,
        "ce-1",
        () => Effect.void,
      ),
    );

    expect(result.waitOutcome).toBe("running");
    expect(calls).toBeGreaterThan(1);
  });

  // A fast run can already be SUCCEEDED by the first poll. Terminal-status
  // handling must not treat that as a failure just because we only waited
  // for the run to start.
  it("passes running wait when the workflow already succeeded", async () => {
    const http = new MockHttpClient().when(
      "/workflow/wf-1",
      () => new MockHttpResponse({ statusCode: 200, headers: {} }, describeSucceeded),
    );
    const client = testClient(http);

    const result = await Effect.runPromise(
      monitorWorkflow(
        client,
        "https://api.example.com",
        "wf-1",
        1,
        "running",
        undefined,
        "ce-1",
        () => Effect.void,
      ),
    );

    expect(result.waitOutcome).toBe("running");
  });
  it("decodes in-flight describe payloads with null error fields", async () => {
    let calls = 0;
    const http = new MockHttpClient().when("/workflow/wf-1", () => {
      calls += 1;
      const body = calls === 1 ? describeSubmittedWithNulls : describeRunning;
      return new MockHttpResponse({ statusCode: 200, headers: {} }, body);
    });
    const client = testClient(http);

    const result = await Effect.runPromise(
      monitorWorkflow(
        client,
        "https://api.example.com",
        "wf-1",
        1,
        "running",
        undefined,
        "ce-1",
        () => Effect.void,
      ),
    );

    expect(result.waitOutcome).toBe("running");
  });

  it("fails completion wait on terminal failure", async () => {
    const http = new MockHttpClient().when(
      "/workflow/wf-1",
      () => new MockHttpResponse({ statusCode: 200, headers: {} }, describeFailed),
    );
    const client = testClient(http);

    await expect(
      Effect.runPromise(
        monitorWorkflow(
          client,
          "https://api.example.com",
          "wf-1",
          1,
          "completion",
          undefined,
          "ce-1",
        ),
      ),
    ).rejects.toMatchObject({ _tag: "WorkflowTerminalFailureError" });
  });
});
