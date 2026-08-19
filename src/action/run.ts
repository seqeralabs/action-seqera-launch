import * as core from "@actions/core";
import { Effect } from "effect";
import { createWorkflowLaunch, describeWorkflow, listComputeEnvs } from "../api/endpoints.js";
import type { ListComputeEnvsResponseEntry } from "../api/schemas/compute-env.js";
import type { SeqeraClient } from "../api/client.js";
import {
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
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
import { setActionOutputs, buildActionOutputOptions } from "./outputs.js";

function resolveComputeEnvId(
  client: SeqeraClient,
  workspaceId: number | undefined,
  computeEnvId: string | undefined,
  computeEnvName: string | undefined,
) {
  return Effect.gen(function* () {
    if (computeEnvId !== undefined) {
      return { computeEnvId, label: computeEnvId };
    }
    if (computeEnvName === undefined) {
      return { computeEnvId: undefined, label: "default primary compute environment" };
    }

    const listed = yield* listComputeEnvs(client, workspaceId);
    const matches = (listed.computeEnvs ?? []).filter(
      (entry: ListComputeEnvsResponseEntry) => entry.name === computeEnvName,
    );

    if (matches.length === 0) {
      const available = (listed.computeEnvs ?? []).map(
        (entry: ListComputeEnvsResponseEntry) => entry.name,
      );
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

    return { computeEnvId: matches[0]!.id, label: computeEnvName };
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
    const describe = yield* describeWorkflow(client, workflowId, workspaceId).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed(undefined),
      ),
    );

    if (describe === undefined) {
      return;
    }

    yield* reportWorkflowFailure(client, apiEndpoint, describe, workflowId, workspaceId);

    setActionOutputs(
      apiEndpoint,
      describe,
      workflowId,
      buildActionOutputOptions(error.status, error.errorMessage),
    );

    writeJobSummary(
      buildJobSummaryOptions({
        workflowId,
        workflowUrl: error.workflowUrl,
        workspaceRef:
          describe.orgName !== undefined && describe.workspaceName !== undefined
            ? workspaceRef(describe.orgName, describe.workspaceName)
            : "unknown",
        status: error.status,
        errorMessage: error.errorMessage,
        succeeded: false,
      }),
    );
  });
}

export function runAction(
  clientFactory: (config: { baseUrl: string; accessToken: string }) => SeqeraClient,
) {
  return Effect.gen(function* () {
    const inputs = yield* readActionInputs();
    const client = clientFactory({
      baseUrl: inputs.apiEndpoint,
      accessToken: inputs.accessToken,
    });

    const resolved = yield* resolveComputeEnvId(
      client,
      inputs.workspaceId,
      inputs.computeEnvId,
      inputs.computeEnvName,
    );

    const launchRequest = { ...inputs.launch };
    if (resolved.computeEnvId !== undefined) {
      launchRequest.computeEnvId = resolved.computeEnvId;
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
      buildActionOutputOptions(status, describe.workflow?.errorMessage),
    );

    writeJobSummary(
      buildJobSummaryOptions({
        workflowId,
        workflowUrl: url,
        workspaceRef: ref,
        status,
        errorMessage: describe.workflow?.errorMessage,
        succeeded: true,
      }),
    );
  });
}
