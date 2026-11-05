import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createSeqeraClient } from "../src/api/client.js";
import { createWorkflowLaunch, listComputeEnvs } from "../src/api/endpoints.js";
import { createLaunchpadPipeline, findLaunchpadLaunch } from "../src/api/launchpad.js";
import { DescribeWorkflowResponseSchema } from "../src/api/schemas/workflow.js";
import {
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  LaunchValidationError,
} from "../src/errors.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

describe("API endpoints", () => {
  it("reads an existing Launchpad pipeline without writing to it", async () => {
    const methods: string[] = [];
    const http = new MockHttpClient()
      .when("/pipelines/42/launch", (url, method) => {
        methods.push(method);
        expect(url).not.toContain("versionId");
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          JSON.stringify({
            launch: {
              id: "saved-launch",
              computeEnv: { id: "ce-saved", name: "saved" },
              configText: "plugins { id 'nf-snapshot' }",
              commitId: "pinned",
            },
          }),
        );
      })
      .when(/\/pipelines\?.*search=/u, (_url, method) => {
        methods.push(method);
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"pipelines":[{"name":"demo-old","pipelineId":7},{"name":"demo","pipelineId":42}],"totalSize":2}',
        );
      });
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    const saved = await Effect.runPromise(findLaunchpadLaunch(client, 123, "demo"));

    expect(saved).toMatchObject({
      id: "saved-launch",
      computeEnv: { id: "ce-saved" },
      configText: "plugins { id 'nf-snapshot' }",
    });
    expect(saved).not.toHaveProperty("commitId");
    expect(methods).toEqual(["GET", "GET"]);
  });

  it("returns undefined when no Launchpad pipeline matches the name exactly", async () => {
    const http = new MockHttpClient().when(
      /\/pipelines\?.*search=/u,
      () =>
        new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"pipelines":[{"name":"demo-old","pipelineId":7}],"totalSize":1}',
        ),
    );
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    expect(await Effect.runPromise(findLaunchpadLaunch(client, 123, "demo"))).toBeUndefined();
  });

  it("creates a Launchpad pipeline and reads back the created version", async () => {
    const requests: RecordedRequest[] = [];
    const http = new MockHttpClient()
      .when("/pipelines/17/launch", (url, method) => {
        requests.push({ url, method, body: undefined });
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"launch":{"id":"saved-launch"}}',
        );
      })
      .when("/pipelines", (url, method, body) => {
        requests.push({ url, method, body: JSON.parse(body ?? "{}") });
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"pipeline":{"pipelineId":17,"version":{"id":"v-new"}}}',
        );
      });
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    const saved = await Effect.runPromise(
      createLaunchpadPipeline(client, 123, "demo", { pipeline: "https://example.com/repo" }),
    );

    expect(saved).toEqual({ _tag: "Created", launchId: "saved-launch" });
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
    expect(requests[0]?.body).toEqual({
      name: "demo",
      launch: { pipeline: "https://example.com/repo" },
    });
    expect(requests[1]?.url).toContain("versionId=v-new");
  });

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

  it("launches the winner when another job creates the pipeline first", async () => {
    let listings = 0;
    const methods: string[] = [];
    const http = new MockHttpClient()
      .when(/\/pipelines\?.*search=/u, (_url, method) => {
        methods.push(method);
        listings += 1;
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          JSON.stringify({ pipelines: [{ name: "demo", pipelineId: 42 }], totalSize: 1 }),
        );
      })
      .when("/pipelines/42/launch", (_url, method) => {
        methods.push(method);
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"launch":{"id":"winner-launch"}}',
        );
      })
      .when("/pipelines", (_url, method) => {
        methods.push(method);
        return new MockHttpResponse({ statusCode: 409, headers: {} }, '{"message":"Duplicate"}');
      });
    const client = createSeqeraClient(
      { baseUrl: "https://api.example.com", accessToken: "token" },
      http,
    );

    const saved = await Effect.runPromise(
      createLaunchpadPipeline(client, 123, "demo", { pipeline: "repo" }),
    );

    expect(saved).toEqual({ _tag: "Existing", launch: { id: "winner-launch" } });
    expect(listings).toBe(1);
    expect(methods).toEqual(["POST", "GET", "GET"]);
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
