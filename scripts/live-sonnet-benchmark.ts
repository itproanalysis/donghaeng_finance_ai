import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "http://127.0.0.1:3000";
const REQUEST_TIMEOUT_MS = 15_000;
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const EXPECTED_PROVIDER = "anthropic";
const EXPECTED_MODEL = "claude-sonnet-5";

export const BENCHMARK_INTERVIEW_COUNT = 2;
export const MINIMUM_TOTAL_TURNS = 10;
export const TURNS_PER_INTERVIEW =
  MINIMUM_TOTAL_TURNS / BENCHMARK_INTERVIEW_COUNT;

interface BenchmarkScenario {
  id: string;
  industryCode: "CAFE" | "OFFLINE_RETAIL";
  borrowerName: string;
  businessName: string;
  answers: Readonly<Record<string, string>>;
}

const BENCHMARK_SCENARIOS: readonly BenchmarkScenario[] = [
  {
    id: "cafe",
    industryCode: "CAFE",
    borrowerName: "합성 차주 가",
    businessName: "합성 카페 가",
    answers: {
      monthly_average_sales:
        "최근 3개월 전체 판매 채널의 월평균 매출은 2,300만원입니다.",
      fixed_operating_costs:
        "임차료와 인건비를 포함한 월평균 고정 운영비는 1,000만원입니다.",
      improvement_plan:
        "앞으로 3개월 동안 폐기율을 현재 10%에서 5%로 낮추고 POS에서 매주 확인하겠습니다.",
      execution_readiness:
        "담당 직원과 월 80만원 예산을 확보했고 다음 주부터 시작할 예정입니다.",
      confirmed_reservations:
        "앞으로 4주 안에 확정된 단체 예약은 3건이고 총액은 120만원입니다.",
      seasonality_outlook:
        "향후 석 달은 작년 같은 기간보다 수요가 약 10% 늘 것으로 보고 있습니다.",
      essential_household_expenses:
        "주거비와 교육비를 포함한 월 필수 가계지출은 300만원입니다.",
      emergency_buffer_months:
        "현재 비상자금으로 필수 생활비를 약 4개월 감당할 수 있습니다.",
    },
  },
  {
    id: "retail",
    industryCode: "OFFLINE_RETAIL",
    borrowerName: "합성 차주 나",
    businessName: "합성 소매점 나",
    answers: {
      monthly_average_sales:
        "최근 3개월 매장과 온라인을 합친 월평균 매출은 3,400만원입니다.",
      fixed_operating_costs:
        "임차료와 인건비를 포함한 월평균 고정 운영비는 1,500만원입니다.",
      improvement_plan:
        "앞으로 8주 안에 장기 재고 비중을 18%에서 10%로 낮추고 재고표로 매주 점검하겠습니다.",
      execution_readiness:
        "재고 담당자 한 명과 판촉 예산 150만원을 정했고 이번 달부터 실행할 수 있습니다.",
      confirmed_reservations:
        "앞으로 4주 안에 확정된 납품 주문은 8건이고 총액은 560만원입니다.",
      seasonality_outlook:
        "향후 석 달은 지역 행사 일정 때문에 평소보다 수요가 조금 늘 것으로 예상합니다.",
      essential_household_expenses:
        "주거비와 교육비를 포함한 월 필수 가계지출은 420만원입니다.",
      emergency_buffer_months:
        "현재 비상자금으로 필수 생활비를 약 5개월 감당할 수 있습니다.",
    },
  },
] as const;

export interface LiveSonnetBenchmarkSample {
  provider: string;
  model: string;
  stopReason: string | null;
  latencyMs: number;
}

export interface LiveSonnetBenchmarkSummary {
  provider: Record<string, number>;
  model: Record<string, number>;
  stopReason: Record<string, number>;
  latencyMs: {
    p50: number;
    p95: number;
  };
  fallbackRate: number;
}

interface BenchmarkConfig {
  origin: string;
}

interface ApiEnvelope {
  data: unknown;
  error: unknown;
}

interface LiveSnapshot {
  session: {
    id: string;
    version: number;
  };
  nextQuestion: {
    infoCode: string;
  } | null;
}

class LiveBenchmarkError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "LiveBenchmarkError";
  }
}

function benchmarkError(code: string): never {
  throw new LiveBenchmarkError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeLoopbackOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return benchmarkError("INVALID_LOOPBACK_ORIGIN");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname)
  ) {
    return benchmarkError("INVALID_LOOPBACK_ORIGIN");
  }
  return url.origin;
}

export function parseBenchmarkArguments(
  arguments_: readonly string[],
): BenchmarkConfig {
  if (arguments_.length === 0) {
    return { origin: DEFAULT_ORIGIN };
  }
  if (
    arguments_.length === 2 &&
    arguments_[0] === "--origin" &&
    arguments_[1]
  ) {
    return { origin: normalizeLoopbackOrigin(arguments_[1]) };
  }
  return benchmarkError("INVALID_ARGUMENTS");
}

