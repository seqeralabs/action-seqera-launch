import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { createSeqeraClient } from "../src/api/client.js";
import { resolveComputeEnv } from "../src/action/run.js";
import { MockHttpClient, MockHttpResponse } from "./helpers/mock-http.js";

function testClient(http: MockHttpClient) {
  return createSeqeraClient({ baseUrl: "https://api.example.com", accessToken: "token" }, http);
}

function listing(entries: unknown[]) {
  const http = new MockHttpClient().when(
    "/compute-envs",
    () =>
      new MockHttpResponse(
        { statusCode: 200, headers: {} },
        JSON.stringify({ computeEnvs: entries }),
      ),
  );
  return testClient(http);
}

describe("resolveComputeEnv", () => {
  it("returns the named environment's work directory", async () => {
    const client = listing([
      { id: "ce-1", name: "other", status: "AVAILABLE", workDir: "s3://other" },
      { id: "ce-2", name: "target", status: "AVAILABLE", workDir: "s3://target" },
    ]);

    const resolved = await Effect.runPromise(resolveComputeEnv(client, 1, undefined, "target"));

    expect(resolved.computeEnvId).toBe("ce-2");
    expect(resolved.workDir).toBe("s3://target");
  });

  it("selects the primary environment when no name is given", async () => {
    const client = listing([
      { id: "ce-1", name: "other", status: "AVAILABLE", workDir: "s3://other" },
      { id: "ce-2", name: "main", status: "AVAILABLE", workDir: "s3://main", primary: true },
    ]);

    const resolved = await Effect.runPromise(resolveComputeEnv(client, 1, undefined, undefined));

    expect(resolved.computeEnvId).toBe("ce-2");
    expect(resolved.workDir).toBe("s3://main");
  });

  // The API answers an empty 403 in this case, so the action has to explain it.
  it("fails when no name is given and the workspace has no primary", async () => {
    const client = listing([{ id: "ce-1", name: "other", status: "AVAILABLE" }]);

    await expect(
      Effect.runPromise(resolveComputeEnv(client, 1, undefined, undefined)),
    ).rejects.toMatchObject({ _tag: "ComputeEnvNoPrimaryError" });
  });

  it("rejects an environment that is not available", async () => {
    const client = listing([{ id: "ce-1", name: "broken", status: "INVALID" }]);

    await expect(
      Effect.runPromise(resolveComputeEnv(client, 1, undefined, "broken")),
    ).rejects.toMatchObject({ _tag: "ComputeEnvUnavailableError", status: "INVALID" });
  });

  it("reports available names when the environment is missing", async () => {
    const client = listing([{ id: "ce-1", name: "other", status: "AVAILABLE" }]);

    await expect(
      Effect.runPromise(resolveComputeEnv(client, 1, undefined, "absent")),
    ).rejects.toMatchObject({ _tag: "ComputeEnvNotFoundError", available: ["other"] });
  });

  it("trusts an explicit id without listing environments", async () => {
    const http = new MockHttpClient().when("/compute-envs", () => {
      throw new Error("should not list compute environments");
    });

    const resolved = await Effect.runPromise(
      resolveComputeEnv(testClient(http), 1, "ce-explicit", undefined),
    );

    expect(resolved.computeEnvId).toBe("ce-explicit");
    expect(resolved.workDir).toBeUndefined();
  });
});
