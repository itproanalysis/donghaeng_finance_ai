import { OpenAiCompatibleStreamingSttAdapter } from "./openai-compatible-stt-adapter";
import { UnavailableStreamingSttAdapter } from "./unavailable-stt-adapter";
import type { StreamingSttAdapter } from "./stt-adapter";
import { StreamingSttError } from "./stt-adapter";

type RuntimeEnvironment = Record<string, string | undefined>;

function integerEnvironment(
  environment: RuntimeEnvironment,
  key: string,
): number | undefined {
  const raw = environment[key]?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) {
    throw new StreamingSttError(
      "STT_CONFIGURATION_INVALID",
      `${key}는 양의 정수여야 합니다.`,
      false,
    );
  }
  return Number(raw);
}

function providerEndpoint(environment: RuntimeEnvironment): URL {
  const raw = environment.DONGHAENG_STT_ENDPOINT?.trim() ||
    "https://api.openai.com/v1/audio/transcriptions";
  try {
    return new URL(raw);
  } catch {
    throw new StreamingSttError(
      "STT_CONFIGURATION_INVALID",
      "DONGHAENG_STT_ENDPOINT가 올바른 URL이 아닙니다.",
      false,
    );
  }
}

export function createConfiguredStreamingSttAdapter(options: {
  development: boolean;
  nodeEnvironment?: string;
  environment?: RuntimeEnvironment;
  fetchImpl?: typeof fetch;
}): StreamingSttAdapter {
  const environment = options.environment ?? process.env;
  const nodeEnvironment = (
    options.nodeEnvironment ?? environment.NODE_ENV ?? ""
  ).trim().toLowerCase();
  if (options.development && nodeEnvironment === "production") {
    throw new StreamingSttError(
      "STT_RUNTIME_MODE_CONFLICT",
      "NODE_ENV=production에서는 --dev 실행 모드를 사용할 수 없습니다.",
      false,
    );
  }
  const development = options.development && nodeEnvironment !== "production";
  const configuredProvider = environment.DONGHAENG_STT_PROVIDER?.trim().toLowerCase();
  const provider = configuredProvider || (development ? "disabled" : "");

  if (!provider) {
    throw new StreamingSttError(
      "STT_CONFIGURATION_REQUIRED",
      "production에서는 DONGHAENG_STT_PROVIDER=openai-compatible 설정이 필요합니다.",
      false,
    );
  }
  if (provider === "disabled") {
    if (!development) {
      throw new StreamingSttError(
        "STT_CONFIGURATION_REQUIRED",
        "production에서는 DONGHAENG_STT_PROVIDER=openai-compatible 설정이 필요합니다.",
        false,
      );
    }
    return new UnavailableStreamingSttAdapter();
  }
  if (provider !== "openai-compatible") {
    throw new StreamingSttError(
      "STT_PROVIDER_UNSUPPORTED",
      "DONGHAENG_STT_PROVIDER는 disabled 또는 openai-compatible이어야 합니다.",
      false,
    );
  }

  const apiKey = environment.DONGHAENG_STT_API_KEY?.trim() ||
    environment.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new StreamingSttError(
      "STT_API_KEY_REQUIRED",
      "openai-compatible STT에는 DONGHAENG_STT_API_KEY 또는 OPENAI_API_KEY가 필요합니다.",
      false,
    );
  }
  const endpoint = providerEndpoint(environment);
  const productionLoopbackHttpAllowed =
    !development &&
    environment.DONGHAENG_E2E_STT_ALLOW_HTTP_LOOPBACK === "1" &&
    endpoint.protocol === "http:" &&
    new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(
      endpoint.hostname.toLowerCase(),
    );
  if (
    !development &&
    endpoint.protocol !== "https:" &&
    !productionLoopbackHttpAllowed
  ) {
    throw new StreamingSttError(
      "STT_HTTPS_REQUIRED",
      "production STT endpoint는 HTTPS여야 합니다.",
      false,
    );
  }

  return new OpenAiCompatibleStreamingSttAdapter({
    endpoint,
    apiKey,
    model: environment.DONGHAENG_STT_MODEL?.trim() || "gpt-4o-mini-transcribe",
    timeoutMs: integerEnvironment(environment, "DONGHAENG_STT_TIMEOUT_MS"),
    maxBufferBytes: integerEnvironment(environment, "DONGHAENG_STT_MAX_BUFFER_BYTES"),
    maxTotalBufferBytes: integerEnvironment(
      environment,
      "DONGHAENG_STT_MAX_TOTAL_BUFFER_BYTES",
    ),
    maxChunks: integerEnvironment(environment, "DONGHAENG_STT_MAX_CHUNKS"),
    fetchImpl: options.fetchImpl,
  });
}
