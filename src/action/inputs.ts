import * as core from "@actions/core";
import { Effect, Result, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import { InputValidationError } from "../errors.js";
import type { ApiWorkflowLaunchRequest } from "../api/types.js";
import type { WaitMode } from "../monitoring/poll.js";

export interface ActionInputs {
  readonly accessToken: string;
  readonly apiEndpoint: string;
  readonly workspaceId: number | undefined;
  readonly computeEnvId: string | undefined;
  readonly computeEnvName: string | undefined;
  readonly launch: ApiWorkflowLaunchRequest;
  readonly wait: WaitMode;
  readonly timeoutMs: number | undefined;
}

const WaitModeSchema = Schema.Literals(["none", "running", "completion"]);
const SyntaxParserSchema = Schema.Literals(["v1", "v2"]);

function optionalBooleanInput(name: string): boolean | undefined {
  const raw = core.getInput(name);
  if (raw.trim().length === 0) {
    return undefined;
  }
  return core.getBooleanInput(name);
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

// Actions convention is one item per line; commas stay supported since
// action-tower-launch used them.
function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseOptionalBigIntList(value: string | undefined): number[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return splitList(value).map((part) => Number.parseInt(part, 10));
}

function parseOptionalStringList(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  const items = splitList(value);
  return items.length === 0 ? undefined : items;
}

function parseParametersText(value: string | undefined): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  try {
    JSON.parse(value);
    return value;
  } catch {
    try {
      const parsed = parseYaml(value);
      return JSON.stringify(parsed);
    } catch {
      return undefined;
    }
  }
}

function parseDurationMs(value: string): number | undefined {
  const trimmed = value.trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)?$/i.exec(trimmed);
  if (match === null) {
    return undefined;
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  switch (unit) {
    case "ms":
      return amount;
    case "s":
      return amount * 1000;
    case "m":
      return amount * 60_000;
    case "h":
      return amount * 3_600_000;
    case "d":
      return amount * 86_400_000;
    default:
      return undefined;
  }
}

function validateUrl(value: string, input: string): Effect.Effect<string, InputValidationError> {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return Effect.fail(
        new InputValidationError({
          input,
          message: `must be a valid URL, got '${value}'`,
        }),
      );
    }
    return Effect.succeed(value.replace(/\/$/, ""));
  } catch {
    return Effect.fail(
      new InputValidationError({
        input,
        message: `must be a valid URL, got '${value}'`,
      }),
    );
  }
}

function buildLaunchRequest(): ApiWorkflowLaunchRequest {
  const launch: ApiWorkflowLaunchRequest = {};

  const pipeline = core.getInput("pipeline");
  if (pipeline.trim().length > 0) {
    launch.pipeline = pipeline;
  } else {
    const repository = process.env["GITHUB_REPOSITORY"];
    if (repository !== undefined && repository.length > 0) {
      launch.pipeline = `https://github.com/${repository}`;
    }
  }

  const revision = core.getInput("revision");
  if (revision.trim().length > 0) {
    launch.revision = revision;
  }

  const workDir = core.getInput("work-dir");
  if (workDir.trim().length > 0) {
    launch.workDir = workDir;
  }

  const paramsText = parseParametersText(core.getInput("parameters"));
  if (paramsText !== undefined) {
    launch.paramsText = paramsText;
  }

  const profiles = parseOptionalStringList(core.getInput("profiles"));
  if (profiles !== undefined) {
    launch.configProfiles = profiles;
  }

  const runName = core.getInput("run-name");
  if (runName.trim().length > 0) {
    launch.runName = runName;
  }

  const configText = core.getInput("nextflow-config");
  if (configText.trim().length > 0) {
    launch.configText = configText;
  }

  const preRunScript = core.getInput("pre-run-script");
  if (preRunScript.trim().length > 0) {
    launch.preRunScript = preRunScript;
  }

  const postRunScript = core.getInput("post-run-script");
  if (postRunScript.trim().length > 0) {
    launch.postRunScript = postRunScript;
  }

  const labelIds = parseOptionalBigIntList(core.getInput("label-ids"));
  if (labelIds !== undefined) {
    launch.labelIds = labelIds;
  }

  const outputDir = core.getInput("output-dir");
  if (outputDir.trim().length > 0) {
    launch.outputDir = outputDir;
  }

  const stubRun = optionalBooleanInput("stub-run");
  if (stubRun !== undefined) {
    launch.stubRun = stubRun;
  }

  const pullLatest = optionalBooleanInput("pull-latest");
  if (pullLatest !== undefined) {
    launch.pullLatest = pullLatest;
  }

  const nextflowVersion = core.getInput("nextflow-version");
  if (nextflowVersion.trim().length > 0) {
    launch.nextflowVersion = nextflowVersion;
  }

  const headJobCpus = parseOptionalInt(core.getInput("head-job-cpus"));
  if (headJobCpus !== undefined) {
    launch.headJobCpus = headJobCpus;
  }

  const headJobMemoryMb = parseOptionalInt(core.getInput("head-job-memory-mb"));
  if (headJobMemoryMb !== undefined) {
    launch.headJobMemoryMb = headJobMemoryMb;
  }

  return launch;
}

