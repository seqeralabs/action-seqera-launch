import { Schema } from "effect";

export type JsonValue = Schema.Json;

export function parseJson(rawBody: string): JsonValue {
  return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(rawBody));
}
