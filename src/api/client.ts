import { HttpClient, HttpClientError } from "@actions/http-client";
import { Duration, Effect, Schedule, Schema } from "effect";
import { ApiDecodeError, HttpResponseError, HttpTransientError } from "../errors.js";
import { parseJson, type JsonValue } from "../json.js";
import { ErrorResponseSchema } from "./schemas/common.js";

export interface SeqeraClientConfig {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly userAgent?: string;
}

export interface RequestOptions {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly query?: Record<string, string | number | undefined> | undefined;
  readonly body?: unknown;
}

const transportRetrySchedule = Schedule.exponential("1 second").pipe(
  Schedule.jittered,
  Schedule.upTo({ duration: "30 seconds", times: 5 }),
);

function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  if (query !== undefined) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function parseRetryAfterMs(header: string | string[] | undefined): number | undefined {
  if (header === undefined) {
    return undefined;
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function messageFromErrorBody(body: JsonValue, fallback: string): string {
  const decoded = Schema.decodeUnknownOption(ErrorResponseSchema)(body);
  if (decoded._tag === "Some") {
    return decoded.value.message;
  }
  return fallback;
}

export interface SeqeraHttpResponse {
  readonly message: {
    readonly statusCode?: number | undefined;
    readonly headers: Record<string, string | string[] | undefined>;
  };
  readBody(): Promise<string>;
}

export interface SeqeraHttpTransport {
  get(url: string, headers: Record<string, string>): Promise<SeqeraHttpResponse>;
  post(url: string, data: string, headers: Record<string, string>): Promise<SeqeraHttpResponse>;
  patch(url: string, data: string, headers: Record<string, string>): Promise<SeqeraHttpResponse>;
  put(url: string, data: string, headers: Record<string, string>): Promise<SeqeraHttpResponse>;
  del(url: string, headers: Record<string, string>): Promise<SeqeraHttpResponse>;
}

function isTransientStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

function defaultHttpTransport(): SeqeraHttpTransport {
  const client = new HttpClient();
  return {
    get: (url, headers) => client.get(url, headers),
    post: (url, data, headers) => client.post(url, data, headers),
    patch: (url, data, headers) => client.patch(url, data, headers),
    put: (url, data, headers) => client.put(url, data, headers),
    del: (url, headers) => client.del(url, headers),
  };
}

export function createSeqeraClient(
  config: SeqeraClientConfig,
  http: SeqeraHttpTransport = defaultHttpTransport(),
) {
  const headers = {
    Authorization: `Bearer ${config.accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const requestOnce = (
    options: RequestOptions,
  ): Effect.Effect<JsonValue | Record<string, never>, HttpResponseError | HttpTransientError> =>
    Effect.gen(function* () {
      const endpoint = `${options.method} ${options.path}`;
      const url = buildUrl(config.baseUrl, options.path, options.query);
      const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body);

      const response = yield* Effect.tryPromise({
        try: () => {
          switch (options.method) {
            case "GET":
              return http.get(url, headers);
            case "POST":
              return http.post(url, requestBody ?? "", headers);
            case "PATCH":
              return http.patch(url, requestBody ?? "", headers);
            case "PUT":
              return http.put(url, requestBody ?? "", headers);
            case "DELETE":
              return http.del(url, headers);
            default: {
              const _exhaustive: never = options.method;
              throw new Error(`Unsupported HTTP method: ${String(_exhaustive)}`);
            }
          }
        },
        catch: (cause) =>
          new HttpResponseError({
            endpoint,
            statusCode: 0,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      const statusCode = response.message.statusCode ?? 0;
      const rawBody = yield* Effect.tryPromise({
        try: () => response.readBody(),
        catch: (cause) =>
          new HttpResponseError({
            endpoint,
            statusCode,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
      });

      if (isTransientStatus(statusCode)) {
        const retryAfterMs = parseRetryAfterMs(response.message.headers["retry-after"]);
        if (retryAfterMs === undefined) {
          return yield* Effect.fail(
            new HttpTransientError({
              endpoint,
              statusCode,
            }),
          );
        }
        return yield* Effect.fail(
          new HttpTransientError({
            endpoint,
            statusCode,
            retryAfterMs,
          }),
        );
      }

      if (statusCode < 200 || statusCode >= 300) {
        let message = rawBody;
        let parsedBody: JsonValue | undefined;
        try {
          parsedBody = parseJson(rawBody);
          message = messageFromErrorBody(parsedBody, rawBody);
        } catch {
          parsedBody = undefined;
        }
        if (parsedBody === undefined) {
          return yield* Effect.fail(
            new HttpResponseError({
              endpoint,
              statusCode,
              message,
            }),
          );
        }
        return yield* Effect.fail(
          new HttpResponseError({
            endpoint,
            statusCode,
            message,
            body: parsedBody,
          }),
        );
      }

      if (rawBody.length === 0) {
        return {};
      }

      try {
        return parseJson(rawBody);
      } catch (cause) {
        return yield* Effect.fail(
          new HttpResponseError({
            endpoint,
            statusCode,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    });

  const requestJson = <S extends Schema.ConstraintDecoder<unknown>>(
    options: RequestOptions,
    schema: S,
  ): Effect.Effect<S["Type"], ApiDecodeError | HttpResponseError | HttpTransientError> =>
    Effect.gen(function* () {
      const endpoint = `${options.method} ${options.path}`;
      const payload: JsonValue | Record<string, never> = yield* requestOnce(options).pipe(
        Effect.retry({
          while: (error) => error._tag === "HttpTransientError",
          schedule: transportRetrySchedule,
        }),
        Effect.catchTag("HttpTransientError", (error) =>
          error.retryAfterMs === undefined
            ? Effect.fail(error)
            : Effect.sleep(Duration.millis(error.retryAfterMs)).pipe(
                Effect.flatMap(() => Effect.fail(error)),
              ),
        ),
      );

      return yield* Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(payload),
        catch: (issue) =>
          new ApiDecodeError({
            endpoint,
            detail: issue instanceof Error ? issue.message : String(issue),
          }),
      });
    });

  return { requestJson, requestOnce, config };
}

export type SeqeraClient = ReturnType<typeof createSeqeraClient>;

export function isHttpClientError(error: Error): error is HttpClientError {
  return error instanceof HttpClientError;
}
