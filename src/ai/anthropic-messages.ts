const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const APPROVED_MODELS = new Set([DEFAULT_MODEL]);
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 4_096;
const MAX_REQUEST_BYTES = 512_000;
const MAX_RESPONSE_BYTES = 1_000_000;

type JsonObject = Record<string, unknown>;

export type ClaudeProviderErrorCode =
  | "CLAUDE_CONFIGURATION_INVALID"
  | "CLAUDE_REQUEST_INVALID"
  | "CLAUDE_REQUEST_TOO_LARGE"
  | "CLAUDE_TIMEOUT"
  | "CLAUDE_NETWORK_ERROR"
  | "CLAUDE_HTTP_ERROR"
  | "CLAUDE_RESPONSE_TOO_LARGE"
  | "CLAUDE_RESPONSE_INVALID";

export class ClaudeProviderError extends Error {
  readonly name = "ClaudeProviderError";

  constructor(
    readonly code: ClaudeProviderErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface AnthropicRuntimeEnvironment {
  ANTHROPIC_API_KEY?: string;
  DONGHAENG_ANTHROPIC_MODEL?: string;
  DONGHAENG_ANTHROPIC_TIMEOUT_MS?: string;
  DONGHAENG_ANTHROPIC_MAX_TOKENS?: string;
  DONGHAENG_ANTHROPIC_ENDPOINT?: string;
  DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK?: string;
  NODE_ENV?: string;
}

export interface AnthropicStructuredTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
}

export interface AnthropicStructuredToolRequest {
  system: string;
  user: unknown;
  tool: AnthropicStructuredTool;
}

export interface ClaudeCallMetadata {
  provider: "anthropic";
  model: string;
  requestId: string | null;
  inputTokens: number;
  outputTokens: number;
  stopReason: "tool_use";
}

export interface AnthropicStructuredToolResult {
  input: JsonObject;
  metadata: ClaudeCallMetadata;
}

export interface AnthropicMessagesClient {
  readonly provider: "anthropic";
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  createToolResult(
    request: AnthropicStructuredToolRequest,
  ): Promise<AnthropicStructuredToolResult>;
}

export interface AnthropicClientDependencies {
  fetchImpl?: typeof fetch;
}

function configurationError(message: string): ClaudeProviderError {
  return new ClaudeProviderError(
    "CLAUDE_CONFIGURATION_INVALID",
    message,
    false,
  );
}

function parseIntegerSetting(
  raw: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw configurationError(`${label} must be an integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw configurationError(
      `${label} must be between ${minimum} and ${maximum}.`,
    );
  }
  return value;
}

function readConfiguration(environment: AnthropicRuntimeEnvironment) {
  const apiKey = environment.ANTHROPIC_API_KEY?.trim() ?? "";
  if (
    apiKey.length < 24 ||
    apiKey.length > 512 ||
    !/^sk-ant-[A-Za-z0-9_-]+$/.test(apiKey)
  ) {
    throw configurationError(
      "ANTHROPIC_API_KEY must contain a valid Anthropic API credential.",
    );
  }

  const model = environment.DONGHAENG_ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  if (
    model.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(model)
  ) {
    throw configurationError("DONGHAENG_ANTHROPIC_MODEL is invalid.");
  }
  if (!APPROVED_MODELS.has(model)) {
    throw configurationError(
      "DONGHAENG_ANTHROPIC_MODEL is not in the deployed model allow-list.",
    );
  }

  return {
    apiKey,
    model,
    endpoint: readEndpoint(environment),
    timeoutMs: parseIntegerSetting(
      environment.DONGHAENG_ANTHROPIC_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      "DONGHAENG_ANTHROPIC_TIMEOUT_MS",
      1_000,
      120_000,
    ),
    maxTokens: parseIntegerSetting(
      environment.DONGHAENG_ANTHROPIC_MAX_TOKENS,
      DEFAULT_MAX_TOKENS,
      "DONGHAENG_ANTHROPIC_MAX_TOKENS",
      128,
      16_384,
    ),
  };
}

function readEndpoint(environment: AnthropicRuntimeEnvironment): URL {
  const raw = environment.DONGHAENG_ANTHROPIC_ENDPOINT?.trim();
  if (!raw) return new URL(ANTHROPIC_MESSAGES_ENDPOINT);

  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw configurationError("DONGHAENG_ANTHROPIC_ENDPOINT is invalid.");
  }
  if (
    endpoint.toString() === ANTHROPIC_MESSAGES_ENDPOINT ||
    endpoint.toString() === `${ANTHROPIC_MESSAGES_ENDPOINT}/`
  ) {
    return new URL(ANTHROPIC_MESSAGES_ENDPOINT);
  }

  const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  const exactE2eLoopbackOverride =
    environment.NODE_ENV?.trim().toLowerCase() === "production" &&
    environment.DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK === "1" &&
    endpoint.protocol === "http:" &&
    loopbackHosts.has(endpoint.hostname.toLowerCase()) &&
    endpoint.pathname === "/v1/messages" &&
    endpoint.username === "" &&
    endpoint.password === "" &&
    endpoint.search === "" &&
    endpoint.hash === "";
  if (!exactE2eLoopbackOverride) {
    throw configurationError(
      "Claude endpoint overrides are forbidden outside the exact production E2E loopback gate.",
    );
  }
  return endpoint;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateTool(tool: AnthropicStructuredTool): void {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(tool.name)) {
    throw new ClaudeProviderError(
      "CLAUDE_REQUEST_INVALID",
      "Anthropic tool name is invalid.",
      false,
    );
  }
  if (!tool.description.trim() || tool.description.length > 8_000) {
    throw new ClaudeProviderError(
      "CLAUDE_REQUEST_INVALID",
      "Anthropic tool description is invalid.",
      false,
    );
  }
  if (!isRecord(tool.inputSchema)) {
    throw new ClaudeProviderError(
      "CLAUDE_REQUEST_INVALID",
      "Anthropic tool input schema must be an object.",
      false,
    );
  }
}

async function readBoundedUtf8(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLengthHeader = response.headers.get("content-length");
  if (declaredLengthHeader !== null) {
    const declaredLength = Number(declaredLengthHeader);
    if (
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maximumBytes
    ) {
      void response.body?.cancel().catch(() => undefined);
      throw new ClaudeProviderError(
        "CLAUDE_RESPONSE_TOO_LARGE",
        "Claude response exceeded the configured byte limit.",
        false,
        response.status,
      );
    }
  }

  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ClaudeProviderError(
          "CLAUDE_RESPONSE_TOO_LARGE",
          "Claude response exceeded the configured byte limit.",
          false,
          response.status,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ClaudeProviderError(
      "CLAUDE_RESPONSE_INVALID",
      "Claude returned a response that was not valid UTF-8.",
      false,
      response.status,
    );
  }
}

function safeCancel(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function safeRequestId(response: Response): string | null {
  const value = response.headers.get("request-id")?.trim() ?? "";
  return value && value.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(value)
    ? value
    : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseToolResult(
  body: unknown,
  expectedToolName: string,
  response: Response,
): AnthropicStructuredToolResult {
  if (!isRecord(body)) {
    throw new ClaudeProviderError(
      "CLAUDE_RESPONSE_INVALID",
      "Claude response must be a JSON object.",
      false,
    );
  }
  const responseModel = body.model;
  const usage = body.usage;
  const inputTokens = isRecord(usage)
    ? parseNonNegativeInteger(usage.input_tokens)
    : null;
  const outputTokens = isRecord(usage)
    ? parseNonNegativeInteger(usage.output_tokens)
    : null;
  if (
    body.type !== "message" ||
    body.role !== "assistant" ||
    body.stop_reason !== "tool_use" ||
    typeof responseModel !== "string" ||
    !responseModel ||
    responseModel.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(responseModel) ||
    inputTokens === null ||
    outputTokens === null ||
    !Array.isArray(body.content)
  ) {
    throw new ClaudeProviderError(
      "CLAUDE_RESPONSE_INVALID",
      "Claude response did not contain exactly one completed tool call.",
      false,
    );
  }

  const toolBlocks: Array<Record<string, unknown>> = [];
  for (const contentBlock of body.content) {
    if (!isRecord(contentBlock)) {
      throw new ClaudeProviderError(
        "CLAUDE_RESPONSE_INVALID",
        "Claude content block is invalid.",
        false,
      );
    }
    if (
      contentBlock.type === "thinking" ||
      contentBlock.type === "redacted_thinking"
    ) {
      continue;
    }
    if (contentBlock.type === "tool_use") {
      toolBlocks.push(contentBlock);
      continue;
    }
    throw new ClaudeProviderError(
      "CLAUDE_RESPONSE_INVALID",
      "Claude response contained an unexpected content block.",
      false,
    );
  }
  if (toolBlocks.length !== 1) {
    throw new ClaudeProviderError(
      "CLAUDE_RESPONSE_INVALID",
      "Claude response did not contain exactly one tool call.",
      false,
    );
  }

  const block = toolBlocks[0];
  const caller = block.caller;
  const allowedKeys = new Set(["type", "id", "name", "input", "caller"]);
  if (
    Object.keys(block).some((key) => !allowedKeys.has(key)) ||
    block.type !== "tool_use" ||
    typeof block.id !== "string" ||
    !block.id ||
    block.id.length > 256 ||
    block.name !== expectedToolName ||
    !isRecord(block.input) ||
    !isRecord(caller) ||
    Object.keys(caller).length !== 1 ||
    caller.type !== "direct"
  ) {
    throw new ClaudeProviderError(
      "CLAUDE_RESPONSE_INVALID",
      "Claude tool call did not satisfy the strict response contract.",
      false,
    );
  }
  return {
    input: block.input,
    metadata: {
      provider: "anthropic",
      model: responseModel,
      requestId: safeRequestId(response),
      inputTokens,
      outputTokens,
      stopReason: "tool_use",
    },
  };
}

/**
 * Creates a client whose credential can only come from ANTHROPIC_API_KEY.
 * The key remains captured in this closure and is not exposed on the client,
 * error objects, provider labels, request payloads, or logs.
 */
export function createAnthropicMessagesClientFromEnvironment(
  environment: AnthropicRuntimeEnvironment = process.env as AnthropicRuntimeEnvironment,
  dependencies: AnthropicClientDependencies = {},
): AnthropicMessagesClient {
  const { apiKey, model, endpoint, timeoutMs, maxTokens } = readConfiguration(environment);
  const fetchImpl = dependencies.fetchImpl ?? fetch;

  return Object.freeze({
    provider: "anthropic" as const,
    model,
    timeoutMs,
    maxTokens,
    async createToolResult(
      request: AnthropicStructuredToolRequest,
    ): Promise<AnthropicStructuredToolResult> {
      validateTool(request.tool);
      if (!request.system.trim() || request.system.length > 32_000) {
        throw new ClaudeProviderError(
          "CLAUDE_REQUEST_INVALID",
          "Claude system instruction is invalid.",
          false,
        );
      }

      let bodyText: string;
      try {
        bodyText = JSON.stringify({
          model,
          max_tokens: maxTokens,
          thinking: { type: "disabled" },
          system: request.system,
          messages: [
            {
              role: "user",
              content: JSON.stringify(request.user),
            },
          ],
          tools: [
            {
              name: request.tool.name,
              description: request.tool.description,
              input_schema: request.tool.inputSchema,
              strict: true,
              allowed_callers: ["direct"],
            },
          ],
          tool_choice: {
            type: "tool",
            name: request.tool.name,
            disable_parallel_tool_use: true,
          },
        });
      } catch {
        throw new ClaudeProviderError(
          "CLAUDE_REQUEST_INVALID",
          "Claude request could not be serialized as JSON.",
          false,
        );
      }
      if (new TextEncoder().encode(bodyText).byteLength > MAX_REQUEST_BYTES) {
        throw new ClaudeProviderError(
          "CLAUDE_REQUEST_TOO_LARGE",
          "Claude request exceeded the configured byte limit.",
          false,
        );
      }

      const controller = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            accept: "application/json",
            "anthropic-version": ANTHROPIC_API_VERSION,
            "content-type": "application/json",
            "x-api-key": apiKey,
          },
          body: bodyText,
          signal: controller.signal,
        });

        if (!response.ok) {
          safeCancel(response);
          throw new ClaudeProviderError(
            "CLAUDE_HTTP_ERROR",
            `Claude request failed with HTTP ${response.status}.`,
            isRetryableHttpStatus(response.status),
            response.status,
          );
        }
        const mediaType =
          response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
        if (mediaType !== "application/json") {
          safeCancel(response);
          throw new ClaudeProviderError(
            "CLAUDE_RESPONSE_INVALID",
            "Claude response was not application/json.",
            false,
            response.status,
          );
        }

        const responseText = await readBoundedUtf8(response, MAX_RESPONSE_BYTES);
        let responseBody: unknown;
        try {
          responseBody = JSON.parse(responseText);
        } catch {
          throw new ClaudeProviderError(
            "CLAUDE_RESPONSE_INVALID",
            "Claude response was not valid JSON.",
            false,
            response.status,
          );
        }
        return parseToolResult(responseBody, request.tool.name, response);
      } catch (caught) {
        if (caught instanceof ClaudeProviderError) throw caught;
        if (timedOut) {
          throw new ClaudeProviderError(
            "CLAUDE_TIMEOUT",
            "Claude did not respond before the configured timeout.",
            true,
          );
        }
        throw new ClaudeProviderError(
          "CLAUDE_NETWORK_ERROR",
          "Claude could not be reached.",
          true,
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
