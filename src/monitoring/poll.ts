import * as core from "@actions/core";
import { Duration, Effect } from "effect";
import {
  UnknownWorkflowStatusError,
  WorkflowStuckSubmittedError,
  workflowTerminalFailure,
} from "../errors.js";
import { describeWorkflow } from "../api/endpoints.js";
import type { SeqeraClient } from "../api/client.js";
import type { DescribeWorkflowResponse } from "../api/schemas/workflow.js";
import type { KnownWorkflowStatus } from "../api/types.js";
import { isKnownWorkflowStatus } from "../api/types.js";
import { workflowWatchUrl } from "./workflow-url.js";

export type WaitMode = "none" | "running" | "completion";

export const SUBMITTED_TIMEOUT_MS = 10 * 60 * 1000;

const terminalStatuses = new Set<KnownWorkflowStatus>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
]);

function isTerminalStatus(status: KnownWorkflowStatus): boolean {
  return terminalStatuses.has(status);
}

interface WorkflowStatusReadout {
  readonly status: KnownWorkflowStatus;
  readonly known: true;
}

interface UnknownWorkflowStatusReadout {
  readonly status: string;
  readonly known: false;
}

interface DescribeFields {
  readonly orgName: string;
  readonly workspaceName: string;
  readonly workflowId: string;
}

interface PollSuccess {
  readonly describe: DescribeWorkflowResponse;
  readonly waitOutcome: "running" | "completion";
}

function readWorkflowStatus(
  describe: DescribeWorkflowResponse,
): WorkflowStatusReadout | UnknownWorkflowStatusReadout {
  const status = describe.workflow?.status;
  if (status === undefined) {
    return { status: "UNKNOWN", known: true };
  }
  if (isKnownWorkflowStatus(status)) {
    return { status, known: true };
  }
  return { status, known: false };
}

function requireDescribeFields(describe: DescribeWorkflowResponse): DescribeFields {
  const orgName = describe.orgName;
  const workspaceName = describe.workspaceName;
  const workflowId = describe.workflow?.id;
  if (orgName === undefined || workspaceName === undefined || workflowId === undefined) {
    throw new Error("DescribeWorkflow response is missing org, workspace, or workflow id");
  }
  return { orgName, workspaceName, workflowId };
}

export function defaultWaitBeforeNextPoll(attempt: number): Effect.Effect<void> {
  const baseMs = 5000;
  const delayMs = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), 60000);
  return Effect.sleep(Duration.millis(delayMs));
}

export function monitorWorkflow(
  client: SeqeraClient,
  apiEndpoint: string,
  workflowId: string,
  workspaceId: number | undefined,
  wait: WaitMode,
  timeoutMs: number | undefined,
  computeEnvLabel: string,
  waitBeforeNextPoll: (attempt: number) => Effect.Effect<void> = defaultWaitBeforeNextPoll,
) {
  return Effect.gen(function* () {
    if (wait === "none") {
      const describe = yield* describeWorkflow(client, workflowId, workspaceId);
      return { describe, waitOutcome: "none" as const };
    }

    const startedAt = Date.now();
    let submittedSince: number | undefined;
    let pollAttempt = 0;

    while (true) {
      const describe = yield* describeWorkflow(client, workflowId, workspaceId);
      const { orgName, workspaceName } = requireDescribeFields(describe);
      const url = workflowWatchUrl(apiEndpoint, orgName, workspaceName, workflowId);
      const { status, known } = readWorkflowStatus(describe);

      if (!known) {
        return yield* Effect.fail(new UnknownWorkflowStatusError({ status, workflowUrl: url }));
      }

      const knownStatus = status;

      if (knownStatus === "SUBMITTED") {
        submittedSince ??= Date.now();
        if (Date.now() - submittedSince >= SUBMITTED_TIMEOUT_MS) {
          return yield* Effect.fail(
            new WorkflowStuckSubmittedError({
              computeEnv: computeEnvLabel,
              workflowUrl: url,
              timeoutMs: SUBMITTED_TIMEOUT_MS,
            }),
          );
        }
      } else {
        submittedSince = undefined;
      }

      if (wait === "running" && knownStatus !== "SUBMITTED") {
        if (knownStatus === "SUCCEEDED") {
          core.info(`Workflow already succeeded: ${url}`);
          return { describe, waitOutcome: "running" as const } satisfies PollSuccess;
        }
        if (isTerminalStatus(knownStatus)) {
          return yield* Effect.fail(workflowTerminalFailure(knownStatus, url, describe));
        }
        core.info(`Workflow launched and is ${knownStatus}. The run is still executing: ${url}`);
        return { describe, waitOutcome: "running" as const } satisfies PollSuccess;
      }

      if (wait === "completion") {
        if (knownStatus === "SUCCEEDED") {
          return { describe, waitOutcome: "completion" as const } satisfies PollSuccess;
        }
        if (isTerminalStatus(knownStatus)) {
          return yield* Effect.fail(workflowTerminalFailure(knownStatus, url, describe));
        }
      }

      if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) {
        return yield* Effect.fail(
          workflowTerminalFailure(
            knownStatus,
            url,
            describe,
            `Timed out after ${String(timeoutMs)} ms while waiting for ${wait}`,
          ),
        );
      }

      pollAttempt += 1;
      yield* waitBeforeNextPoll(pollAttempt);
    }
  });
}
