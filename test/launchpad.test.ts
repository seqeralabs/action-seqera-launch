import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { overlayLaunch, savedToRequest } from "../src/action/overlay.js";
import { runAction } from "../src/action/run.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";
import type { SavedLaunch } from "../src/api/launchpad.js";
import type { ListComputeEnvsResponseEntry } from "../src/api/schemas/compute-env.js";

function response(body: string, statusCode = 200) {
  return new MockHttpResponse({ statusCode, headers: {} }, body);
}

function launchFixture(
  saved: SavedLaunch,
  computeEnvs: ListComputeEnvsResponseEntry[],
  createStatus?: 200 | 409,
) {
  const launches: unknown[] = [];
  const creates: unknown[] = [];
  let listings = 0;
  const http = new MockHttpClient()
    .when(/\/pipelines\?.*search=/u, () => {
      listings += 1;
      return response(
        JSON.stringify({
          pipelines:
            createStatus !== undefined && listings === 1 ? [] : [{ name: "demo", pipelineId: 42 }],
          totalSize: createStatus !== undefined && listings === 1 ? 0 : 1,
        }),
      );
    })
    .when("/pipelines/42/launch", () => response(JSON.stringify({ launch: saved })))
    .when("/pipelines", (_url, _method, body) => {
      creates.push(JSON.parse(body ?? "{}"));
      return response('{"pipeline":{"pipelineId":42,"version":{"id":"v-new"}}}', createStatus);
    })
    .when("/compute-envs", () => response(JSON.stringify({ computeEnvs })))
    .when("/workflow/launch", (_url, _method, body) => {
      launches.push(JSON.parse(body ?? "{}"));
      return response('{"workflowId":"wf-1"}');
    })
    .when("/workflow/wf-1", () => response('{"workflow":{"id":"wf-1","status":"SUBMITTED"}}'));
  return { http, launches, creates };
}

