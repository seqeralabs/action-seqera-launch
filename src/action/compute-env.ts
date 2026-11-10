import { Effect } from "effect";
import type { SeqeraClient } from "../api/client.js";
import { listComputeEnvs } from "../api/endpoints.js";
import type { ListComputeEnvsResponseEntry } from "../api/schemas/compute-env.js";
import {
  ComputeEnvAmbiguousError,
  ComputeEnvNotFoundError,
  ComputeEnvNoPrimaryError,
  ComputeEnvUnavailableError,
} from "../errors.js";

export function resolveComputeEnv(
  client: SeqeraClient,
  workspaceId: number | undefined,
  computeEnvId: string | undefined,
  computeEnvName: string | undefined,
) {
  return Effect.gen(function* () {
    // An explicit id is taken on trust: we cannot look up its work directory
    // without knowing which workspace listing it belongs to.
    if (computeEnvId !== undefined) {
      return { computeEnvId, label: computeEnvId, workDir: undefined };
    }

    const listed = yield* listComputeEnvs(client, workspaceId);
    const entries = listed.computeEnvs ?? [];

    if (computeEnvName === undefined) {
      // Launching without a compute environment relies on the workspace having
      // a primary one. The API answers an empty 403 when it does not, so check
      // here to produce an actionable message instead.
      const primary = entries.find((entry: ListComputeEnvsResponseEntry) => entry.primary === true);
      if (primary === undefined) {
        return yield* Effect.fail(
          new ComputeEnvNoPrimaryError({
            available: entries.map((entry: ListComputeEnvsResponseEntry) => entry.name),
          }),
        );
      }
      if (primary.status !== undefined && primary.status !== "AVAILABLE") {
        return yield* Effect.fail(
          new ComputeEnvUnavailableError({ name: primary.name, status: primary.status }),
        );
      }
      return {
        computeEnvId: primary.id,
        label: `${primary.name} (primary)`,
        workDir: primary.workDir,
      };
    }

    const matches = entries.filter(
      (entry: ListComputeEnvsResponseEntry) => entry.name === computeEnvName,
    );

    if (matches.length === 0) {
      const available = entries.map((entry: ListComputeEnvsResponseEntry) => entry.name);
      return yield* Effect.fail(
        new ComputeEnvNotFoundError({
          name: computeEnvName,
          available,
        }),
      );
    }

    if (matches.length > 1) {
      return yield* Effect.fail(
        new ComputeEnvAmbiguousError({
          name: computeEnvName,
          matches: matches.map(
            (entry: ListComputeEnvsResponseEntry) => `${entry.name} (${entry.id})`,
          ),
        }),
      );
    }

    const match = matches[0]!;
    if (match.status !== undefined && match.status !== "AVAILABLE") {
      return yield* Effect.fail(
        new ComputeEnvUnavailableError({ name: match.name, status: match.status }),
      );
    }

    return { computeEnvId: match.id, label: computeEnvName, workDir: match.workDir };
  });
}
