import { Schema } from "effect";
import type { ApiDataStudioDto, ApiDataStudioStatus } from "../types.js";
import { optionalNullable } from "./common.js";

export const STUDIO_STATUSES = [
  "starting",
  "running",
  "stopping",
  "stopped",
  "errored",
  "building",
  "buildFailed",
] as const satisfies readonly ApiDataStudioStatus[];

// Only the fields the action reads.
export const StudioSchema = Schema.Struct({
  sessionId: Schema.String,
  name: optionalNullable(Schema.String),
  studioUrl: optionalNullable(Schema.String),
  waveBuildUrl: optionalNullable(Schema.String),
  statusInfo: optionalNullable(
    Schema.Struct({
      status: optionalNullable(Schema.Literals(STUDIO_STATUSES)),
      message: optionalNullable(Schema.String),
      stopReason: optionalNullable(Schema.String),
    }),
  ),
  remoteConfig: optionalNullable(
    Schema.Struct({
      commitId: optionalNullable(Schema.String),
    }),
  ),
});

export type Studio = Schema.Schema.Type<typeof StudioSchema>;

// Fails the build if a field is renamed or dropped upstream (ADR 0004).
type _AssertTrue<T extends true> = T;
type _AssertStudioFields = _AssertTrue<
  [Exclude<keyof Studio, keyof ApiDataStudioDto>] extends [never] ? true : false
>;

export const StartStudioResponseSchema = Schema.Struct({
  statusInfo: StudioSchema.fields.statusInfo,
});

export const CreateStudioResponseSchema = Schema.Struct({ studio: StudioSchema });

export const ListStudiosResponseSchema = Schema.Struct({
  studios: Schema.Array(StudioSchema),
});