function safeDimension(value: string | null): string {
  if (value === null) return "none";
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
    ? value
    : "unknown";
}

function dimensionCounts(values: readonly (string | null)[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = safeDimension(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number {
  if (
    values.length === 0 ||
    !Number.isFinite(percentile) ||
    percentile <= 0 ||
    percentile > 1 ||
    values.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return benchmarkError("INVALID_PERCENTILE_INPUT");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index];
}

export function summarizeLiveSonnetBenchmark(
  samples: readonly LiveSonnetBenchmarkSample[],
): LiveSonnetBenchmarkSummary {
  if (samples.length === 0) return benchmarkError("NO_BENCHMARK_SAMPLES");
  const providerAttempts = samples.filter(
    (sample) => sample.stopReason !== "no_question",
  );
  const fallbackCount = providerAttempts.filter(
    (sample) =>
      sample.provider !== EXPECTED_PROVIDER || sample.model !== EXPECTED_MODEL,
  ).length;
  return {
    provider: dimensionCounts(samples.map((sample) => sample.provider)),
    model: dimensionCounts(samples.map((sample) => sample.model)),
    stopReason: dimensionCounts(samples.map((sample) => sample.stopReason)),
    latencyMs: {
      p50: Math.round(
        nearestRankPercentile(samples.map((sample) => sample.latencyMs), 0.5),
      ),
      p95: Math.round(
        nearestRankPercentile(samples.map((sample) => sample.latencyMs), 0.95),
      ),
    },
    fallbackRate:
      providerAttempts.length === 0
        ? 0
        : Number((fallbackCount / providerAttempts.length).toFixed(4)),
  };
}

export function formatLiveSonnetBenchmarkSummary(
  summary: LiveSonnetBenchmarkSummary,
): string {
  return JSON.stringify(summary);
}

function failureCode(error: unknown): string {
  return error instanceof LiveBenchmarkError
    ? error.code
    : "UNEXPECTED_FAILURE";
}

async function fetchWithTimeout(
  input: URL,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return benchmarkError("REQUEST_TIMEOUT");
    }
    return benchmarkError("REQUEST_FAILED");
  } finally {
    clearTimeout(timeout);
  }
}

async function readApiEnvelope(response: Response): Promise<ApiEnvelope> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (
    !contentType.startsWith("application/json") ||
    (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_RESPONSE_BYTES)
  ) {
    return benchmarkError("INVALID_API_RESPONSE");
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
    return benchmarkError("INVALID_API_RESPONSE");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return benchmarkError("INVALID_API_RESPONSE");
  }
  if (!isRecord(payload) || !("data" in payload) || !("error" in payload)) {
    return benchmarkError("INVALID_API_RESPONSE");
  }
  return { data: payload.data, error: payload.error };
}

async function postJson(
  origin: string,
  path: string,
  body: unknown,
  expectedStatus: number,
  cookie?: string,
): Promise<{ data: unknown; response: Response }> {
  const url = new URL(path, `${origin}/`);
  if (url.origin !== origin) return benchmarkError("NON_LOOPBACK_REQUEST_BLOCKED");
  const headers = new Headers({
    Accept: "application/json",
    "Content-Type": "application/json; charset=utf-8",
    Origin: origin,
  });
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (response.status !== expectedStatus) {
    await response.body?.cancel().catch(() => undefined);
    return benchmarkError(`UNEXPECTED_HTTP_${response.status}`);
  }
  const envelope = await readApiEnvelope(response);
  if (envelope.error !== null || envelope.data === null) {
    return benchmarkError("API_OPERATION_FAILED");
  }
  return { data: envelope.data, response };
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";", 1)[0]?.trim() ?? "";
  if (
    !/^donghaeng_session=[A-Za-z0-9_-]+$/.test(cookie) ||
    cookie.length > 512
  ) {
    return benchmarkError("INVALID_BOOTSTRAP_COOKIE");
  }
  return cookie;
}

function liveSnapshot(value: unknown): LiveSnapshot {
  if (!isRecord(value) || !isRecord(value.session)) {
    return benchmarkError("INVALID_LIVE_SNAPSHOT");
  }
  const { id, version } = value.session;
  const nextQuestion = value.nextQuestion;
  if (
    typeof id !== "string" ||
    !id ||
    !Number.isSafeInteger(version) ||
    Number(version) < 0 ||
    (nextQuestion !== null &&
      (!isRecord(nextQuestion) ||
        typeof nextQuestion.infoCode !== "string" ||
        !nextQuestion.infoCode))
  ) {
    return benchmarkError("INVALID_LIVE_SNAPSHOT");
  }
  return {
    session: { id, version: Number(version) },
    nextQuestion:
      nextQuestion === null
        ? null
        : { infoCode: String(nextQuestion.infoCode) },
  };
}

async function bootstrap(origin: string): Promise<string> {
  const result = await postJson(origin, "/api/auth/bootstrap", {}, 201);
  return sessionCookie(result.response);
}

