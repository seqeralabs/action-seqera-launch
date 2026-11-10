import * as core from "@actions/core";
import { Effect } from "effect";
import { createSeqeraClient, type SeqeraClient, type SeqeraHttpTransport } from "../api/client.js";
import { createWorkflowLaunch, listComputeEnvs } from "../api/endpoints.js";
import { resolveComputeEnv } from "./compute-env.js";
import {
  createLaunchpadPipeline,
  findLaunchpadLaunch,
  type SavedLaunch,
} from "../api/launchpad.js";
import type { ApiWorkflowLaunchRequest } from "../api/types.js";
import { WorkDirMissingError, WorkflowTerminalFailureError } from "../errors.js";
import { monitorWorkflow } from "../monitoring/poll.js";
import {
  reportWorkflowFailure,
  writeJobSummary,
  buildJobSummaryOptions,
} from "../monitoring/report.js";
import { workspaceRef, workflowWatchUrl } from "../monitoring/workflow-url.js";
import { readActionInputs, type ActionInputs } from "./inputs.js";
import { overlayLaunch, savedToRequest } from "./overlay.js";
import { buildActionOutputOptions, setActionOutputs } from "./outputs.js";
const USER_AGENT = "seqeralabs/action-seqera-launch";

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
    yield* writeJobSummary(
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

// Uses the saved compute environment as-is, listing environments only when the
// saved launch has no work directory of its own.
function savedComputeEnv(
  client: SeqeraClient,
  workspaceId: number | undefined,
  computeEnvId: string,
  name: string | undefined,
  workDir: string | undefined,
) {
  return Effect.gen(function* () {
    const label = name ?? computeEnvId;
    if (workDir !== undefined) {
      return { computeEnvId, label, workDir };
    }
    const listed = yield* listComputeEnvs(client, workspaceId);
    const entry = listed.computeEnvs?.find((candidate) => candidate.id === computeEnvId);
    return { computeEnvId, label, workDir: entry?.workDir };
  });
}

function prepareLaunch(client: SeqeraClient, inputs: ActionInputs, saved: SavedLaunch | undefined) {
  return Effect.gen(function* () {
    let launchRequest: ApiWorkflowLaunchRequest;
    if (saved === undefined) {
      launchRequest = { ...inputs.launch };
    } else {
      const overlay = overlayLaunch(savedToRequest(saved), inputs.launch);
      for (const warning of overlay.warnings) {
        core.warning(warning);
      }
      launchRequest = overlay.launch;
    }
    const savedComputeEnvId = launchRequest.computeEnvId;
    const useSavedComputeEnv =
      inputs.computeEnvId === undefined &&
      inputs.computeEnvName === undefined &&
      savedComputeEnvId !== undefined;
    const resolved = useSavedComputeEnv
      ? yield* savedComputeEnv(
          client,
          inputs.workspaceId,
          savedComputeEnvId,
          saved?.computeEnv?.name,
          launchRequest.workDir,
        )
      : yield* resolveComputeEnv(
          client,
          inputs.workspaceId,
          inputs.computeEnvId,
          inputs.computeEnvName,
        );
    launchRequest.computeEnvId = resolved.computeEnvId;

    // A saved work directory belongs to the saved compute environment, so any
    // compute override must not carry it over.
    const keepSavedWorkDir = useSavedComputeEnv && launchRequest.workDir !== undefined;
    if (inputs.launch.workDir === undefined && !keepSavedWorkDir) {
      if (resolved.workDir !== undefined && resolved.workDir.length > 0) {
        launchRequest.workDir = resolved.workDir;
        core.info(`Using compute environment work directory ${resolved.workDir}`);
      } else if (inputs.computeEnvId !== undefined) {
        // An explicit id is taken on trust; Platform falls back to its default.
        delete launchRequest.workDir;
      } else {
        return yield* new WorkDirMissingError({ computeEnv: resolved.label });
      }
    }
    return { launchRequest, label: resolved.label };
  });
}

// The transport parameter exists so tests can drive the whole run against a mock API.
export function runAction(http?: SeqeraHttpTransport) {
  return Effect.gen(function* () {
    const inputs = yield* readActionInputs();
    const client = createSeqeraClient(
      {
        baseUrl: inputs.apiEndpoint,
        accessToken: inputs.accessToken,
        userAgent: USER_AGENT,
      },
      http,
    );

    // An existing Launchpad entry is the base config and is never written to;
    // action inputs overlay it for this run only.
    const saved =
      inputs.launchpadName === undefined
        ? undefined
        : yield* findLaunchpadLaunch(client, inputs.workspaceId, inputs.launchpadName);
    let prepared = yield* prepareLaunch(client, inputs, saved);
    if (saved !== undefined) {
      core.info(`Using Launchpad pipeline '${inputs.launchpadName}' as the base configuration`);
    }

    if (inputs.launchpadName !== undefined && saved === undefined) {
      const result = yield* createLaunchpadPipeline(
        client,
        inputs.workspaceId,
        inputs.launchpadName,
        prepared.launchRequest,
      );
      if (result._tag === "Created") {
        prepared.launchRequest.id = result.launchId;
        core.info(`Saved Launchpad pipeline '${inputs.launchpadName}'`);
      } else {
        prepared = yield* prepareLaunch(client, inputs, result.launch);
        core.info(`Using Launchpad pipeline '${inputs.launchpadName}' created by another job`);
      }
    }

    const launched = yield* createWorkflowLaunch(
      client,
      inputs.workspaceId,
      prepared.launchRequest,
    );
    const workflowId = launched.workflowId;
    core.info(`Launched workflow ${workflowId}`);

    const monitor = yield* monitorWorkflow(
      client,
      inputs.apiEndpoint,
      workflowId,
      inputs.workspaceId,
      inputs.wait,
      inputs.timeoutMs,
      prepared.label,
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
        errorMessage: describe.workflow?.errorMessage,
      }),
    );

    yield* writeJobSummary(
      buildJobSummaryOptions({
        workflowId,
        workflowUrl: url,
        workspaceRef: ref,
        status,
        errorMessage: describe.workflow?.errorMessage,
        succeeded: true,
      }),
    );
    return undefined;
  });
}
