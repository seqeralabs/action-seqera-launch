import * as core from "@actions/core";
import type { DescribeWorkflowResponse } from "../api/schemas/workflow.js";
import { workspaceRef, workflowWatchUrl } from "../monitoring/workflow-url.js";

export interface ActionOutputOptions {
  readonly status?: string;
  readonly errorMessage?: string;
}

export function buildActionOutputOptions(input: {
  status?: string | undefined;
  errorMessage?: string | undefined;
}): ActionOutputOptions | undefined {
  if (input.status !== undefined && input.errorMessage !== undefined) {
    return { status: input.status, errorMessage: input.errorMessage };
  }
  if (input.status !== undefined) {
    return { status: input.status };
  }
  if (input.errorMessage !== undefined) {
    return { errorMessage: input.errorMessage };
  }
  return undefined;
}

export function setActionOutputs(
  apiEndpoint: string,
  describe: DescribeWorkflowResponse,
  workflowId: string,
  options?: ActionOutputOptions,
): void {
  const orgName = describe.orgName ?? "unknown-org";
  const workspaceName = describe.workspaceName ?? "unknown-workspace";
  const wsId = describe.workspaceId === undefined ? "" : String(describe.workspaceId);
  const url = workflowWatchUrl(apiEndpoint, orgName, workspaceName, workflowId);
  const ref = workspaceRef(orgName, workspaceName);

  core.setOutput("workflow-id", workflowId);
  core.setOutput("workflow-url", url);
  core.setOutput("workspace-id", wsId);
  core.setOutput("workspace-ref", ref);
  if (options?.status !== undefined) {
    core.setOutput("status", options.status);
  }
  if (options?.errorMessage !== undefined) {
    core.setOutput("error-message", options.errorMessage);
  }
}