describe("Launchpad overlay", () => {
  it("maps the saved compute environment and keeps unset inputs from the saved launch", () => {
    const base = savedToRequest({
      id: "saved-launch",
      computeEnv: { id: "ce-saved" },
      workDir: "s3://saved/work",
      revision: "v1.0.0",
      configProfiles: ["test"],
      optimizationId: "optimized",
      optimizationTargets: "cpu,memory",
      pipelineSchemaId: 17,
    });

    expect(base).toEqual({
      id: "saved-launch",
      computeEnvId: "ce-saved",
      workDir: "s3://saved/work",
      revision: "v1.0.0",
      configProfiles: ["test"],
      optimizationId: "optimized",
      optimizationTargets: "cpu,memory",
      pipelineSchemaId: 17,
    });
    expect(overlayLaunch(base, { revision: "abc123" }).launch).toEqual({
      ...base,
      revision: "abc123",
    });
  });

  it("appends config and merges parameters, with action values winning", () => {
    const { launch: merged, warnings } = overlayLaunch(
      {
        configText: "plugins { id 'nf-snapshot' }",
        paramsText: "input: saved.csv\ngenome: hg38\n",
      },
      { configText: "process.cpus = 2", paramsText: '{"input":"ci.csv"}' },
    );

    expect(merged.configText).toBe("plugins { id 'nf-snapshot' }\nprocess.cpus = 2");
    expect(JSON.parse(merged.paramsText ?? "")).toEqual({ input: "ci.csv", genome: "hg38" });
    expect(warnings).toEqual([]);
  });

  it("warns and uses the action's parameters when saved parameters are not a map", () => {
    const { launch, warnings } = overlayLaunch(
      { paramsText: "- not\n- a map" },
      { paramsText: '{"input":"ci.csv"}' },
    );

    expect(launch.paramsText).toBe('{"input":"ci.csv"}');
    expect(warnings).toHaveLength(1);
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
    "INPUT_COMPUTE-ENV": "",
    "INPUT_COMPUTE-ENV-ID": "",
    "INPUT_WORK-DIR": "",
    INPUT_PARAMETERS: "",
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

  it("uses the saved compute environment's default when its launch has no work directory", async () => {
    const fixture = launchFixture({ id: "saved-launch", computeEnv: { id: "ce-saved" } }, [
      { id: "ce-saved", name: "saved", workDir: "s3://default/work" },
    ]);
    await Effect.runPromise(runAction(fixture.http));
    expect(fixture.launches).toEqual([
      {
        launch: expect.objectContaining({ computeEnvId: "ce-saved", workDir: "s3://default/work" }),
      },
    ]);
  });

  it("fails when the saved environment has no saved or default work directory", async () => {
    const fixture = launchFixture({ id: "saved-launch", computeEnv: { id: "ce-saved" } }, [
      { id: "ce-saved", name: "saved" },
    ]);
    await expect(Effect.runPromise(runAction(fixture.http))).rejects.toMatchObject({
      _tag: "WorkDirMissingError",
    });
    expect(fixture.launches).toEqual([]);
  });

  it.each([undefined, "gs://new/work"])(
    "does not reuse the old directory when named compute changes (default %s)",
    async (workDir) => {
      process.env["INPUT_COMPUTE-ENV"] = "new";
      const computeEnv: ListComputeEnvsResponseEntry =
        workDir === undefined
          ? { id: "ce-new", name: "new" }
          : { id: "ce-new", name: "new", workDir };
      const fixture = launchFixture(
        { id: "saved-launch", computeEnv: { id: "ce-saved" }, workDir: "s3://old/work" },
        [computeEnv],
      );
      if (workDir === undefined) {
        await expect(Effect.runPromise(runAction(fixture.http))).rejects.toMatchObject({
          _tag: "WorkDirMissingError",
        });
        expect(fixture.launches).toEqual([]);
      } else {
        await Effect.runPromise(runAction(fixture.http));
        expect(fixture.launches).toEqual([
          { launch: expect.objectContaining({ computeEnvId: "ce-new", workDir }) },
        ]);
      }
    },
  );

  it("keeps an explicit work directory when changing named compute", async () => {
    process.env["INPUT_COMPUTE-ENV"] = "new";
    process.env["INPUT_WORK-DIR"] = "gs://explicit/work";
    const fixture = launchFixture(
      { id: "saved-launch", computeEnv: { id: "ce-saved" }, workDir: "s3://old/work" },
      [{ id: "ce-new", name: "new" }],
    );
    await Effect.runPromise(runAction(fixture.http));
    expect(fixture.launches).toEqual([
      {
        launch: expect.objectContaining({ computeEnvId: "ce-new", workDir: "gs://explicit/work" }),
      },
    ]);
  });

  it("overlays a concurrent creation winner before launching, including compute defaults", async () => {
    process.env.INPUT_PARAMETERS = "input: ci.csv";
    process.env.INPUT_REVISION = "";
    const fixture = launchFixture(
      {
        id: "winner-launch",
        revision: "saved-revision",
        computeEnv: { id: "ce-saved" },
        configText: "plugins { id 'nf-snapshot' }",
        paramsText: "input: saved.csv\ngenome: hg38",
        userSecrets: ["user-secret"],
        workspaceSecrets: ["workspace-secret"],
        optimizationId: "optimized",
      },
      [
        { id: "ce-primary", name: "primary", primary: true, workDir: "s3://primary/work" },
        { id: "ce-saved", name: "saved", workDir: "s3://saved/work" },
      ],
      409,
    );
    await Effect.runPromise(runAction(fixture.http));
    expect(fixture.creates).toHaveLength(1);
    expect(fixture.launches).toEqual([
      {
        launch: {
          id: "winner-launch",
          computeEnvId: "ce-saved",
          workDir: "s3://saved/work",
          pipeline: "https://github.com/org/repo",
          revision: "saved-revision",
          configText: "plugins { id 'nf-snapshot' }\nprocess.cpus = 2",
          paramsText: JSON.stringify({ input: "ci.csv", genome: "hg38" }),
          userSecrets: ["user-secret"],
          workspaceSecrets: ["workspace-secret"],
          optimizationId: "optimized",
        },
      },
    ]);
  });

  it("takes an explicit compute id on trust without requiring a work directory", async () => {
    process.env["INPUT_COMPUTE-ENV-ID"] = "ce-explicit";
    const fixture = launchFixture({ id: "saved-launch" }, []);
    await Effect.runPromise(runAction(fixture.http));
    expect(fixture.launches).toEqual([
      {
        launch: {
          id: "saved-launch",
          computeEnvId: "ce-explicit",
          pipeline: "https://github.com/org/repo",
          revision: "abc123",
          configText: "process.cpus = 2",
        },
      },
    ]);
  });

  it("drops the saved work directory when an explicit compute id replaces the saved one", async () => {
    process.env["INPUT_COMPUTE-ENV-ID"] = "ce-explicit";
    const fixture = launchFixture(
      { id: "saved-launch", computeEnv: { id: "ce-saved" }, workDir: "s3://old/work" },
      [],
    );
    await Effect.runPromise(runAction(fixture.http));
    expect(fixture.launches).toEqual([
      { launch: expect.not.objectContaining({ workDir: expect.anything() }) },
    ]);
    expect(fixture.launches).toEqual([
      { launch: expect.objectContaining({ computeEnvId: "ce-explicit" }) },
    ]);
  });

  it("does not append action configuration twice after a successful creation", async () => {
    const fixture = launchFixture(
      { id: "created-launch", configText: "process.cpus = 2" },
      [{ id: "ce-primary", name: "primary", primary: true, workDir: "s3://primary/work" }],
      200,
    );
    await Effect.runPromise(runAction(fixture.http));
    expect(fixture.creates).toHaveLength(1);
    expect(fixture.launches).toEqual([
      { launch: expect.objectContaining({ id: "created-launch", configText: "process.cpus = 2" }) },
    ]);
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
              outputDir: null,
              launchContainer: "custom/launch:1",
              optimizationId: "optimized",
              optimizationTargets: "cpu,memory",
              pipelineSchemaId: 17,
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
        optimizationId: "optimized",
        optimizationTargets: "cpu,memory",
        pipelineSchemaId: 17,
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
