import * as core from "@actions/core";
import { Effect } from "effect";
import { getWorkflowTaskLog, listFailedWorkflowTasks } from "../api/endpoints.js";
import type { SeqeraClient } from "../api/client.js";
import type { DescribeWorkflowResponse } from "../api/schemas/workflow.js";
import { extractStderr } from "./log-entries.js";
import { workflowWatchUrl } from "./workflow-url.js";

const LOG_TAIL_MAX_LINES = 40;
const LOG_TAIL_MAX_CHARS = 4096;

function tailText(text: string): string {
  const lines = text.split("\n");
  const tailedLines = lines.slice(-LOG_TAIL_MAX_LINES);
  let tailed = tailedLines.join("\n");
  if (tailed.length > LOG_TAIL_MAX_CHARS) {
    tailed = tailed.slice(-LOG_TAIL_MAX_CHARS);
  }
  return tailed;
}

export function reportWorkflowFailure(
  client: SeqeraClient,
  apiEndpoint: string,
  describe: DescribeWorkflowResponse,
  workflowId: string,
  workspaceId: number | undefined,
) {
  return Effect.gen(function* () {
    const workflow = describe.workflow;
    const orgName = describe.orgName ?? "unknown-org";
    const workspaceName = describe.workspaceName ?? "unknown-workspace";
    const url = workflowWatchUrl(apiEndpoint, orgName, workspaceName, workflowId);

    if (workflow?.errorMessage != null) {
      core.error(`errorMessage: ${workflow.errorMessage}`);
    }
    if (workflow?.errorReport != null) {
      core.error(`errorReport: ${workflow.errorReport}`);
    }
    if (workflow?.exitStatus != null) {
      core.error(`exitStatus: ${String(workflow.exitStatus)}`);
    }

    const failedTasks = yield* listFailedWorkflowTasks(client, workflowId, workspaceId).pipe(
      Effect.catchIf(
        () => true,
        () => Effect.succeed({ tasks: [] as const }),
      ),
    );

    for (const item of failedTasks.tasks ?? []) {
      const task = item.task;
      if (task === undefined) {
        continue;
      }
      const label = task.name ?? task.process ?? `task-${String(task.taskId ?? "?")}`;
      core.error(`Failed task: ${label}`);
      if (task.errorMessage != null) {
        core.error(task.errorMessage);
      }
      if (task.taskId !== undefined) {
        const log = yield* getWorkflowTaskLog(client, workflowId, task.taskId, workspaceId).pipe(
          Effect.catchIf(
            () => true,
            () => Effect.succeed({ log: undefined }),
          ),
        );
        const stderr = extractStderr(log.log?.entries);
        if (stderr.length > 0) {
          core.error(tailText(stderr));
        } else if (log.log?.message !== undefined) {
          core.error(tailText(log.log.message));
        }
      }
    }

    return url;
  });
}

export interface JobSummaryOptions {
  readonly workflowId: string;
  readonly workflowUrl: string;
  readonly workspaceRef: string;
  readonly status?: string;
  readonly errorMessage?: string;
  readonly succeeded: boolean;
}

export function buildJobSummaryOptions(input: {
  workflowId: string;
  workflowUrl: string;
  workspaceRef: string;
  succeeded: boolean;
  status?: string | undefined;
  errorMessage?: string | undefined;
}): JobSummaryOptions {
  if (input.status !== undefined && input.errorMessage !== undefined) {
    return {
      workflowId: input.workflowId,
      workflowUrl: input.workflowUrl,
      workspaceRef: input.workspaceRef,
      status: input.status,
      errorMessage: input.errorMessage,
      succeeded: input.succeeded,
    };
  }
  if (input.status !== undefined) {
    return {
      workflowId: input.workflowId,
      workflowUrl: input.workflowUrl,
      workspaceRef: input.workspaceRef,
      status: input.status,
      succeeded: input.succeeded,
    };
  }
  if (input.errorMessage !== undefined) {
    return {
      workflowId: input.workflowId,
      workflowUrl: input.workflowUrl,
      workspaceRef: input.workspaceRef,
      errorMessage: input.errorMessage,
      succeeded: input.succeeded,
    };
  }
  return {
    workflowId: input.workflowId,
    workflowUrl: input.workflowUrl,
    workspaceRef: input.workspaceRef,
    succeeded: input.succeeded,
  };
}

// core.summary's add* helpers only append to an in-memory buffer; write()
// is what appends to GITHUB_STEP_SUMMARY. Without it the summary ADR 0006
// promises never renders.
export function writeJobSummary(options: JobSummaryOptions) {
  const summary = core.summary;
  summary.addHeading("Seqera Platform Launch", 2);
  summary.addTable([
    [
      { data: "Field", header: true },
      { data: "Value", header: true },
    ],
    ["Workflow ID", options.workflowId],
    ["Workflow URL", options.workflowUrl],
    ["Workspace", options.workspaceRef],
    ...(options.status === undefined ? [] : [["Status", options.status]]),
    ...(options.errorMessage === undefined ? [] : [["Error", options.errorMessage]]),
  ]);
  if (options.succeeded) {
    summary.addRaw("\nLaunch step completed successfully.\n");
  } else {
    summary.addRaw("\nLaunch step failed.\n");
  }
  // A summary that cannot be written must not fail the launch it is
  // reporting on, so failures are logged and swallowed.
  return Effect.promise(() => summary.write()).pipe(
    Effect.catchDefect((defect) =>
      Effect.sync(() => {
        core.warning(`Could not write the job summary: ${String(defect)}`);
      }),
    ),
    Effect.asVoid,
  );
}