async function createInterview(
  origin: string,
  cookie: string,
  scenario: BenchmarkScenario,
): Promise<LiveSnapshot> {
  const result = await postJson(
    origin,
    "/api/interviews",
    {
      industryCode: scenario.industryCode,
      profile: {
        borrowerName: scenario.borrowerName,
        businessName: scenario.businessName,
      },
    },
    201,
    cookie,
  );
  return liveSnapshot(result.data);
}

async function grantCloudAiConsent(
  origin: string,
  cookie: string,
  interviewId: string,
): Promise<void> {
  await postJson(
    origin,
    `/api/interviews/${encodeURIComponent(interviewId)}/consents`,
    {
      purpose: "CLOUD_AI_PROCESSING",
      consentVersion: "cloud-ai-processing-v1",
      granted: true,
      expiresAt: null,
    },
    201,
    cookie,
  );
}

function benchmarkSample(value: unknown, latencyMs: number): LiveSonnetBenchmarkSample {
  if (!isRecord(value) || value.status !== "APPLIED" || !isRecord(value.metadata)) {
    return benchmarkError("TURN_NOT_APPLIED");
  }
  const { provider, model, requestId, stopReason } = value.metadata;
  if (
    typeof provider !== "string" ||
    typeof model !== "string" ||
    (stopReason !== null && typeof stopReason !== "string")
  ) {
    return benchmarkError("INVALID_TURN_METADATA");
  }
  if (provider === EXPECTED_PROVIDER && model !== EXPECTED_MODEL) {
    return benchmarkError("SONNET_5_MODEL_MISMATCH");
  }
  if (
    provider === EXPECTED_PROVIDER &&
    (typeof requestId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(requestId))
  ) {
    return benchmarkError("LIVE_PROVIDER_EVIDENCE_MISSING");
  }
  return { provider, model, stopReason, latencyMs };
}

async function runScenario(
  origin: string,
  cookie: string,
  scenario: BenchmarkScenario,
): Promise<LiveSonnetBenchmarkSample[]> {
  let snapshot = await createInterview(origin, cookie, scenario);
  await grantCloudAiConsent(origin, cookie, snapshot.session.id);
  const samples: LiveSonnetBenchmarkSample[] = [];

  for (let turn = 0; turn < TURNS_PER_INTERVIEW; turn += 1) {
    const infoCode = snapshot.nextQuestion?.infoCode;
    if (!infoCode) return benchmarkError("INSUFFICIENT_INTERVIEW_TURNS");
    const answer = scenario.answers[infoCode];
    if (!answer) return benchmarkError("MISSING_SYNTHETIC_ANSWER");
    const startedAt = performance.now();
    const result = await postJson(
      origin,
      `/api/interviews/${encodeURIComponent(snapshot.session.id)}/messages`,
      {
        text: answer,
        clientMessageId: `live-benchmark-${scenario.id}-${turn + 1}-${randomUUID()}`,
        expectedVersion: snapshot.session.version,
        currentQuestionInfoCode: infoCode,
      },
      200,
      cookie,
    );
    const latencyMs = performance.now() - startedAt;
    if (!isRecord(result.data)) return benchmarkError("INVALID_MESSAGE_RESULT");
    samples.push(benchmarkSample(result.data.processing, latencyMs));
    snapshot = liveSnapshot(result.data.snapshot);
  }
  return samples;
}

export async function runLiveSonnetBenchmark(
  originInput: string,
): Promise<LiveSonnetBenchmarkSummary> {
  const origin = normalizeLoopbackOrigin(originInput);
  if (
    BENCHMARK_SCENARIOS.length !== BENCHMARK_INTERVIEW_COUNT ||
    !Number.isInteger(TURNS_PER_INTERVIEW)
  ) {
    return benchmarkError("INVALID_BENCHMARK_PLAN");
  }
  const cookie = await bootstrap(origin);
  const samples: LiveSonnetBenchmarkSample[] = [];
  for (const scenario of BENCHMARK_SCENARIOS) {
    samples.push(...await runScenario(origin, cookie, scenario));
  }
  if (samples.length < MINIMUM_TOTAL_TURNS) {
    return benchmarkError("INSUFFICIENT_BENCHMARK_SAMPLES");
  }
  return summarizeLiveSonnetBenchmark(samples);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : "";
if (import.meta.url === invokedPath) {
  let config: BenchmarkConfig;
  try {
    config = parseBenchmarkArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`LIVE_SONNET_BENCHMARK_FAILED:${failureCode(error)}\n`);
    process.exitCode = 1;
    config = { origin: "" };
  }
  if (config.origin) {
    runLiveSonnetBenchmark(config.origin)
      .then((summary) => {
        process.stdout.write(`${formatLiveSonnetBenchmarkSummary(summary)}\n`);
      })
      .catch((error) => {
        process.stderr.write(`LIVE_SONNET_BENCHMARK_FAILED:${failureCode(error)}\n`);
        process.exitCode = 1;
      });
  }
}
