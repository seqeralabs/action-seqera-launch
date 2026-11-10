import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStudioAction } from "../src/action/studio.js";
import { formatActionError } from "../src/errors.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

const COMMIT = "846c0ffee1234567890abcdef1234567890abcde";

const env = {
  "INPUT_ACCESS-TOKEN": "token",
  "INPUT_API-ENDPOINT": "https://api.example.com",
  "INPUT_WORKSPACE-ID": "123",
  "INPUT_COMPUTE-ENV": "studio-ce",
  "INPUT_COMPUTE-ENV-ID": "",
  INPUT_NAME: "",
  INPUT_REPOSITORY: "https://github.com/org/repo",
  INPUT_REVISION: "feature",
  "INPUT_COMMIT-ID": COMMIT,
  "INPUT_TOOL-URL": "",
  "INPUT_AUTO-START": "true",
  INPUT_WAIT: "running",
  INPUT_TIMEOUT: "",
  GITHUB_REPOSITORY: "org/repo",
};

interface StudioBody {
  readonly sessionId: string;
  readonly name: string;
  readonly studioUrl: string;
  readonly remoteConfig: { readonly repository: string; readonly commitId: string };
  readonly statusInfo: { readonly status: string; readonly message: string | null };
  readonly waveBuildUrl: string | null;
}

function studio(status: string, extra: Partial<StudioBody> = {}): StudioBody {
  return {
    sessionId: "sess-1",
    name: "repo-846c0ff",
    studioUrl: "https://asess-1.connect.example.com",
    remoteConfig: { repository: "https://github.com/org/repo", commitId: COMMIT },
    statusInfo: { status, message: null },
    waveBuildUrl: null,
    ...extra,
  };
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: string | undefined;
}

function respond(body: string, statusCode = 200) {
  return new MockHttpResponse({ statusCode, headers: {} }, body);
}

function fixture(options: {
  existing?: StudioBody[];
  createStatus?: number;
  created?: StudioBody;
  describes?: StudioBody[];
}) {
  const calls: Call[] = [];
  let lists = 0;
  const describes = [...(options.describes ?? [])];
  const http = new MockHttpClient()
    .when("/compute-envs", () =>
      respond('{"computeEnvs":[{"id":"ce-1","name":"studio-ce","status":"AVAILABLE"}]}'),
    )
    .when("/studios/sess-1", (url, method) => {
      calls.push({ method, url, body: undefined });
      if (url.includes("/start")) {
        return respond(
          '{"jobSubmitted":true,"sessionId":"sess-1","statusInfo":{"status":"starting"}}',
        );
      }
      return respond(JSON.stringify(describes.shift()));
    })
    .when("/studios?", (url, method, body) => {
      calls.push({ method, url, body });
      if (method === "POST") {
        const status = options.createStatus ?? 200;
        return status === 200
          ? respond(JSON.stringify({ studio: options.created ?? studio("starting") }))
          : respond('{"message":"conflict"}', status);
      }
      lists += 1;
      // The first listing is the pre-create lookup; later ones follow a 409.
      const found = lists === 1 ? (options.existing ?? []) : [studio("building")];
      return respond(JSON.stringify({ studios: found, totalSize: found.length }));
    });
  return { http, calls };
}

const noSleep = () => Effect.void;

// core.setOutput appends `name<<delimiter\nvalue\ndelimiter` to GITHUB_OUTPUT.
function readOutputs(path: string) {
  const pattern = /^(.+?)<<(ghadelimiter_[^\n]+)\n([\s\S]*?)\n\2$/gmu;
  return Object.fromEntries(
    [...readFileSync(path, "utf8").matchAll(pattern)].map((match) => [match[1], match[3]]),
  );
}

