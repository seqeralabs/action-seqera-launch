import { Effect, Option, Schema } from "effect";
import { HttpResponseError, LaunchValidationError } from "../errors.js";
import type { SeqeraClient } from "./client.js";
import { workspaceQuery } from "./endpoints.js";
import { ErrorResponseSchema } from "./schemas/common.js";
import {
  CreateStudioResponseSchema,
  ListStudiosResponseSchema,
  StartStudioResponseSchema,
  StudioSchema,
  type Studio,
} from "./schemas/studio.js";
import type { ApiDataStudioCreateRequest } from "./types.js";

// shortcut: reads one page of name-search results; page if a search for an
// exact name ever returns more than 100 studios.
export function findStudioByName(
  client: SeqeraClient,
  workspaceId: number | undefined,
  name: string,
) {
  return client
    .requestJson(
      {
        method: "GET",
        path: "/studios",
        query: { ...workspaceQuery(workspaceId), search: name, max: 100 },
      },
      ListStudiosResponseSchema,
    )
    .pipe(Effect.map((listed) => listed.studios.find((studio) => studio.name === name)));
}

export function describeStudio(
  client: SeqeraClient,
  sessionId: string,
  workspaceId: number | undefined,
) {
  return client.requestJson(
    { method: "GET", path: `/studios/${sessionId}`, query: workspaceQuery(workspaceId) },
    StudioSchema,
  );
}

export function startStudio(
  client: SeqeraClient,
  sessionId: string,
  workspaceId: number | undefined,
) {
  return client.requestJson(
    {
      method: "POST",
      path: `/studios/${sessionId}/start`,
      query: workspaceQuery(workspaceId),
      body: {},
      retryTransient: false,
    },
    StartStudioResponseSchema,
  );
}

export type StudioCreateResult =
  | { readonly _tag: "Created"; readonly studio: Studio }
  | { readonly _tag: "Existing"; readonly studio: Studio };

// "Existing" means another job created the same name first (409).
export function createStudio(
  client: SeqeraClient,
  workspaceId: number | undefined,
  autoStart: boolean,
  request: ApiDataStudioCreateRequest,
) {
  return client
    .requestJson(
      {
        method: "POST",
        path: "/studios",
        query: { ...workspaceQuery(workspaceId), autoStart: String(autoStart) },
        body: request,
        retryTransient: false,
      },
      CreateStudioResponseSchema,
    )
    .pipe(
      Effect.map((created): StudioCreateResult => ({ _tag: "Created", studio: created.studio })),
      Effect.catchIf(
        (error): error is HttpResponseError =>
          error._tag === "HttpResponseError" && error.statusCode === 409,
        (error) =>
          Effect.gen(function* () {
            const winner = yield* findStudioByName(client, workspaceId, request.name);
            if (winner === undefined) {
              return yield* error;
            }
            const existing: StudioCreateResult = { _tag: "Existing", studio: winner };
            return existing;
          }),
      ),
      Effect.catchIf(
        (error): error is HttpResponseError =>
          error._tag === "HttpResponseError" && error.statusCode === 400,
        (error) => {
          const body = Schema.decodeUnknownOption(ErrorResponseSchema)(error.body);
          const message = Option.isSome(body) ? body.value.message : error.message;
          return Effect.fail(new LaunchValidationError({ message: `Studio rejected: ${message}` }));
        },
      ),
    );
}
