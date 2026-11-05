import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { overlayLaunch, savedToRequest } from "../src/action/launchpad.js";
import { runAction } from "../src/action/run.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

describe("Launchpad overlay", () => {
  it("maps the saved compute environment and keeps unset inputs from the saved launch", () => {
    const base = savedToRequest({
      id: "saved-launch",
      computeEnv: { id: "ce-saved" },
      workDir: "s3://saved/work",
      revision: "v1.0.0",
      configProfiles: ["test"],
      outputDir: null,
    });

    expect(base).toEqual({
      id: "saved-launch",
      computeEnvId: "ce-saved",
      workDir: "s3://saved/work",
      revision: "v1.0.0",
      configProfiles: ["test"],
    });
    expect(overlayLaunch(base, { revision: "abc123" })).toEqual({ ...base, revision: "abc123" });
  });

  it("appends config and merges parameters, with action values winning", () => {
    const merged = overlayLaunch(
      {
        configText: "plugins { id 'nf-snapshot' }",
        paramsText: "input: saved.csv\ngenome: hg38\n",
      },
      { configText: "process.cpus = 2", paramsText: '{"input":"ci.csv"}' },
    );

    expect(merged.configText).toBe("plugins { id 'nf-snapshot' }\nprocess.cpus = 2");
    expect(JSON.parse(merged.paramsText ?? "")).toEqual({ input: "ci.csv", genome: "hg38" });
  });
});

describe("runAction with a Launchpad pipeline", () => {
  const env = {
    "INPUT_ACCESS-TOKEN": "token",
    "INPUT_API-ENDPOINT": "https://api.example.com",
    "INPUT_WORKSPACE-ID": "123",
    "INPUT_LAUNCHPAD-NAME": "demo",
    INPUT_PIPELINE: "https://github.com/org/repo",
    INPUT_REVISION: "abc123",
    "INPUT_NEXTFLOW-CONFIG": "process.cpus = 2",
    INPUT_WAIT: "none",
  };
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [key, value] of Object.entries(env)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previous.clear();
  });

  it("launches the saved entry with action inputs overlaid and never writes to it", async () => {
    const calls: string[] = [];
    let launchBody: unknown;
    const http = new MockHttpClient()
      .when("/compute-envs", (url, method) => {
        calls.push(`${method} ${url}`);
        return new MockHttpResponse({ statusCode: 200, headers: {} }, '{"computeEnvs":[]}');
      })
      .when(/\/pipelines\?.*search=/u, (url, method) => {
        calls.push(`${method} ${url}`);
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"pipelines":[{"name":"demo","pipelineId":42}],"totalSize":1}',
        );
      })
      .when("/pipelines/42/launch", (url, method) => {
        calls.push(`${method} ${url}`);
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          JSON.stringify({
            launch: {
              id: "saved-launch",
              computeEnv: { id: "ce-saved" },
              pipeline: "https://github.com/org/repo",
              workDir: "s3://saved/work",
              revision: "v1.0.0",
              configText: "plugins { id 'nf-snapshot' }",
              sessionId: "old-session",
            },
          }),
        );
      })
      .when("/workflow/launch", (url, method, body) => {
        calls.push(`${method} ${url}`);
        launchBody = JSON.parse(body ?? "{}");
        return new MockHttpResponse({ statusCode: 200, headers: {} }, '{"workflowId":"wf-1"}');
      })
      .when("/workflow/wf-1", (url, method) => {
        calls.push(`${method} ${url}`);
        return new MockHttpResponse(
          { statusCode: 200, headers: {} },
          '{"orgName":"org","workspaceName":"ws","workflow":{"id":"wf-1","status":"SUBMITTED"}}',
        );
      });

    await Effect.runPromise(runAction(http));

    expect(launchBody).toEqual({
      launch: {
        id: "saved-launch",
        computeEnvId: "ce-saved",
        pipeline: "https://github.com/org/repo",
        workDir: "s3://saved/work",
        revision: "abc123",
        configText: "plugins { id 'nf-snapshot' }\nprocess.cpus = 2",
      },
    });
    expect(calls.some((call) => call.includes("/compute-envs"))).toBe(false);
    expect(
      calls.filter(
        (call) => call.startsWith("PUT") || call.includes("POST https://api.example.com/pipelines"),
      ),
    ).toEqual([]);
  });
});
