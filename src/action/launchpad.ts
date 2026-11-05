import * as core from "@actions/core";
import { Option, Schema } from "effect";
import { parse as parseYaml } from "yaml";
import type { SavedLaunch } from "../api/launchpad.js";
import type { ApiWorkflowLaunchRequest } from "../api/types.js";

type LaunchRequest = ApiWorkflowLaunchRequest;

function copy<K extends keyof LaunchRequest>(
  target: LaunchRequest,
  key: K,
  value: LaunchRequest[K] | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
}

function copyList(value: readonly string[] | null | undefined): string[] | undefined {
  return value === null || value === undefined ? undefined : [...value];
}

export function savedToRequest(saved: SavedLaunch): LaunchRequest {
  const request: LaunchRequest = { id: saved.id };
  copy(request, "computeEnvId", saved.computeEnv?.id);
  copy(request, "pipeline", saved.pipeline);
  copy(request, "workDir", saved.workDir);
  copy(request, "revision", saved.revision);
  copy(request, "configText", saved.configText);
  copy(request, "paramsText", saved.paramsText);
  copy(request, "configProfiles", copyList(saved.configProfiles));
  copy(request, "preRunScript", saved.preRunScript);
  copy(request, "postRunScript", saved.postRunScript);
  copy(request, "nextflowVersion", saved.nextflowVersion);
  copy(request, "syntaxParser", saved.syntaxParser);
  copy(request, "stubRun", saved.stubRun);
  copy(request, "pullLatest", saved.pullLatest);
  copy(request, "headJobCpus", saved.headJobCpus);
  copy(request, "headJobMemoryMb", saved.headJobMemoryMb);
  copy(request, "outputDir", saved.outputDir);
  copy(request, "mainScript", saved.mainScript);
  copy(request, "entryName", saved.entryName);
  copy(request, "schemaName", saved.schemaName);
  copy(request, "towerConfig", saved.towerConfig);
  copy(request, "userSecrets", copyList(saved.userSecrets));
  copy(request, "workspaceSecrets", copyList(saved.workspaceSecrets));
  return request;
}

const ParamsSchema = Schema.Record(Schema.String, Schema.Json);

function parseParamsObject(text: string) {
  try {
    // YAML is a superset of JSON, so this reads either form.
    return Option.getOrUndefined(Schema.decodeUnknownOption(ParamsSchema)(parseYaml(text)));
  } catch {
    return undefined;
  }
}

function mergeParams(saved: string, input: string): string {
  const savedParams = parseParamsObject(saved);
  const inputParams = parseParamsObject(input);
  if (savedParams === undefined || inputParams === undefined) {
    return input;
  }
  return JSON.stringify({ ...savedParams, ...inputParams });
}

function normalizeRepo(url: string): string {
  return url.replace(/\/+$/, "").replace(/\.git$/, "");
}

// The saved launch is the base; any input the action sets replaces the saved
// value, except configText (appended so later settings win) and paramsText
// (merged key by key, action keys win).
export function overlayLaunch(saved: LaunchRequest, input: LaunchRequest): LaunchRequest {
  // exactOptionalPropertyTypes keeps unset inputs absent, so a spread only
  // replaces fields the action actually set.
  const merged: LaunchRequest = { ...saved, ...input };

  if (saved.configText !== undefined && input.configText !== undefined) {
    merged.configText = `${saved.configText}\n${input.configText}`;
  }
  if (saved.paramsText !== undefined && input.paramsText !== undefined) {
    merged.paramsText = mergeParams(saved.paramsText, input.paramsText);
  }

  if (
    saved.pipeline !== undefined &&
    input.pipeline !== undefined &&
    normalizeRepo(saved.pipeline) !== normalizeRepo(input.pipeline)
  ) {
    core.warning(
      `Launchpad pipeline repository ${saved.pipeline} differs from the pipeline input ${input.pipeline}; launching ${input.pipeline}`,
    );
  }

  return merged;
}
