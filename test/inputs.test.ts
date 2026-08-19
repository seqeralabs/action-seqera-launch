import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { Effect } from "effect";
import { readActionInputs } from "../src/action/inputs.js";

const INPUT_ENV = {
  "INPUT_ACCESS-TOKEN": "token",
  "INPUT_API-ENDPOINT": "https://api.cloud.seqera.io",
  INPUT_WAIT: "running",
  INPUT_PIPELINE: "https://github.com/org/repo",
  INPUT_PARAMETERS: '{"foo":"bar"}',
  INPUT_PROFILES: "docker,conda",
  "INPUT_LABEL-IDS": "1,2",
  "INPUT_STUB-RUN": "true",
} as const satisfies Record<string, string>;

describe("readActionInputs", () => {
  const previous = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const [key, value] of Object.entries(INPUT_ENV)) {
      previous.set(key, process.env[key]);
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("maps kebab-case inputs to launch request fields", async () => {
    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.accessToken).toBe("token");
    expect(inputs.wait).toBe("running");
    expect(inputs.launch.pipeline).toBe("https://github.com/org/repo");
    expect(inputs.launch.paramsText).toBe('{"foo":"bar"}');
    expect(inputs.launch.configProfiles).toEqual(["docker", "conda"]);
    expect(inputs.launch.labelIds).toEqual([1, 2]);
    expect(inputs.launch.stubRun).toBe(true);
  });

  it("returns a readable URL validation error", async () => {
    process.env["INPUT_API-ENDPOINT"] = "not-a-url";

    await expect(Effect.runPromise(readActionInputs())).rejects.toMatchObject({
      _tag: "InputValidationError",
      input: "api-endpoint",
    });
  });
});