export function readActionInputs(): Effect.Effect<ActionInputs, InputValidationError> {
  return Effect.gen(function* () {
    const accessToken = core.getInput("access-token", { required: true }).trim();
    if (accessToken.length === 0) {
      return yield* Effect.fail(
        new InputValidationError({
          input: "access-token",
          message: "is required",
        }),
      );
    }

    const apiEndpointRaw = core.getInput("api-endpoint") || "https://api.cloud.seqera.io";
    const apiEndpoint = yield* validateUrl(apiEndpointRaw, "api-endpoint");

    const workspaceRaw = core.getInput("workspace-id");
    const workspaceId =
      workspaceRaw.trim().length === 0 ? undefined : parseOptionalInt(workspaceRaw.trim());
    if (workspaceRaw.trim().length > 0 && workspaceId === undefined) {
      return yield* Effect.fail(
        new InputValidationError({
          input: "workspace-id",
          message: `must be a numeric id, got '${workspaceRaw}'`,
        }),
      );
    }

    const computeEnvIdRaw = core.getInput("compute-env-id").trim();
    const computeEnvNameRaw = core.getInput("compute-env").trim();
    const computeEnvId = computeEnvIdRaw.length > 0 ? computeEnvIdRaw : undefined;
    const computeEnvName = computeEnvNameRaw.length > 0 ? computeEnvNameRaw : undefined;

    const waitRaw = core.getInput("wait") || "running";
    const waitResult = Schema.decodeUnknownResult(WaitModeSchema)(waitRaw);
    if (Result.isFailure(waitResult)) {
      return yield* Effect.fail(
        new InputValidationError({
          input: "wait",
          message: `must be one of none, running, completion; got '${waitRaw}'`,
        }),
      );
    }
    const wait = waitResult.success;

    const timeoutRaw = core.getInput("timeout").trim();
    let timeoutMs: number | undefined;
    if (timeoutRaw.length > 0) {
      const parsed = parseDurationMs(timeoutRaw);
      if (parsed === undefined) {
        return yield* Effect.fail(
          new InputValidationError({
            input: "timeout",
            message: `must be a duration like 90m, got '${timeoutRaw}'`,
          }),
        );
      }
      timeoutMs = parsed;
    }

    const parametersRaw = core.getInput("parameters");
    if (parametersRaw.trim().length > 0 && parseParametersText(parametersRaw) === undefined) {
      return yield* Effect.fail(
        new InputValidationError({
          input: "parameters",
          message: "must be valid JSON or YAML",
        }),
      );
    }

    const launch = buildLaunchRequest();
    const syntaxParserRaw = core.getInput("syntax-parser");
    if (syntaxParserRaw.length > 0) {
      const syntaxParserResult = Schema.decodeUnknownResult(SyntaxParserSchema)(syntaxParserRaw);
      if (Result.isFailure(syntaxParserResult)) {
        return yield* Effect.fail(
          new InputValidationError({
            input: "syntax-parser",
            message: `must be one of v1, v2; got '${syntaxParserRaw}'`,
          }),
        );
      }
      launch.syntaxParser = syntaxParserResult.success;
    }

    return {
      accessToken,
      apiEndpoint,
      workspaceId,
      computeEnvId,
      computeEnvName,
      launch,
      wait,
      timeoutMs,
    };
  });
}
