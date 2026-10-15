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
  const inputPrefix = "INPUT_";

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(inputPrefix)) {
        previous.set(key, process.env[key]);
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(INPUT_ENV)) {
      process.env[key] = value;
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith(inputPrefix)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    previous.clear();
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

  it("preserves valid integers and list separators", async () => {
    process.env["INPUT_WORKSPACE-ID"] = " 9007199254740991 ";
    process.env["INPUT_HEAD-JOB-CPUS"] = "02";
    process.env["INPUT_HEAD-JOB-MEMORY-MB"] = "+4096";
    process.env["INPUT_LABEL-IDS"] = "1, 2\n9007199254740991\n";

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.workspaceId).toBe(Number.MAX_SAFE_INTEGER);
    expect(inputs.launch.headJobCpus).toBe(2);
    expect(inputs.launch.headJobMemoryMb).toBe(4096);
    expect(inputs.launch.labelIds).toEqual([1, 2, Number.MAX_SAFE_INTEGER]);
  });

  it.each(["workspace-id", "head-job-cpus", "head-job-memory-mb", "label-ids"])(
    "rejects malformed and unsafe integers in %s",
    async (input) => {
      for (const value of [
        "123oops",
        "2.5",
        "abc",
        "9007199254740992",
        "1e3",
        "0x10",
        "Infinity",
      ]) {
        process.env[`INPUT_${input.toUpperCase()}`] = value;

        await expect(Effect.runPromise(readActionInputs())).rejects.toMatchObject({
          _tag: "InputValidationError",
          input,
          message: `must be a safe integer, got '${value}'`,
        });
      }
    },
  );

  it.each(["1,abc", "1\n2.5", "1,9007199254740992"])(
    "rejects a malformed item in label-ids (%s)",
    async (value) => {
      process.env["INPUT_LABEL-IDS"] = value;

      await expect(Effect.runPromise(readActionInputs())).rejects.toMatchObject({
        _tag: "InputValidationError",
        input: "label-ids",
      });
    },
  );

  it.each([undefined, "", "   "])("omits unset integer inputs (%s)", async (value) => {
    for (const input of ["WORKSPACE-ID", "HEAD-JOB-CPUS", "HEAD-JOB-MEMORY-MB", "LABEL-IDS"]) {
      if (value === undefined) {
        delete process.env[`INPUT_${input}`];
      } else {
        process.env[`INPUT_${input}`] = value;
      }
    }

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.workspaceId).toBeUndefined();
    expect(inputs.launch).not.toHaveProperty("headJobCpus");
    expect(inputs.launch).not.toHaveProperty("headJobMemoryMb");
    expect(inputs.launch).not.toHaveProperty("labelIds");
  });

  it.each(["v1", "v2"])("selects the %s Nextflow parser", async (parser) => {
    process.env["INPUT_SYNTAX-PARSER"] = parser;
    process.env["INPUT_PRE-RUN-SCRIPT"] = "echo setup";

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.launch.syntaxParser).toBe(parser);
    expect(inputs.launch.preRunScript).toBe("echo setup");
  });

  it.each([undefined, "", "   "])("omits an unset parser (%s)", async (parser) => {
    if (parser !== undefined) {
      process.env["INPUT_SYNTAX-PARSER"] = parser;
    }

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.launch).not.toHaveProperty("syntaxParser");
  });

  it.each(["v3", "V2", "true"])("rejects invalid parser %s", async (parser) => {
    process.env["INPUT_SYNTAX-PARSER"] = parser;

    await expect(Effect.runPromise(readActionInputs())).rejects.toMatchObject({
      _tag: "InputValidationError",
      input: "syntax-parser",
      message: `must be one of v1, v2; got '${parser}'`,
    });
  });

  it("returns a readable URL validation error", async () => {
    process.env["INPUT_API-ENDPOINT"] = "not-a-url";

    await expect(Effect.runPromise(readActionInputs())).rejects.toMatchObject({
      _tag: "InputValidationError",
      input: "api-endpoint",
    });
  });

  it("parses timeout durations", async () => {
    process.env.INPUT_TIMEOUT = "90m";

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.timeoutMs).toBe(90 * 60_000);
  });

  it("accepts newline-separated lists as well as commas", async () => {
    process.env.INPUT_PROFILES = "docker\nconda\n";
    process.env["INPUT_LABEL-IDS"] = "1\n2\n";

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.launch.configProfiles).toEqual(["docker", "conda"]);
    expect(inputs.launch.labelIds).toEqual([1, 2]);
  });

  it("rejects invalid timeout values", async () => {
    process.env.INPUT_TIMEOUT = "not-a-duration";

    await expect(Effect.runPromise(readActionInputs())).rejects.toMatchObject({
      _tag: "InputValidationError",
      input: "timeout",
    });
  });

  it("accepts YAML parameters and normalizes them to JSON", async () => {
    process.env.INPUT_PARAMETERS = "foo: bar\n";

    const inputs = await Effect.runPromise(readActionInputs());
    expect(inputs.launch.paramsText).toBe('{"foo":"bar"}');
  });
});
