import type { SeqeraHttpResponse, SeqeraHttpTransport } from "../../src/api/client.js";

export class MockHttpResponse implements SeqeraHttpResponse {
  constructor(
    readonly message: {
      statusCode?: number;
      headers: Record<string, string | string[] | undefined>;
    },
    private readonly body: string,
  ) {}

  readBody(): Promise<string> {
    return Promise.resolve(this.body);
  }
}

type Handler = (url: string, method: string, body: string | undefined) => MockHttpResponse;

export class MockHttpClient implements SeqeraHttpTransport {
  private readonly rules: Array<{ matcher: RegExp | string; handler: Handler }> = [];

  when(matcher: RegExp | string, handler: Handler): this {
    this.rules.push({ matcher, handler });
    return this;
  }

  private matches(url: string, matcher: RegExp | string): boolean {
    if (matcher instanceof RegExp) {
      return matcher.test(url);
    }
    return url.includes(matcher);
  }

  private dispatch(url: string, method: string, body?: string): Promise<MockHttpResponse> {
    for (const rule of this.rules) {
      if (this.matches(url, rule.matcher)) {
        return Promise.resolve(rule.handler(url, method, body));
      }
    }
    return Promise.resolve(new MockHttpResponse({ statusCode: 404, headers: {} }, "not found"));
  }

  get(url: string, _headers: Record<string, string>): Promise<SeqeraHttpResponse> {
    return this.dispatch(url, "GET");
  }

  post(url: string, data: string, _headers: Record<string, string>): Promise<SeqeraHttpResponse> {
    return this.dispatch(url, "POST", data);
  }

  put(url: string, data: string, _headers: Record<string, string>): Promise<SeqeraHttpResponse> {
    return this.dispatch(url, "PUT", data);
  }
}
