import * as core from "@actions/core";
import { Effect, Result, Schema } from "effect";
import { createSeqeraClient, type SeqeraClient, type SeqeraHttpTransport } from "../api/client.js";
import { createStudio, describeStudio, findStudioByName, startStudio } from "../api/studios.js";
import type { Studio } from "../api/schemas/studio.js";
import type { ApiDataStudioCreateRequest, ApiDataStudioStatus } from "../api/types.js";
import { InputValidationError, StudioFailedError, StudioTimeoutError } from "../errors.js";
import { defaultWaitBeforeNextPoll } from "../monitoring/poll.js";
import { writeSummary } from "../monitoring/report.js";
import { resolveComputeEnv } from "./compute-env.js";
import {
  optionalBooleanInput,
  optionalIntegerInput,
  optionalIntegerListInput,
  optionalString,
  readTargetInputs,
  readTimeoutInput,
} from "./inputs.js";

const USER_AGENT = "seqeralabs/action-seqera-launch/studio";

const StudioWaitSchema = Schema.Literals(["none", "running"]);

export interface StudioInputs {
  readonly accessToken: string;
  readonly apiEndpoint: string;
  readonly workspaceId: number | undefined;
  readonly computeEnvId: string | undefined;
  readonly computeEnvName: string | undefined;
  readonly autoStart: boolean;
  readonly wait: "none" | "running";
  readonly timeoutMs: number | undefined;
  readonly commitId: string | undefined;
  readonly request: Omit<ApiDataStudioCreateRequest, "computeEnvId">;
}

function invalid(input: string, message: string) {
  return new InputValidationError({ input, message });
}

function studioName(commitId: string | undefined) {
  return Effect.gen(function* () {
    // Per commit on purpose: a studio never runs stale code, and reruns of the
    // same commit find the studio the first run made.
    const repoName = process.env["GITHUB_REPOSITORY"]?.split("/")[1];
    const name =
      optionalString("name") ??
      (repoName === undefined || commitId === undefined
        ? undefined
        : `${repoName}-${commitId.slice(0, 7)}`);
    if (name === undefined) {
      return yield* invalid("name", "is required when the repository or commit is unknown");
    }
    if (name.length > 100) {
      return yield* invalid("name", `must be at most 100 characters, got ${String(name.length)}`);
    }
    return name;
  });
}

function buildStudioRequest(commitId: string | undefined) {
  return Effect.gen(function* () {
    const repository = optionalString("repository");
    if (repository === undefined) {
      return yield* invalid("repository", "is required");
    }
    const revision = optionalString("revision");
    const remoteConfig: NonNullable<ApiDataStudioCreateRequest["remoteConfig"]> = { repository };
    // Platform ignores commitId and clones whatever `revision` resolves to, so
    // the commit goes in `revision` to pin the Studio to it.
    const checkout = commitId ?? revision;
    if (checkout !== undefined) {
      remoteConfig.revision = checkout;
    }
    if (commitId !== undefined) {
      remoteConfig.commitId = commitId;
    }

    const configuration: NonNullable<ApiDataStudioCreateRequest["configuration"]> = {};
    const cpu = yield* optionalIntegerInput("cpu");
    if (cpu !== undefined) {
      configuration.cpu = cpu;
    }
    const memory = yield* optionalIntegerInput("memory-mb");
    if (memory !== undefined) {
      configuration.memory = memory;
    }
    const gpu = yield* optionalIntegerInput("gpu");
    if (gpu !== undefined) {
      configuration.gpu = gpu;
    }
    const lifespanHours = yield* optionalIntegerInput("lifespan-hours");
    if (lifespanHours !== undefined) {
      configuration.lifespanHours = lifespanHours;
    }
    const condaEnvironment = optionalString("conda-environment");
    if (condaEnvironment !== undefined) {
      configuration.condaEnvironment = condaEnvironment;
    }
    // Always sent: Platform answers a create without `configuration` with a
    // generic "Unexpected error" (verified live on cloud.seqera.io).
    const request: Omit<ApiDataStudioCreateRequest, "computeEnvId"> = {
      name: yield* studioName(commitId),
      remoteConfig,
      configuration,
    };

    const description = optionalString("description");
    if (description !== undefined) {
      request.description = description;
    }
    const toolUrl = optionalString("tool-url");
    if (toolUrl !== undefined) {
      request.dataStudioToolUrl = toolUrl;
    }
    const isPrivate = optionalBooleanInput("private");
    if (isPrivate !== undefined) {
      request.isPrivate = isPrivate;
    }
    const spot = optionalBooleanInput("spot");
    if (spot !== undefined) {
      request.spot = spot;
    }
    const labelIds = yield* optionalIntegerListInput("label-ids");
    if (labelIds !== undefined) {
      request.labelIds = labelIds;
    }
    return request;
  });
}

export function readStudioInputs(): Effect.Effect<StudioInputs, InputValidationError> {
  return Effect.gen(function* () {
    const target = yield* readTargetInputs();
    const waitRaw = core.getInput("wait") || "running";
    const waitResult = Schema.decodeUnknownResult(StudioWaitSchema)(waitRaw);
    if (Result.isFailure(waitResult)) {
      return yield* invalid("wait", `must be one of none, running; got '${waitRaw}'`);
    }
    const commitId = optionalString("commit-id");
    return {
      ...target,
      autoStart: optionalBooleanInput("auto-start") ?? true,
      wait: waitResult.success,
      timeoutMs: yield* readTimeoutInput(),
      commitId,
      request: yield* buildStudioRequest(commitId),
    };
  });
}

type StudioPhase = "done" | "pending" | "failed";

