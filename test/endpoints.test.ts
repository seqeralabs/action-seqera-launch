import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createSeqeraClient } from "../src/api/client.js";
import { createWorkflowLaunch, listComputeEnvs } from "../src/api/endpoints.js";
import { DescribeWorkflowResponseSchema } from "../src/api/schemas/workflow.js";
import {
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  LaunchValidationError,
} from "../src/errors.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

describe("API endpoints", () => {
  it("flattens validation errors from launch 400 responses", async () => {
    const http = new MockHttpClient().when(
      "/workflow/launch",
      () =>
        new MockHttpResponse(
          { statusCode: 400, headers: {} },
          JSON.stringify({
            message: "Launch blocked",
            errors: [{ code: "COMPUTE_ENV_INVALID", message: "Bad compute env" }],
          }),
        ),
    );
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    await expect(
      Effect.runPromise(createWorkflowLaunch(client, undefined, { pipeline: "repo" })),
    ).rejects.toMatchObject({
      _tag: "LaunchValidationError",
      message: expect.stringContaining("Bad compute env"),
    } satisfies Partial<LaunchValidationError>);
  });

  it("reports missing compute environments by name", async () => {
    const http = new MockHttpClient().when(
      "/compute-envs",
      () =>
        new MockHttpResponse(
          { statusCode: 200, headers: {} },
          JSON.stringify({ computeEnvs: [{ id: "1", name: "other" }] }),
        ),
    );
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    await expect(
      Effect.runPromise(
        listComputeEnvs(client, undefined).pipe(
          Effect.flatMap((response) => {
            const matches = (response.computeEnvs ?? []).filter(
              (entry) => entry.name === "missing",
            );
            if (matches.length === 0) {
              return Effect.fail(
                new ComputeEnvNotFoundError({
                  name: "missing",
                  available: (response.computeEnvs ?? []).map((entry) => entry.name),
                }),
              );
            }
            return Effect.void;
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "ComputeEnvNotFoundError",
      name: "missing",
    } satisfies Partial<ComputeEnvNotFoundError>);
  });

  it("reports ambiguous compute environment matches", async () => {
    const http = new MockHttpClient().when(
      "/compute-envs",
      () =>
        new MockHttpResponse(
          { statusCode: 200, headers: {} },
          JSON.stringify({
            computeEnvs: [
              { id: "1", name: "dup" },
              { id: "2", name: "dup" },
            ],
          }),
        ),
    );
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    await expect(
      Effect.runPromise(
        listComputeEnvs(client, undefined).pipe(
          Effect.flatMap((response) => {
            const matches = (response.computeEnvs ?? []).filter((entry) => entry.name === "dup");
            if (matches.length > 1) {
              return Effect.fail(
                new ComputeEnvAmbiguousError({
                  name: "dup",
                  matches: matches.map((entry) => `${entry.name} (${entry.id})`),
                }),
              );
            }
            return Effect.void;
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "ComputeEnvAmbiguousError",
    } satisfies Partial<ComputeEnvAmbiguousError>);
  });
});

describe("transport retry", () => {
  it("retries transient 502 responses", async () => {
    let attempts = 0;
    const http = new MockHttpClient().when("/workflow/wf-1", () => {
      attempts += 1;
      if (attempts === 1) {
        return new MockHttpResponse({ statusCode: 502, headers: {} }, "bad gateway");
      }
      return new MockHttpResponse(
        { statusCode: 200, headers: {} },
        JSON.stringify({
          orgName: "seqera",
          workspaceName: "demo",
          workflow: { id: "wf-1", status: "RUNNING" },
        }),
      );
    });
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    const result = await Effect.runPromise(
      client.requestJson({ method: "GET", path: "/workflow/wf-1" }, DescribeWorkflowResponseSchema),
    );

    expect(attempts).toBe(2);
    expect(result.workflow?.status).toBe("RUNNING");
  });
});
