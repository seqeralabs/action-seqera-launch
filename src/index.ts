import * as core from "@actions/core";
import { Cause, Effect, Exit } from "effect";
import { runAction } from "./action/run.js";
import {
  ApiDecodeError,
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  formatActionError,
  HttpResponseError,
  HttpTransientError,
  InputValidationError,
  LaunchValidationError,
  type ActionError,
  UnknownWorkflowStatusError,
  WorkflowStuckSubmittedError,
  WorkflowTerminalFailureError,
} from "./errors.js";

function logDebugCause(cause: Cause.Cause<unknown>): void {
  if (!core.isDebug()) {
    return;
  }
  core.debug(Cause.pretty(cause));
}

function asActionError(error: Error): ActionError | undefined {
  if (error instanceof InputValidationError) {
    return error;
  }
  if (error instanceof ApiDecodeError) {
    return error;
  }
  if (error instanceof LaunchValidationError) {
    return error;
  }
  if (error instanceof ComputeEnvNotFoundError) {
    return error;
  }
  if (error instanceof ComputeEnvAmbiguousError) {
    return error;
  }
  if (error instanceof HttpTransientError) {
    return error;
  }
  if (error instanceof HttpResponseError) {
    return error;
  }
  if (error instanceof WorkflowTerminalFailureError) {
    return error;
  }
  if (error instanceof WorkflowStuckSubmittedError) {
    return error;
  }
  if (error instanceof UnknownWorkflowStatusError) {
    return error;
  }
  return undefined;
}

await Effect.runPromiseExit(runAction()).then((exit) => {
  Exit.match(exit, {
    onSuccess: () => {},
    onFailure: (cause) => {
      logDebugCause(cause);
      const squashed = Cause.squash(cause);
      const actionError = squashed instanceof Error ? asActionError(squashed) : undefined;
      if (actionError === undefined) {
        core.setFailed(squashed instanceof Error ? squashed.message : String(squashed));
      } else {
        core.setFailed(formatActionError(actionError));
      }
      process.exitCode = 1;
    },
  });
});