describe("runStudioAction", () => {
  const previous = new Map<string, string | undefined>();
  let outputPath = "";

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "studio-"));
    outputPath = join(dir, "output");
    writeFileSync(outputPath, "");
    const summaryPath = join(dir, "summary");
    writeFileSync(summaryPath, "");
    const all = { ...env, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath };
    for (const [key, value] of Object.entries(all)) {
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

  it("creates a studio from the commit in the resolved compute environment", async () => {
    process.env["INPUT_WAIT"] = "none";
    const { http, calls } = fixture({});
    await Effect.runPromise(runStudioAction(http, noSleep));

    const create = calls.find((call) => call.method === "POST");
    expect(create?.url).toContain("autoStart=true");
    expect(create?.url).toContain("workspaceId=123");
    expect(JSON.parse(create?.body ?? "{}")).toEqual({
      name: "repo-846c0ff",
      computeEnvId: "ce-1",
      remoteConfig: {
        repository: "https://github.com/org/repo",
        revision: "feature",
        commitId: COMMIT,
      },
    });
  });

  it("reuses an existing studio with the same name without creating one", async () => {
    const { http, calls } = fixture({ existing: [studio("running")] });
    await Effect.runPromise(runStudioAction(http, noSleep));

    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
    expect(readOutputs(outputPath)["studio-id"]).toBe("sess-1");
  });

  it("restarts a reused studio that has stopped and waits for it to run", async () => {
    const { http, calls } = fixture({
      existing: [studio("stopped")],
      describes: [studio("running")],
    });
    await Effect.runPromise(runStudioAction(http, noSleep));

    expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
      "GET /studios",
      "POST /studios/sess-1/start",
      "GET /studios/sess-1",
    ]);
    expect(readOutputs(outputPath)["status"]).toBe("running");
  });

  it("re-finds the studio when another job wins the create race", async () => {
    process.env["INPUT_WAIT"] = "none";
    const { http, calls } = fixture({ createStatus: 409 });
    await Effect.runPromise(runStudioAction(http, noSleep));

    expect(calls.map((call) => call.method)).toEqual(["GET", "POST", "GET"]);
    expect(readOutputs(outputPath)["status"]).toBe("building");
  });

  it("polls a building studio until it runs and sets its outputs", async () => {
    const { http, calls } = fixture({
      created: studio("building"),
      describes: [studio("building"), studio("running")],
    });
    await Effect.runPromise(runStudioAction(http, noSleep));

    expect(calls.filter((call) => call.url.includes("/studios/sess-1"))).toHaveLength(2);
    expect(readOutputs(outputPath)).toEqual({
      "studio-id": "sess-1",
      "studio-url": "https://asess-1.connect.example.com",
      status: "running",
      "workspace-id": "123",
    });
  });

  it("fails with the build log when the image build fails, after setting outputs", async () => {
    const failed = studio("buildFailed", {
      statusInfo: { status: "buildFailed", message: "conda solve failed" },
      waveBuildUrl: "https://wave.example.com/view/builds/b-1",
    });
    const { http } = fixture({ describes: [failed] });
    const error = await Effect.runPromise(Effect.flip(runStudioAction(http, noSleep)));

    const message = formatActionError(error);
    expect(message).toContain("buildFailed");
    expect(message).toContain("conda solve failed");
    expect(message).toContain("https://wave.example.com/view/builds/b-1");
    expect(readOutputs(outputPath)["status"]).toBe("buildFailed");
  });

  it.each([
    ["INPUT_WAIT", "none"],
    ["INPUT_AUTO-START", "false"],
  ])("makes no describe call when %s is %s", async (key, value) => {
    process.env[key] = value;
    const { http, calls } = fixture({});
    await Effect.runPromise(runStudioAction(http, noSleep));

    expect(calls.filter((call) => call.url.includes("/studios/sess-1"))).toEqual([]);
    expect(calls.find((call) => call.method === "POST")?.url).toContain(
      `autoStart=${key === "INPUT_AUTO-START" ? "false" : "true"}`,
    );
  });
});
