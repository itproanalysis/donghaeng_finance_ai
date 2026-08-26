import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClaudeProviderError,
  createAnthropicMessagesClientFromEnvironment,
  type AnthropicRuntimeEnvironment,
} from "../../src/ai/anthropic-messages";

const TEST_API_KEY = `sk-ant-${"a".repeat(40)}`;

function environment(
  overrides: Partial<AnthropicRuntimeEnvironment> = {},
): AnthropicRuntimeEnvironment {
  return {
    ANTHROPIC_API_KEY: TEST_API_KEY,
    DONGHAENG_ANTHROPIC_MODEL: "claude-sonnet-5",
    DONGHAENG_ANTHROPIC_TIMEOUT_MS: "5000",
    DONGHAENG_ANTHROPIC_MAX_TOKENS: "2048",
    ...overrides,
  };
}

function successBody(input: Record<string, unknown>) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [
      {
        type: "tool_use",
        id: "toolu_test",
        name: "commit_result",
        input,
        caller: { type: "direct" },
      },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 41, output_tokens: 17 },
  };
}

const toolRequest = {
  system: "Return only the forced tool call.",
  user: { sourceTranscript: "월 매출은 2천만원입니다." },
  tool: {
    name: "commit_result",
    description:
      "Commit one structured test result. This is used only to verify the Messages API boundary. " +
      "It must return the supplied schema and no prose.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
    },
  },
} as const;

afterEach(() => {
  vi.useRealTimers();
});