const STUDIO_PHASES = {
  running: "done",
  starting: "pending",
  building: "pending",
  errored: "failed",
  buildFailed: "failed",
  stopped: "failed",
  stopping: "failed",
} as const satisfies Record<ApiDataStudioStatus, StudioPhase>;

type StudioFailurePayload = {
  sessionId: string;
  status: string;
  message?: string;
  buildUrl?: string;
};

function studioFailure(studio: Studio, status: string) {
  const fields: StudioFailurePayload = { sessionId: studio.sessionId, status };
  if (studio.statusInfo?.message !== undefined) {
    fields.message = studio.statusInfo.message;
  }
  if (studio.waveBuildUrl !== undefined) {
    fields.buildUrl = studio.waveBuildUrl;
  }
  return new StudioFailedError(fields);
}

interface WaitOutcome {
  readonly studio: Studio;
  readonly error?: StudioFailedError | StudioTimeoutError;
}

function waitForRunning(
  client: SeqeraClient,
  initial: Studio,
  inputs: StudioInputs,
  waitBeforeNextPoll: (attempt: number) => Effect.Effect<void>,
) {
  return Effect.gen(function* () {
    const startedAt = Date.now();
    let studio = initial;
    let attempt = 0;
    while (true) {
      // A fresh studio may not report a status yet; it is still starting.
      const status = studio.statusInfo?.status ?? "starting";
      const phase = STUDIO_PHASES[status];
      if (phase === "done") {
        return { studio } satisfies WaitOutcome;
      }
      if (phase === "failed") {
        return { studio, error: studioFailure(studio, status) } satisfies WaitOutcome;
      }
      if (inputs.timeoutMs !== undefined && Date.now() - startedAt >= inputs.timeoutMs) {
        const error = new StudioTimeoutError({
          sessionId: studio.sessionId,
          status,
          timeoutMs: inputs.timeoutMs,
        });
        return { studio, error } satisfies WaitOutcome;
      }
      core.info(`Studio ${studio.sessionId} is ${status}`);
      attempt += 1;
      yield* waitBeforeNextPoll(attempt);
      studio = yield* describeStudio(client, studio.sessionId, inputs.workspaceId);
    }
  });
}

function publishStudio(studio: Studio, inputs: StudioInputs) {
  const status = studio.statusInfo?.status ?? "";
  const url = studio.studioUrl ?? "";
  core.setOutput("studio-id", studio.sessionId);
  core.setOutput("studio-url", url);
  core.setOutput("status", status);
  core.setOutput(
    "workspace-id",
    inputs.workspaceId === undefined ? "" : String(inputs.workspaceId),
  );

  const summary = core.summary;
  summary.addHeading("Seqera Platform Studio", 2);
  const rows = [
    ["Name", studio.name ?? inputs.request.name],
    ["Status", status],
    ["URL", url],
    ["Commit", inputs.commitId ?? ""],
    ["Build log", studio.waveBuildUrl ?? ""],
  ];
  // core.summary renders an empty cell as broken HTML, so empty rows are left out.
  summary.addTable([
    [
      { data: "Field", header: true },
      { data: "Value", header: true },
    ],
    ...rows.filter(([, value]) => value !== ""),
  ]);
  return writeSummary();
}

// The transport and sleep parameters exist so tests can drive the whole run
// against a mock API without waiting.
export function runStudioAction(
  http?: SeqeraHttpTransport,
  waitBeforeNextPoll: (attempt: number) => Effect.Effect<void> = defaultWaitBeforeNextPoll,
) {
  return Effect.gen(function* () {
    const inputs = yield* readStudioInputs();
    const client = createSeqeraClient(
      { baseUrl: inputs.apiEndpoint, accessToken: inputs.accessToken, userAgent: USER_AGENT },
      http,
    );
    const name = inputs.request.name;
    const commitId = inputs.commitId;

    let studio = yield* findStudioByName(client, inputs.workspaceId, name);
    if (studio === undefined) {
      const resolved = yield* resolveComputeEnv(
        client,
        inputs.workspaceId,
        inputs.computeEnvId,
        inputs.computeEnvName,
      );
      const result = yield* createStudio(client, inputs.workspaceId, inputs.autoStart, {
        ...inputs.request,
        computeEnvId: resolved.computeEnvId,
      });
      studio = result.studio;
      core.info(
        result._tag === "Created"
          ? `Created studio '${name}' (${studio.sessionId})`
          : `Using studio '${name}' (${studio.sessionId}) created by another job`,
      );
    } else {
      core.info(`Reusing existing studio '${name}' (${studio.sessionId})`);
    }
    // A rerun after the lifespan expired finds the studio stopped.
    if (inputs.autoStart && studio.statusInfo?.status === "stopped") {
      const started = yield* startStudio(client, studio.sessionId, inputs.workspaceId);
      core.info(`Started stopped studio '${name}' (${studio.sessionId})`);
      studio = { ...studio, statusInfo: started.statusInfo ?? { status: "starting" } };
    }
    const existingCommit = studio.remoteConfig?.commitId;
    if (commitId !== undefined && existingCommit !== undefined && existingCommit !== commitId) {
      core.warning(
        `Studio '${name}' was built from commit ${existingCommit}, not ${commitId}. Set a different name to build this commit.`,
      );
    }

    const shouldWait = inputs.wait === "running" && inputs.autoStart;
    const outcome: WaitOutcome = shouldWait
      ? yield* waitForRunning(client, studio, inputs, waitBeforeNextPoll)
      : { studio };
    yield* publishStudio(outcome.studio, inputs);
    if (outcome.error !== undefined) {
      return yield* outcome.error;
    }
    return undefined;
  });
}
