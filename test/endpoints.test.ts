import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createSeqeraClient } from "../src/api/client.js";
import {
  createWorkflowLaunch,
  listComputeEnvs,
  saveLaunchpadPipeline,
} from "../src/api/endpoints.js";
import { DescribeWorkflowResponseSchema } from "../src/api/schemas/workflow.js";
import {
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  LaunchValidationError,
} from "../src/errors.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

describe("API endpoints", () => {
  it.each([
    { existing: false, method: "POST", pipelineId: 17, versionId: "v-new" },
    { existing: true, method: "PUT", pipelineId: 42, versionId: "v-updated" },
  ])(
    "saves and resolves a Launchpad version ($method)",
    async ({ existing, method, pipelineId, versionId }) => {
      const requests: Array<{ url: string; method: string; body: unknown }> = [];
      const http = new MockHttpClient()
        .when(/\/pipelines\?.*attributes=labels/, (url, requestMethod) => {
          requests.push({ url, method: requestMethod, body: undefined });
          return new MockHttpResponse(
            { statusCode: 200, headers: {} },
            JSON.stringify({
              pipelines: existing
                ? [{ name: "demo", pipelineId, labels: [{ id: 5 }, { id: 6 }] }]
                : [],
              totalSize: existing ? 1 : 0,
            }),
          );
        })
        .when(`/pipelines/${pipelineId}/launch`, (url, requestMethod) => {
          requests.push({ url, method: requestMethod, body: undefined });
          return new MockHttpResponse(
            { statusCode: 200, headers: {} },
            '{"launch":{"id":"saved-launch"}}',
          );
        })
        .when("/pipelines", (url, requestMethod, body) => {
          requests.push({ url, method: requestMethod, body: JSON.parse(body ?? "{}") });
          expect(requestMethod).toBe(method);
          return new MockHttpResponse(
            { statusCode: 200, headers: {} },
            JSON.stringify({ pipeline: { pipelineId, version: { id: versionId } } }),
          );
        });
      const client = createSeqeraClient(
        { baseUrl: "https://api.example.com", accessToken: "token" },
        http,
      );

      const launchId = await Effect.runPromise(
        saveLaunchpadPipeline(client, 123, "demo", { pipeline: "https://example.com/repo" }),
      );

      expect(launchId).toBe("saved-launch");
      expect(requests.map((request) => request.method)).toEqual(["GET", method, "GET"]);
      expect(requests[0]?.url).toContain("attributes=labels");
      expect(requests[1]?.body).toEqual(
        existing
          ? { launch: { pipeline: "https://example.com/repo" }, labelIds: [5, 6] }
          : { name: "demo", launch: { pipeline: "https://example.com/repo" } },
      );
      expect(requests[2]?.url).toContain(`versionId=${versionId}`);
    },
  );

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

  it("does not update a pipeline when its labels cannot be read", async () => {
    const http = new MockHttpClient().when(
      /\/pipelines\?.*attributes=labels/u,
      () =>
        new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"pipelines":[{"name":"demo","pipelineId":42}],"totalSize":1}',
        ),
    );
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    await expect(
      Effect.runPromise(saveLaunchpadPipeline(client, 123, "demo", { pipeline: "repo" })),
    ).rejects.toMatchObject({ _tag: "ApiDecodeError" });
  });

  it("updates the winner when another job creates the pipeline first", async () => {
    let listings = 0;
    const methods: string[] = [];
    const http = new MockHttpClient()
      .when(/\/pipelines\?.*attributes=labels/u, (_url, method) => {
        methods.push(method);
        listings += 1;
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          JSON.stringify({
            pipelines: listings === 1 ? [] : [{ name: "demo", pipelineId: 42, labels: null }],
            totalSize: listings === 1 ? 0 : 1,
          }),
        );
      })
      .when("/pipelines/42/launch", (_url, method) => {
        methods.push(method);
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"launch":{"id":"saved-launch"}}',
        );
      })
      .when("/pipelines", (_url, method) => {
        methods.push(method);
        return new MockHttpResponse(
          { statusCode: method === "POST" ? 409 : 200, headers: {} },
          method === "POST"
            ? '{"message":"Duplicate"}'
            : '{"pipeline":{"pipelineId":42,"version":{"id":"v2"}}}',
        );
      });
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    expect(
      await Effect.runPromise(saveLaunchpadPipeline(client, 123, "demo", { pipeline: "repo" })),
    ).toBe("saved-launch");
    expect(methods).toEqual(["GET", "POST", "GET", "PUT", "GET"]);
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