describe("Anthropic Messages structured-tool client", () => {
  it("fails startup closed unless ANTHROPIC_API_KEY and bounded settings are valid", () => {
    expect(() =>
      createAnthropicMessagesClientFromEnvironment({
        // An unrelated credential must never be accepted as a fallback.
        ...({ OPENAI_API_KEY: "not-an-anthropic-key" } as Record<string, string>),
      }),
    ).toThrowError(ClaudeProviderError);
    expect(() =>
      createAnthropicMessagesClientFromEnvironment(
        environment({ DONGHAENG_ANTHROPIC_TIMEOUT_MS: "999" }),
      ),
    ).toThrow(/DONGHAENG_ANTHROPIC_TIMEOUT_MS/);
    expect(() =>
      createAnthropicMessagesClientFromEnvironment(
        environment({ DONGHAENG_ANTHROPIC_MAX_TOKENS: "999999" }),
      ),
    ).toThrow(/DONGHAENG_ANTHROPIC_MAX_TOKENS/);
    expect(() =>
      createAnthropicMessagesClientFromEnvironment(
        environment({ DONGHAENG_ANTHROPIC_MODEL: "claude-unapproved-typo" }),
      ),
    ).toThrow(/model allow-list/);
  });

  it("uses the pinned production defaults without exposing the credential", () => {
    const client = createAnthropicMessagesClientFromEnvironment({
      ANTHROPIC_API_KEY: TEST_API_KEY,
    });
    expect(client).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-5",
      timeoutMs: 20_000,
      maxTokens: 2_304,
    });
    expect(JSON.stringify(client)).not.toContain(TEST_API_KEY);
  });

  it("keeps Sonnet 5 as an explicit approved higher-latency override", () => {
    const client = createAnthropicMessagesClientFromEnvironment(environment({
      DONGHAENG_ANTHROPIC_MODEL: "claude-sonnet-5",
    }));
    expect(client.model).toBe("claude-sonnet-5");
  });

  it("calls only the official endpoint with a forced single tool and returns safe metadata", async () => {
    let capturedInput: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      capturedInput = input;
      capturedInit = init;
      return new Response(JSON.stringify(successBody({ accepted: true })), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "request-id": "req_test-123",
        },
      });
    });
    const client = createAnthropicMessagesClientFromEnvironment(environment(), {
      fetchImpl,
    });

    await expect(client.createToolResult(toolRequest)).resolves.toEqual({
      input: { accepted: true },
      metadata: {
        provider: "anthropic",
        model: "claude-sonnet-5",
        requestId: "req_test-123",
        inputTokens: 41,
        outputTokens: 17,
        stopReason: "tool_use",
      },
    });
    expect(String(capturedInput)).toBe("https://api.anthropic.com/v1/messages");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.redirect).toBe("error");
    expect(new Headers(capturedInit?.headers).get("x-api-key")).toBe(TEST_API_KEY);
    expect(new Headers(capturedInit?.headers).get("anthropic-version")).toBe(
      "2023-06-01",
    );
    const requestBody = JSON.parse(String(capturedInit?.body));
    expect(requestBody).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      thinking: { type: "disabled" },
      tool_choice: {
        type: "tool",
        name: "commit_result",
        disable_parallel_tool_use: true,
      },
    });
    expect(requestBody.messages).toEqual([
      { role: "user", content: JSON.stringify(toolRequest.user) },
    ]);
    expect(requestBody).not.toHaveProperty("temperature");
    expect(requestBody.tools).toEqual([
      expect.objectContaining({
        name: "commit_result",
        strict: true,
        allowed_callers: ["direct"],
      }),
    ]);
    expect(JSON.stringify(requestBody)).not.toContain(TEST_API_KEY);
    expect(Object.keys(client)).not.toContain("apiKey");
  });

  it("honors a smaller request-local token ceiling without changing the client default", async () => {
    let capturedInit: RequestInit | undefined;
    const client = createAnthropicMessagesClientFromEnvironment(environment(), {
      fetchImpl: vi.fn<typeof fetch>(async (_input, init) => {
        capturedInit = init;
        return new Response(JSON.stringify(successBody({ accepted: true })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    });

    await client.createToolResult({ ...toolRequest, maxTokens: 192 });

    expect(JSON.parse(String(capturedInit?.body)).max_tokens).toBe(192);
    expect(client.maxTokens).toBe(2_048);
    await expect(
      client.createToolResult({ ...toolRequest, maxTokens: 2_049 }),
    ).rejects.toMatchObject({ code: "CLAUDE_REQUEST_INVALID" });
  });

  it.each([
    {
      name: "thinking",
      block: {
        type: "thinking",
        thinking: "Internal reasoning is intentionally ignored.",
        signature: "sig_test",
      },
    },
    {
      name: "redacted thinking",
      block: { type: "redacted_thinking", data: "redacted_test" },
    },
  ])("accepts a single tool call after optional $name", async ({ block }) => {
    const body = successBody({ accepted: true });
    const client = createAnthropicMessagesClientFromEnvironment(environment(), {
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(
          JSON.stringify({ ...body, content: [block, ...body.content] }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    });

    await expect(client.createToolResult(toolRequest)).resolves.toMatchObject({
      input: { accepted: true },
      metadata: { stopReason: "tool_use" },
    });
  });

  it("allows an HTTP endpoint only behind the exact production E2E loopback gate", async () => {
    let capturedInput: string | URL | Request | undefined;
    const client = createAnthropicMessagesClientFromEnvironment(
      environment({
        NODE_ENV: "production",
        DONGHAENG_ANTHROPIC_ENDPOINT:
          "http://127.0.0.1:43124/v1/messages",
        DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
      }),
      {
        fetchImpl: vi.fn<typeof fetch>(async (input) => {
          capturedInput = input;
          return new Response(JSON.stringify(successBody({ accepted: true })), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }),
      },
    );
    await client.createToolResult(toolRequest);
    expect(String(capturedInput)).toBe(
      "http://127.0.0.1:43124/v1/messages",
    );
  });

  it.each([
    {
      name: "non-exact allow value",
      overrides: {
        NODE_ENV: "production",
        DONGHAENG_ANTHROPIC_ENDPOINT: "http://localhost:43124/v1/messages",
        DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "true",
      },
    },
    {
      name: "non-production runtime",
      overrides: {
        NODE_ENV: "development",
        DONGHAENG_ANTHROPIC_ENDPOINT: "http://localhost:43124/v1/messages",
        DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
      },
    },
    {
      name: "non-loopback host",
      overrides: {
        NODE_ENV: "production",
        DONGHAENG_ANTHROPIC_ENDPOINT: "http://anthropic.example.test/v1/messages",
        DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
      },
    },
    {
      name: "custom HTTPS host",
      overrides: {
        NODE_ENV: "production",
        DONGHAENG_ANTHROPIC_ENDPOINT: "https://anthropic.example.test/v1/messages",
        DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
      },
    },
    {
      name: "loopback path outside Messages API",
      overrides: {
        NODE_ENV: "production",
        DONGHAENG_ANTHROPIC_ENDPOINT: "http://127.0.0.1:43124/collect",
        DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
      },
    },
  ])("rejects endpoint override: $name", ({ overrides }) => {
    expect(() =>
      createAnthropicMessagesClientFromEnvironment(environment(overrides)),
    ).toThrow(/endpoint overrides are forbidden/);
  });

  it.each([
    {
      name: "plain text instead of tool use",
      body: {
        ...successBody({ accepted: true }),
        stop_reason: "end_turn",
        content: [{ type: "text", text: "accepted" }],
      },
    },
    {
      name: "truncated output",
      body: { ...successBody({ accepted: true }), stop_reason: "max_tokens" },
    },
    {
      name: "multiple tool calls",
      body: {
        ...successBody({ accepted: true }),
        content: [
          successBody({ accepted: true }).content[0],
          successBody({ accepted: false }).content[0],
        ],
      },
    },
    {
      name: "text beside the tool call",
      body: {
        ...successBody({ accepted: true }),
        content: [
          { type: "text", text: "accepted" },
          successBody({ accepted: true }).content[0],
        ],
      },
    },
    {
      name: "thinking without a tool call",
      body: {
        ...successBody({ accepted: true }),
        content: [
          { type: "thinking", thinking: "No tool", signature: "sig_test" },
        ],
      },
    },
    {
      name: "unknown block beside the tool call",
      body: {
        ...successBody({ accepted: true }),
        content: [
          { type: "server_tool_use", id: "srv_test" },
          successBody({ accepted: true }).content[0],
        ],
      },
    },
    {
      name: "wrong tool name",
      body: {
        ...successBody({ accepted: true }),
        content: [
          { ...successBody({ accepted: true }).content[0], name: "other_tool" },
        ],
      },
    },
    {
      name: "missing caller",
      body: {
        ...successBody({ accepted: true }),
        content: [
          {
            type: "tool_use",
            id: "toolu_test",
            name: "commit_result",
            input: { accepted: true },
          },
        ],
      },
    },
    {
      name: "non-direct caller",
      body: {
        ...successBody({ accepted: true }),
        content: [
          {
            ...successBody({ accepted: true }).content[0],
            caller: {
              type: "code_execution_20260120",
              tool_id: "srvtoolu_test",
            },
          },
        ],
      },
    },
    {
      name: "caller with an additional field",
      body: {
        ...successBody({ accepted: true }),
        content: [
          {
            ...successBody({ accepted: true }).content[0],
            caller: { type: "direct", tool_id: "unexpected" },
          },
        ],
      },
    },
    {
      name: "unexpected tool block field",
      body: {
        ...successBody({ accepted: true }),
        content: [
          { ...successBody({ accepted: true }).content[0], providerScore: 1 },
        ],
      },
    },
    {
      name: "missing token usage",
      body: { ...successBody({ accepted: true }), usage: {} },
    },
  ])("rejects $name", async ({ body }) => {
    const client = createAnthropicMessagesClientFromEnvironment(environment(), {
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    await expect(client.createToolResult(toolRequest)).rejects.toMatchObject({
      code: "CLAUDE_RESPONSE_INVALID",
      retryable: false,
    });
  });

  it("classifies throttling and outages as retryable without exposing an error body", async () => {
    for (const [status, retryable] of [
      [401, false],
      [429, true],
      [529, true],
    ] as const) {
      const client = createAnthropicMessagesClientFromEnvironment(environment(), {
        fetchImpl: vi.fn<typeof fetch>(async () =>
          new Response(JSON.stringify({ error: { message: "provider-secret-detail" } }), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      });
      let caught: unknown;
      try {
        await client.createToolResult(toolRequest);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "CLAUDE_HTTP_ERROR",
        retryable,
        status,
      });
      expect(String(caught)).not.toContain("provider-secret-detail");
      expect(String(caught)).not.toContain(TEST_API_KEY);
    }
  });

  it("aborts a provider call at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
    );
    const client = createAnthropicMessagesClientFromEnvironment(
      environment({ DONGHAENG_ANTHROPIC_TIMEOUT_MS: "1000" }),
      { fetchImpl },
    );

    const pending = client.createToolResult(toolRequest);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CLAUDE_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it("keeps the timeout active while reading a chunked response body", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(new TextEncoder().encode('{"type":"message"'));
        },
      });
      init?.signal?.addEventListener(
        "abort",
        () => streamController.error(new DOMException("aborted", "AbortError")),
        { once: true },
      );
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createAnthropicMessagesClientFromEnvironment(
      environment({ DONGHAENG_ANTHROPIC_TIMEOUT_MS: "1000" }),
      { fetchImpl },
    );

    const pending = client.createToolResult(toolRequest);
    const rejected = expect(pending).rejects.toMatchObject({
      code: "CLAUDE_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it("rejects an oversized response before parsing it", async () => {
    const client = createAnthropicMessagesClientFromEnvironment(environment(), {
      fetchImpl: vi.fn<typeof fetch>(async () =>
        new Response("{}", {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "1000001",
          },
        }),
      ),
    });
    await expect(client.createToolResult(toolRequest)).rejects.toMatchObject({
      code: "CLAUDE_RESPONSE_TOO_LARGE",
      retryable: false,
    });
  });
});
