import * as core from "@actions/core";
import { Cause, Effect, Exit, Option } from "effect";
import { runAction } from "./action/run.js";
import { formatActionError } from "./errors.js";

function logDebugCause(cause: Cause.Cause<unknown>): void {
  if (!core.isDebug()) {
    return;
  }
  core.debug(Cause.pretty(cause));
}

await Effect.runPromiseExit(runAction()).then((exit) => {
  Exit.match(exit, {
    onSuccess: () => {},
    onFailure: (cause) => {
      logDebugCause(cause);
      const failure = Cause.findErrorOption(cause);
      if (Option.isSome(failure)) {
        core.setFailed(formatActionError(failure.value));
      } else {
        const squashed = Cause.squash(cause);
        core.setFailed(squashed instanceof Error ? squashed.message : String(squashed));
      }
      process.exitCode = 1;
    },
  });
});
