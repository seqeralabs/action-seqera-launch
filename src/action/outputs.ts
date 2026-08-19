import * as core from "@actions/core";
import type { DescribeWorkflowResponse } from "../api/schemas/workflow.js";
import { workspaceRef, workflowWatchUrl } from "../monitoring/workflow-url.js";

export interface ActionOutputs {
  readonly workflowId: string;
  readonly workflowUrl: string;
  readonly workspaceId: string;
  readonly workspaceRef: string;
  readonly status?: string;
  readonly errorMessage?: string;
}

export interface ActionOutputOptions {
  readonly status?: string;
  readonly errorMessage?: string;
}

export function buildActionOutputOptions(
  status: string | undefined,
  errorMessage: string | undefined,
): ActionOutputOptions {
  if (status !== undefined && errorMessage !== undefined) {
    return { status, errorMessage };
  }
  if (status !== undefined) {
    return { status };
  }
  if (errorMessage !== undefined) {
    return { errorMessage };
  }
  return {};
}

export function setActionOutputs(
  apiEndpoint: string,
  describe: DescribeWorkflowResponse,
  workflowId: string,
  options?: ActionOutputOptions,
): ActionOutputs {
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

  const base = {
    workflowId,
    workflowUrl: url,
    workspaceId: wsId,
    workspaceRef: ref,
  };
  const extra = buildActionOutputOptions(options?.status, options?.errorMessage);
  if (extra.status !== undefined && extra.errorMessage !== undefined) {
    return { ...base, status: extra.status, errorMessage: extra.errorMessage };
  }
  if (extra.status !== undefined) {
    return { ...base, status: extra.status };
  }
  if (extra.errorMessage !== undefined) {
    return { ...base, errorMessage: extra.errorMessage };
  }
  return base;
}
