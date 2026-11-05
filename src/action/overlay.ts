import { Option, Schema } from "effect";
import type { SavedLaunch } from "../api/launchpad.js";
import type { ApiWorkflowLaunchRequest } from "../api/types.js";
import { parseYamlOrJson } from "./inputs.js";

type LaunchRequest = ApiWorkflowLaunchRequest;

export function savedToRequest(saved: SavedLaunch): LaunchRequest {
  const { computeEnv, ...fields } = saved;
  const request: LaunchRequest = fields;
  if (computeEnv?.id !== undefined) {
    request.computeEnvId = computeEnv.id;
  }
  return request;
}

const ParamsSchema = Schema.Record(Schema.String, Schema.Json);

function parseParamsObject(text: string) {
  return Option.getOrUndefined(Schema.decodeUnknownOption(ParamsSchema)(parseYamlOrJson(text)));
}

function normalizeRepo(url: string): string {
  return url.replace(/\/+$/, "").replace(/\.git$/, "");
}

export interface Overlay {
  readonly launch: LaunchRequest;
  readonly warnings: readonly string[];
}

// The saved launch is the base; any input the action sets replaces the saved
// value, except configText (appended so later settings win) and paramsText
// (top-level keys merged, action keys win, written back as JSON).
export function overlayLaunch(saved: LaunchRequest, input: LaunchRequest): Overlay {
  const warnings: string[] = [];
  // exactOptionalPropertyTypes keeps unset inputs absent, so a spread only
  // replaces fields the action actually set.
  const launch: LaunchRequest = { ...saved, ...input };

  if (saved.configText !== undefined && input.configText !== undefined) {
    launch.configText = `${saved.configText}\n${input.configText}`;
  }

  if (saved.paramsText !== undefined && input.paramsText !== undefined) {
    const savedParams = parseParamsObject(saved.paramsText);
    const inputParams = parseParamsObject(input.paramsText);
    if (savedParams === undefined || inputParams === undefined) {
      warnings.push(
        "Launchpad parameters and the parameters input are not both key-value maps; using the parameters input alone",
      );
    } else {
      launch.paramsText = JSON.stringify({ ...savedParams, ...inputParams });
    }
  }

  if (
    saved.pipeline !== undefined &&
    input.pipeline !== undefined &&
    normalizeRepo(saved.pipeline) !== normalizeRepo(input.pipeline)
  ) {
    warnings.push(
      `Launchpad pipeline repository ${saved.pipeline} differs from the pipeline input ${input.pipeline}; launching ${input.pipeline}`,
    );
  }

  return { launch, warnings };
}
