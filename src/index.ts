import * as core from "@actions/core";
import { Cause, Effect, Exit } from "effect";
import { runAction } from "./action/run.js";
import { formatActionError, isActionErrorTag, type ActionError } from "./errors.js";

function logDebugCause(cause: Cause.Cause<unknown>): void {
  if (!core.isDebug()) {
    return;
  }
  core.debug(Cause.pretty(cause));
}

// Every ActionError is a Data.TaggedError, so dispatch on the tag rather than
// an instanceof allowlist that silently drops newly added error types.
function asActionError(error: Error): ActionError | undefined {
  const tag: unknown = (error as { _tag?: unknown })._tag;
  if (typeof tag === "string" && isActionErrorTag(tag)) {
    return error as ActionError;
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
