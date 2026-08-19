import * as core from "@actions/core";
import { Cause, Effect, Exit } from "effect";
import { asActionError } from "./action-errors.js";
import { actionSeqeraClientFactory } from "./action/client-factory.js";
import { runAction } from "./action/run.js";
import { formatActionError } from "./errors.js";

function logDebugCause(cause: Cause.Cause<unknown>): void {
  if (!core.isDebug()) {
    return;
  }
  core.debug(Cause.pretty(cause));
}

await Effect.runPromiseExit(runAction(actionSeqeraClientFactory)).then((exit) => {
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
