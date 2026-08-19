import * as core from "@actions/core";

/**
 * Scaffold entrypoint. The launch and monitoring behaviour is decided in
 * issues #4 and #5; this exists so the bundle, the action manifest, and CI
 * have something real to exercise.
 */
function run(): void {
  core.setFailed("action-seqera-launch is not implemented yet");
}

run();
