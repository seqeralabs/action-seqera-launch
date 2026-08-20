import * as core from "@actions/core";
import { Effect } from "effect";
import { createSeqeraClient, type SeqeraClient } from "../api/client.js";
import { createWorkflowLaunch, listComputeEnvs } from "../api/endpoints.js";
import type { ListComputeEnvsResponseEntry } from "../api/schemas/compute-env.js";
import {
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  ComputeEnvNoPrimaryError,
  ComputeEnvUnavailableError,
  WorkDirMissingError,
  WorkflowTerminalFailureError,
} from "../errors.js";
import { monitorWorkflow } from "../monitoring/poll.js";
import {
  reportWorkflowFailure,
  writeJobSummary,
  buildJobSummaryOptions,
} from "../monitoring/report.js";
import { workspaceRef, workflowWatchUrl } from "../monitoring/workflow-url.js";
import { readActionInputs } from "./inputs.js";
import { buildActionOutputOptions, setActionOutputs } from "./outputs.js";
const USER_AGENT = "seqeralabs/action-seqera-launch";

export function resolveComputeEnv(
  client: SeqeraClient,
  workspaceId: number | undefined,
  computeEnvId: string | undefined,
  computeEnvName: string | undefined,
) {
  return Effect.gen(function* () {
    // An explicit id is taken on trust: we cannot look up its work directory
    // without knowing which workspace listing it belongs to.
    if (computeEnvId !== undefined) {
      return { computeEnvId, label: computeEnvId, workDir: undefined };
    }

    const listed = yield* listComputeEnvs(client, workspaceId);
    const entries = listed.computeEnvs ?? [];

    if (computeEnvName === undefined) {
      // Launching without a compute environment relies on the workspace having
      // a primary one. The API answers an empty 403 when it does not, so check
      // here to produce an actionable message instead.
      const primary = entries.find((entry: ListComputeEnvsResponseEntry) => entry.primary === true);
      if (primary === undefined) {
        return yield* Effect.fail(
          new ComputeEnvNoPrimaryError({
            available: entries.map((entry: ListComputeEnvsResponseEntry) => entry.name),
          }),
        );
      }
      if (primary.status !== undefined && primary.status !== "AVAILABLE") {
        return yield* Effect.fail(
          new ComputeEnvUnavailableError({ name: primary.name, status: primary.status }),
        );
      }
      return {
        computeEnvId: primary.id,
        label: `${primary.name} (primary)`,
        workDir: primary.workDir,
      };
    }

    const matches = entries.filter(
      (entry: ListComputeEnvsResponseEntry) => entry.name === computeEnvName,
    );

    if (matches.length === 0) {
      const available = entries.map((entry: ListComputeEnvsResponseEntry) => entry.name);
      return yield* Effect.fail(
        new ComputeEnvNotFoundError({
          name: computeEnvName,
          available,
        }),
      );
    }

    if (matches.length > 1) {
      return yield* Effect.fail(
        new ComputeEnvAmbiguousError({
          name: computeEnvName,
          matches: matches.map(
            (entry: ListComputeEnvsResponseEntry) => `${entry.name} (${entry.id})`,
          ),
        }),
      );
    }

    const match = matches[0]!;
    if (match.status !== undefined && match.status !== "AVAILABLE") {
      return yield* Effect.fail(
        new ComputeEnvUnavailableError({ name: match.name, status: match.status }),
      );
    }

    return { computeEnvId: match.id, label: computeEnvName, workDir: match.workDir };
  });
}

function handleWorkflowTerminalFailure(
  client: SeqeraClient,
  apiEndpoint: string,
  workflowId: string,
  workspaceId: number | undefined,
  error: WorkflowTerminalFailureError,
) {
  return Effect.gen(function* () {
    yield* reportWorkflowFailure(client, apiEndpoint, error.describe, workflowId, workspaceId);

    setActionOutputs(
      apiEndpoint,
      error.describe,
      workflowId,
      buildActionOutputOptions({
        status: error.status,
        errorMessage: error.errorMessage,
      }),
    );

    const orgName = error.describe.orgName ?? "unknown-org";
    const workspaceName = error.describe.workspaceName ?? "unknown-workspace";
    writeJobSummary(
      buildJobSummaryOptions({
        workflowId,
        workflowUrl: error.workflowUrl,
        workspaceRef: workspaceRef(orgName, workspaceName),
        status: error.status,
        errorMessage: error.errorMessage,
        succeeded: false,
      }),
    );
  });
}

export function runAction() {
  return Effect.gen(function* () {
    const inputs = yield* readActionInputs();
    const client = createSeqeraClient({
      baseUrl: inputs.apiEndpoint,
      accessToken: inputs.accessToken,
      userAgent: USER_AGENT,
    });

    const resolved = yield* resolveComputeEnv(
      client,
      inputs.workspaceId,
      inputs.computeEnvId,
      inputs.computeEnvName,
    );

    const launchRequest = { ...inputs.launch };
    if (resolved.computeEnvId !== undefined) {
      launchRequest.computeEnvId = resolved.computeEnvId;
    }

    // Fall back to the compute environment's own work directory so a correctly
    // configured environment does not require the work-dir input.
    if (launchRequest.workDir === undefined) {
      if (resolved.workDir !== undefined && resolved.workDir.length > 0) {
        launchRequest.workDir = resolved.workDir;
        core.info(`Using compute environment work directory ${resolved.workDir}`);
      } else if (inputs.computeEnvId === undefined) {
        return yield* new WorkDirMissingError({ computeEnv: resolved.label });
      }
    }

    const launched = yield* createWorkflowLaunch(client, inputs.workspaceId, launchRequest);
    const workflowId = launched.workflowId;
    core.info(`Launched workflow ${workflowId}`);

    const monitor = yield* monitorWorkflow(
      client,
      inputs.apiEndpoint,
      workflowId,
      inputs.workspaceId,
      inputs.wait,
      inputs.timeoutMs,
      resolved.label,
    ).pipe(
      Effect.catchTag("WorkflowTerminalFailureError", (error) =>
        handleWorkflowTerminalFailure(
          client,
          inputs.apiEndpoint,
          workflowId,
          inputs.workspaceId,
          error,
        ).pipe(Effect.flatMap(() => Effect.fail(error))),
      ),
    );

    const describe = monitor.describe;
    const orgName = describe.orgName ?? "unknown-org";
    const workspaceName = describe.workspaceName ?? "unknown-workspace";
    const url = workflowWatchUrl(inputs.apiEndpoint, orgName, workspaceName, workflowId);
    const ref = workspaceRef(orgName, workspaceName);
    const status = describe.workflow?.status;

    setActionOutputs(
      inputs.apiEndpoint,
      describe,
      workflowId,
      buildActionOutputOptions({
        status,
        errorMessage: describe.workflow?.errorMessage ?? undefined,
      }),
    );

    writeJobSummary(
      buildJobSummaryOptions({
        workflowId,
        workflowUrl: url,
        workspaceRef: ref,
        status,
        errorMessage: describe.workflow?.errorMessage ?? undefined,
        succeeded: true,
      }),
    );
    return undefined;
  });
}
