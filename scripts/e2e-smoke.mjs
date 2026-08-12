import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { join, resolve } from "node:path";

import WebSocket from "ws";

import {
  AUDIO_PROTOCOL_VERSION,
  encodeAudioFrame,
} from "../src/realtime/audio-protocol.ts";
import { encodeClaudeTurnPlanWire } from "../src/ai/claude-interview-providers.ts";
import { createDevV1AcceptanceRequiredInformationItems } from "../src/domain/information-catalog.ts";

const projectRoot = resolve(import.meta.dirname, "..");
const tsxCli = resolve(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const tempDirectory = mkdtempSync(join(projectRoot, "data", "e2e-"));
const databasePath = join(tempDirectory, "e2e.db");
const localWorkspacePassword = "e2e-local-password";
let applicationProcess = null;
let serverLog = "";
let sttStubServer = null;
let anthropicStubServer = null;
const anthropicStubRequests = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertExactObjectKeys(value, expectedKeys, message) {
  assert(value && typeof value === "object" && !Array.isArray(value), message);
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  assert(
    actualKeys.length === sortedExpectedKeys.length &&
      actualKeys.every((key, index) => key === sortedExpectedKeys[index]),
    message,
  );
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function startSttStub() {
  const port = await freePort();
  sttStubServer = createHttpServer((request, response) => {
    const contentType = request.headers["content-type"] ?? "";
    if (
      request.method !== "POST" ||
      !contentType.startsWith("multipart/form-data; boundary=") ||
      request.headers.authorization !== "Bearer e2e-stt-key"
    ) {
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid transcription request" }));
      return;
    }
    let received = 0;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > 5 * 1024 * 1024) request.destroy();
    });
    request.on("end", () => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        text: "최근 3개월 전체 채널 기준 월평균 매출은 2,300만원입니다.",
      }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    sttStubServer.once("error", rejectListen);
    sttStubServer.listen(port, "127.0.0.1", resolveListen);
  });
  return `http://127.0.0.1:${port}/v1/audio/transcriptions`;
}

async function stopSttStub() {
  const server = sttStubServer;
  sttStubServer = null;
  if (!server) return;
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function readJsonRequest(request, maximumBytes = 512_000) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maximumBytes) {
      throw new Error("request body exceeded the E2E stub limit");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startAnthropicStub() {
  const port = await freePort();
  anthropicStubRequests.length = 0;
  anthropicStubServer = createHttpServer((request, response) => {
    void (async () => {
      assert(request.method === "POST", "Claude stub은 POST만 허용합니다.");
      assert(request.url === "/v1/messages", "Claude stub 요청 경로가 /v1/messages가 아닙니다.");
      assert(
        request.headers["content-type"]?.split(";", 1)[0] === "application/json",
        "Claude stub 요청 content-type이 application/json이 아닙니다.",
      );
      assert(request.headers["x-api-key"] === "sk-ant-e2e-placeholder-long", "Claude stub API key header가 잘못됐습니다.");
      assert(request.headers["anthropic-version"] === "2023-06-01", "Claude API version header가 잘못됐습니다.");

      const body = await readJsonRequest(request);
      assertExactObjectKeys(
        body,
        ["model", "max_tokens", "thinking", "system", "messages", "tools", "tool_choice"],
        "Claude E2E request envelope contains missing or additional fields.",
      );
      assertExactObjectKeys(
        body.thinking,
        ["type"],
        "Claude E2E thinking contract is not exact.",
      );
      assert(
        Array.isArray(body.messages) && body.messages.length === 1,
        "Claude E2E request must contain exactly one user message.",
      );
      assertExactObjectKeys(
        body.messages[0],
        ["role", "content"],
        "Claude E2E user message contract is not exact.",
      );
      assert(
        Array.isArray(body.tools) && body.tools.length === 1,
        "Claude E2E request must contain exactly one tool.",
      );
      const requestTool = body.tools[0];
      assertExactObjectKeys(
        requestTool,
        ["name", "description", "input_schema", "strict", "allowed_callers"],
        "Claude E2E tool definition contains missing or additional fields.",
      );
      assert(
        Array.isArray(requestTool.allowed_callers) &&
          requestTool.allowed_callers.length === 1 &&
          requestTool.allowed_callers[0] === "direct",
        "Claude E2E tool must be restricted to a direct caller.",
      );
      assertExactObjectKeys(
        body.tool_choice,
        ["type", "name", "disable_parallel_tool_use"],
        "Claude E2E tool choice contract is not exact.",
      );
      assert(body.model === "claude-sonnet-5", "Claude E2E model이 claude-sonnet-5가 아닙니다.");
      assert(body.max_tokens === 4096, "Claude E2E max_tokens 상한이 4096이 아닙니다.");
      assert(typeof body.system === "string" && body.system.length > 0, "Claude E2E system instruction이 없습니다.");
      assert(body.thinking?.type === "disabled", "Claude E2E extended thinking이 명시적으로 비활성화되지 않았습니다.");
      assert(Array.isArray(body.messages) && body.messages.length === 1, "Claude E2E user message가 정확히 하나가 아닙니다.");
      assert(body.messages[0]?.role === "user" && typeof body.messages[0]?.content === "string", "Claude E2E user content 계약이 잘못됐습니다.");
      assert(Array.isArray(body.tools) && body.tools.length === 1, "Claude E2E strict tool이 정확히 하나가 아닙니다.");
      const tool = body.tools[0];
      assert(tool?.name === "commit_interview_turn" && tool?.strict === true, "Claude E2E strict interview tool이 강제되지 않았습니다.");
      assert(
        body.tool_choice?.type === "tool" &&
          body.tool_choice?.name === tool.name &&
          body.tool_choice?.disable_parallel_tool_use === true,
        "Claude E2E single-tool choice가 강제되지 않았습니다.",
      );

      const userPayload = JSON.parse(body.messages[0].content);
      assert(
        userPayload &&
          typeof userPayload === "object" &&
          userPayload.contractVersion === "dev-v1" &&
          userPayload.deterministicDraft &&
          typeof userPayload.deterministicDraft === "object",
        "Claude E2E user payload에 deterministicDraft가 없습니다.",
      );
      anthropicStubRequests.push({
        model: body.model,
        toolName: tool.name,
        sourceTranscript: userPayload.sourceTranscript,
      });
      const callNumber = anthropicStubRequests.length;
      const responseBody = JSON.stringify({
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        stop_reason: "tool_use",
        usage: { input_tokens: 200 + callNumber, output_tokens: 80 + callNumber },
        content: [
          {
            type: "tool_use",
            id: `toolu_e2e_${callNumber}`,
            name: tool.name,
            input: encodeClaudeTurnPlanWire(userPayload.deterministicDraft),
            caller: { type: "direct" },
          },
        ],
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(responseBody),
        "request-id": `req_e2e_${callNumber}`,
      });
      response.end(responseBody);
    })().catch((error) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "invalid Claude request" }));
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    anthropicStubServer.once("error", rejectListen);
    anthropicStubServer.listen(port, "127.0.0.1", resolveListen);
  });
  return `http://127.0.0.1:${port}/v1/messages`;
}

async function stopAnthropicStub() {
  const server = anthropicStubServer;
  anthropicStubServer = null;
  if (!server) return;
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function grantCloudAiConsent(origin, interviewId, cookie) {
  return expectSuccess(
    await apiRequest(
      origin,
      `/api/interviews/${encodeURIComponent(interviewId)}/consents`,
      {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: {
          purpose: "CLOUD_AI_PROCESSING",
          consentVersion: "cloud-ai-processing-v1",
          granted: true,
          expiresAt: null,
        },
      },
    ),
    201,
  );
}

async function runProcess(arguments_, environment) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: projectRoot,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(output);
      else reject(new Error(`하위 프로세스 실패 (${code})\n${output}`));
    });
  });
}

async function initializeLocalWorkspace(environment) {
  const initializer = [
    "import { getDatabase } from './src/server/database.ts';",
    "import { AuthService } from './src/server/auth.ts';",
    "const database = getDatabase();",
    "new AuthService(database).bootstrapLocalWorkspace();",
    "database.close();",
  ].join(" ");
  await runProcess([tsxCli, "-e", initializer], {
    ...environment,
    NODE_ENV: "development",
  });
}

async function startProductionServer(environment, origin) {
  applicationProcess = spawn(process.execPath, [tsxCli, "server.ts"], {
    cwd: projectRoot,
    env: { ...process.env, ...environment, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  applicationProcess.stdout.on("data", (chunk) => {
    serverLog = `${serverLog}${chunk.toString()}`.slice(-20_000);
  });
  applicationProcess.stderr.on("data", (chunk) => {
    serverLog = `${serverLog}${chunk.toString()}`.slice(-20_000);
  });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (applicationProcess.exitCode !== null) {
      throw new Error(`프로덕션 서버가 조기 종료됐습니다.\n${serverLog}`);
    }
    try {
      const response = await fetch(`${origin}/login`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // The server is still starting.
    }
    await delay(250);
  }
  throw new Error(`프로덕션 서버 준비 시간 초과\n${serverLog}`);
}

async function stopProductionServer() {
  const child = applicationProcess;
  applicationProcess = null;
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

function cookieFrom(response) {
  const setCookie = response.headers.get("set-cookie");
  assert(setCookie, "인증 응답에 Set-Cookie가 없습니다.");
  return setCookie.split(";", 1)[0];
}

async function jsonResponse(response) {
  const payload = await response.json().catch(() => null);
  assert(payload && typeof payload === "object", `JSON 응답이 아닙니다 (${response.status}).`);
  return payload;
}

async function apiRequest(origin, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.mutationOrigin) headers.set("origin", options.mutationOrigin);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`${origin}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  return { response, payload: await jsonResponse(response) };
}

function expectSuccess(result, status) {
  assert(result.response.status === status, `예상 HTTP ${status}, 실제 ${result.response.status}: ${JSON.stringify(result.payload)}`);
  assert(result.payload.error === null, `API 오류: ${JSON.stringify(result.payload.error)}`);
  return result.payload.data;
}

function expectError(result, status, code) {
  assert(result.response.status === status, `예상 HTTP ${status}, 실제 ${result.response.status}: ${JSON.stringify(result.payload)}`);
  assert(result.payload.error?.code === code, `예상 오류 ${code}, 실제 ${JSON.stringify(result.payload.error)}`);
}

async function rejectedWebSocketStatus(url, headers) {
  return new Promise((resolveStatus, reject) => {
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("거부 WebSocket handshake 시간 초과"));
    }, 5_000);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      resolveStatus(response.statusCode);
    });
    socket.once("open", () => {
      clearTimeout(timer);
      socket.close();
      reject(new Error("거부되어야 할 WebSocket이 연결됐습니다."));
    });
    socket.once("error", () => {
      // unexpected-response carries the status used by the assertion.
    });
  });
}

async function openAudioSocket(url, headers) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url, { headers });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error("audio WebSocket 연결 시간 초과"));
    }, 5_000);
    socket.once("open", () => {
      clearTimeout(timer);
      resolveSocket(socket);
    });
    socket.once("error", reject);
  });
}

function createMessageCollector(socket) {
  const messages = [];
  const waiters = new Set();
  socket.on("message", (raw, isBinary) => {
    if (isBinary) return;
    const message = JSON.parse(raw.toString());
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      waiters.delete(waiter);
      waiter.resolve(message);
    }
  });
  return {
    waitFor(predicate, timeoutMs = 8_000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveMessage, reject) => {
        const waiter = {
          predicate,
          resolve: resolveMessage,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`WebSocket 메시지 시간 초과: ${JSON.stringify(messages)}`));
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

async function collectSse(origin, interviewId, cookie, after, targetSeq) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const response = await fetch(
    `${origin}/api/interviews/${encodeURIComponent(interviewId)}/events?after=${after}`,
    { headers: { cookie }, signal: controller.signal },
  );
  assert(response.status === 200, `SSE 연결 실패: ${response.status}`);
  assert(response.headers.get("content-type")?.startsWith("text/event-stream"), "SSE Content-Type이 아닙니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
        if (dataLine) {
          const event = JSON.parse(dataLine.slice(6));
          events.push(event);
          if (event.seq >= targetSeq) {
            await reader.cancel();
            return events;
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  throw new Error(`SSE가 목표 sequence ${targetSeq}까지 도달하지 못했습니다.`);
}

const ANSWERS = {
  monthly_average_sales:
    "최근 3개월 카드 매출 기준 월평균 2,300만원이 맞습니다",
  fixed_operating_costs: "고정비는 월 1,000만원입니다",
  improvement_plan:
    "문제는 폐기 비용입니다. 개선 계획은 앞으로 3개월 안에 폐기를 줄이고 POS로 현재 10%에서 목표 5%를 확인하겠습니다.",
  execution_readiness: "실행 준비는 인력과 예산을 확보했고 일정도 준비 완료했습니다",
  confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
  seasonality_outlook: "계절성 전망은 작년보다 수요가 10% 증가할 것으로 봅니다",
  essential_household_expenses: "필수 가계지출은 월 300만원입니다",
  emergency_buffer_months: "비상자금은 4개월입니다",
};

const ACCEPTANCE_ANSWERS = {
  ...ANSWERS,
  platform_fee_pressure:
    "배달은 계속 나오는데 수수료가 많이 나가고 홀 손님이 줄었어요. 그래도 단골 매출은 절반 정도 됩니다.",
  hall_customer_decline: "최근 홀 손님이 줄었습니다.",
  repeat_customer_share: "최근 한 달 기준 단골 매출은 45% 정도입니다.",
  improvement_plan:
    "단골들은 전화주문을 받고 싶어요. 지금 직접주문이 18%인데 두 달 안에 30%까지 늘리고 싶습니다.",
};

async function main() {
  assert(existsSync(resolve(projectRoot, ".next", "BUILD_ID")), "먼저 npm run build를 실행해야 합니다.");
  const port = await freePort();
  const sttEndpoint = await startSttStub();
  const anthropicEndpoint = await startAnthropicStub();
  const origin = `http://127.0.0.1:${port}`;
  const wsOrigin = `ws://127.0.0.1:${port}`;
  const environment = {
    DONGHAENG_HOST: "127.0.0.1",
    DONGHAENG_PORT: String(port),
    DONGHAENG_APP_ORIGIN: origin,
    DONGHAENG_E2E_AUTH_ALLOW_LOCAL: "1",
    DONGHAENG_DB_PATH: databasePath,
    DONGHAENG_LOCAL_BOOTSTRAP: "1",
    DONGHAENG_LOCAL_PASSWORD: localWorkspacePassword,
    DONGHAENG_STT_PROVIDER: "openai-compatible",
    DONGHAENG_STT_ENDPOINT: sttEndpoint,
    DONGHAENG_STT_API_KEY: "e2e-stt-key",
    DONGHAENG_E2E_STT_ALLOW_HTTP_LOOPBACK: "1",
    DONGHAENG_ORCHESTRATOR_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "sk-ant-e2e-placeholder-long",
    DONGHAENG_ANTHROPIC_MODEL: "claude-sonnet-5",
    DONGHAENG_ANTHROPIC_TIMEOUT_MS: "20000",
    DONGHAENG_ANTHROPIC_MAX_TOKENS: "4096",
    DONGHAENG_ANTHROPIC_ENDPOINT: anthropicEndpoint,
    DONGHAENG_E2E_ANTHROPIC_ALLOW_HTTP_LOOPBACK: "1",
  };

  await initializeLocalWorkspace(environment);
  await startProductionServer(environment, origin);

  const unauthenticatedCreate = await apiRequest(origin, "/api/interviews", {
    method: "POST",
    mutationOrigin: origin,
  });
  expectError(unauthenticatedCreate, 401, "AUTHENTICATION_REQUIRED");

  const login = await apiRequest(origin, "/api/auth/session", {
    method: "POST",
    mutationOrigin: origin,
    body: { email: "local@donghaeng.workspace", password: localWorkspacePassword },
  });
  expectSuccess(login, 201);
  const cookie = cookieFrom(login.response);

  const crossSiteCreate = await apiRequest(origin, "/api/interviews", {
    method: "POST",
    cookie,
    mutationOrigin: "https://attacker.invalid",
  });
  expectError(crossSiteCreate, 403, "CSRF_REJECTED");

  const created = expectSuccess(
    await apiRequest(origin, "/api/interviews", {
      method: "POST",
      cookie,
      mutationOrigin: origin,
    }),
    201,
  );
  const interviewId = created.session.id;
  assert(created.snapshotType === "PREVIEW", "생성 snapshot은 PREVIEW여야 합니다.");
  assert(created.informationItems.length === 8, "dev-v1 필수정보 8개가 생성되지 않았습니다.");
  assert(created.nextQuestion?.infoCode === "monthly_average_sales", "첫 질문이 월평균 매출이 아닙니다.");

  const consentRequired = await apiRequest(
    origin,
    `/api/interviews/${encodeURIComponent(interviewId)}/consents?require=MICROPHONE_INTERVIEW`,
    { cookie },
  );
  expectError(consentRequired, 403, "MICROPHONE_CONSENT_REQUIRED");

  const audioUrl = `${wsOrigin}/ws/interviews/${encodeURIComponent(interviewId)}/audio`;
  assert(await rejectedWebSocketStatus(audioUrl, { Origin: origin }) === 401, "cookie 없는 WS가 401이 아닙니다.");
  assert(await rejectedWebSocketStatus(audioUrl, { Cookie: cookie }) === 403, "Origin 없는 운영 WS가 403이 아닙니다.");
  assert(await rejectedWebSocketStatus(audioUrl, { Cookie: cookie, Origin: "https://attacker.invalid" }) === 403, "교차 출처 WS가 403이 아닙니다.");
  assert(await rejectedWebSocketStatus(audioUrl, { Cookie: cookie, Origin: origin }) === 403, "동의 없는 WS가 403이 아닙니다.");

  expectSuccess(
    await apiRequest(
      origin,
      `/api/interviews/${encodeURIComponent(interviewId)}/consents`,
      {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: {
          purpose: "MICROPHONE_INTERVIEW",
          consentVersion: "microphone-interview-v1",
          granted: true,
          expiresAt: null,
        },
      },
    ),
    201,
  );
  await grantCloudAiConsent(origin, interviewId, cookie);
  const consentState = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/consents`, { cookie }),
    200,
  );
  assert(consentState.microphoneEnabled === true, "마이크 동의가 유효하지 않습니다.");
  assert(consentState.cloudAiProcessingEnabled === true, "Claude 외부 처리 동의가 유효하지 않습니다.");
  assert(consentState.rawAudioStorageEnabled === false, "원음 저장 동의가 기본 활성화됐습니다.");

  const socket = await openAudioSocket(audioUrl, { Cookie: cookie, Origin: origin });
  const collector = createMessageCollector(socket);
  const audioSessionId = crypto.randomUUID();
  const startCorrelationId = crypto.randomUUID();
  socket.send(JSON.stringify({
    protocolVersion: AUDIO_PROTOCOL_VERSION,
    type: "audio.start",
    correlationId: startCorrelationId,
    audioSessionId,
    interviewId,
    mimeType: "audio/webm;codecs=opus",
    lastAckedAudioSeq: 0,
  }));
  await collector.waitFor((message) => message.type === "audio.ack" && message.correlationId === startCorrelationId);
  for (let audioSeq = 1; audioSeq <= 2; audioSeq += 1) {
    socket.send(encodeAudioFrame({
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "audio.chunk",
      audioSessionId,
      audioSeq,
      clientMonotonicMs: audioSeq * 400,
      mimeType: "audio/webm;codecs=opus",
    }, new Uint8Array([audioSeq, audioSeq + 1])));
  }
  await collector.waitFor((message) => message.type === "audio.ack" && message.lastAudioSeq === 2);

  const socketClosed = new Promise((resolveClose) => socket.once("close", resolveClose));
  socket.close(1000, "e2e network handoff");
  await socketClosed;

  const resumedSocket = await openAudioSocket(audioUrl, { Cookie: cookie, Origin: origin });
  const resumedCollector = createMessageCollector(resumedSocket);
  const reconnectCorrelationId = crypto.randomUUID();
  resumedSocket.send(JSON.stringify({
    protocolVersion: AUDIO_PROTOCOL_VERSION,
    type: "audio.start",
    correlationId: reconnectCorrelationId,
    audioSessionId,
    interviewId,
    mimeType: "audio/webm;codecs=opus",
    lastAckedAudioSeq: 2,
  }));
  const reconnectAck = await resumedCollector.waitFor(
    (message) => message.type === "audio.ack" && message.correlationId === reconnectCorrelationId,
  );
  assert(reconnectAck.lastAudioSeq === 2, "재연결한 음성 세션이 ACK cursor를 이어받지 못했습니다.");

  const resumeCorrelationId = crypto.randomUUID();
  resumedSocket.send(JSON.stringify({
    protocolVersion: AUDIO_PROTOCOL_VERSION,
    type: "audio.resume",
    correlationId: resumeCorrelationId,
    audioSessionId,
    interviewId,
    lastAckedAudioSeq: 2,
  }));
  await resumedCollector.waitFor(
    (message) => message.type === "audio.ack" && message.correlationId === resumeCorrelationId,
  );
  resumedSocket.send(encodeAudioFrame({
    protocolVersion: AUDIO_PROTOCOL_VERSION,
    type: "audio.chunk",
    audioSessionId,
    audioSeq: 3,
    clientMonotonicMs: 1_200,
    mimeType: "audio/webm;codecs=opus",
  }, new Uint8Array([3, 4])));
  await resumedCollector.waitFor(
    (message) => message.type === "audio.ack" && message.lastAudioSeq === 3,
  );

  const endCorrelationId = crypto.randomUUID();
  resumedSocket.send(JSON.stringify({
    protocolVersion: AUDIO_PROTOCOL_VERSION,
    type: "audio.end_turn",
    correlationId: endCorrelationId,
    audioSessionId,
    interviewId,
    lastAckedAudioSeq: 3,
  }));
  const finalStt = await resumedCollector.waitFor((message) => message.type === "stt.final");
  assert(finalStt.provider.includes("OpenAI-compatible STT"), "실제 multipart STT adapter 경계가 표시되지 않았습니다.");
  await resumedCollector.waitFor(
    (message) => message.type === "audio.ack" && message.correlationId === endCorrelationId,
  );
  resumedSocket.close();

  let live = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}`, { cookie }),
    200,
  );
  const audioSegment = [...live.transcript].reverse().find((segment) => segment.speaker === "BORROWER");
  assert(audioSegment?.confirmation === "FINAL", "partial transcript가 저장됐거나 FINAL이 없습니다.");
  assert(audioSegment.rawText === finalStt.text, "raw STT 원문이 보존되지 않았습니다.");
  assert(audioSegment.sttProvider?.includes("OpenAI-compatible STT"), "STT 제공자 메타데이터가 보존되지 않았습니다.");
  assert(Number.isFinite(audioSegment.startMs) && Number.isFinite(audioSegment.endMs), "음성 timing 메타데이터가 없습니다.");

  const correctedText =
    "차주가 확인한 최근 3개월 카드 매출 기준 월평균 매출은 2,300만원입니다.";
  const correction = expectSuccess(
    await apiRequest(
      origin,
      `/api/interviews/${encodeURIComponent(interviewId)}/transcript-segments/${encodeURIComponent(audioSegment.id)}/corrections`,
      {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: {
          clientCorrectionId: "e2e-correction-1",
          expectedVersion: live.session.version,
          correctedText,
          reason: "E2E에서 raw와 corrected revision 보존 검증",
        },
      },
    ),
    200,
  );
  assert(correction.segment.rawText === audioSegment.rawText, "correction이 raw 원문을 덮어썼습니다.");
  assert(
    correction.segment.correctedText === correctedText &&
      correction.segment.revision === audioSegment.revision + 1,
    `corrected revision이 저장되지 않았습니다: ${JSON.stringify(correction.segment)}`,
  );

  live = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}`, { cookie }),
    200,
  );
  const sseEvents = await collectSse(
    origin,
    interviewId,
    cookie,
    created.session.lastEventSeq,
    live.session.lastEventSeq,
  );
  const eventTypes = new Set(sseEvents.map((event) => event.type));
  assert(eventTypes.has("feature.preview_updated"), "SSE feature PREVIEW event가 없습니다.");
  assert(eventTypes.has("summary.preview_updated"), "SSE summary PREVIEW event가 없습니다.");
  assert(eventTypes.has("transcript.corrected"), "SSE transcript correction event가 없습니다.");

  const sequenceMismatch = await apiRequest(
    origin,
    `/api/interviews/${encodeURIComponent(interviewId)}/events?after=0`,
    { cookie, headers: { "Last-Event-ID": "1" } },
  );
  expectError(sequenceMismatch, 400, "EVENT_SEQUENCE_MISMATCH");

  let firstTextCommand = null;
  let firstTextResult = null;
  for (let turn = 0; turn < 12 && live.nextQuestion; turn += 1) {
    const infoCode = live.nextQuestion.infoCode;
    const answer = ANSWERS[infoCode];
    assert(answer, `E2E 답변 fixture가 없습니다: ${infoCode}`);
    const command = {
      text: answer,
      clientMessageId: `e2e-message-${turn + 2}`,
      expectedVersion: live.session.version,
      currentQuestionInfoCode: infoCode,
    };
    const claudeCallsBeforeMessage = anthropicStubRequests.length;
    const result = expectSuccess(
      await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: command,
      }),
      200,
    );
    assert(
      result.processing?.status === "APPLIED",
      `Claude 턴 처리가 APPLIED가 아닙니다: ${JSON.stringify(result.processing)}`,
    );
    assert(result.processing?.metadata?.provider === "anthropic", "Claude provider 메타데이터가 응답에 없습니다.");
    assert(result.processing?.metadata?.model === "claude-sonnet-5", "Claude model 메타데이터가 응답에 없습니다.");
    assert(
      anthropicStubRequests.length === claudeCallsBeforeMessage + 1,
      "텍스트 메시지가 Claude /v1/messages stub을 정확히 한 번 호출하지 않았습니다.",
    );
    if (!firstTextCommand) {
      firstTextCommand = command;
      firstTextResult = result;
      const replayed = expectSuccess(
        await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
          method: "POST",
          cookie,
          mutationOrigin: origin,
          body: command,
        }),
        200,
      );
      assert(replayed.snapshot.session.version === firstTextResult.snapshot.session.version, "멱등 message replay가 새 version을 만들었습니다.");
      assert(anthropicStubRequests.length === claudeCallsBeforeMessage + 1, "멱등 message replay가 Claude를 다시 호출했습니다.");
      const claudeCallsBeforeStaleMessage = anthropicStubRequests.length;
      const stale = await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: { ...command, clientMessageId: "e2e-stale-message" },
      });
      expectError(stale, 409, "VERSION_CONFLICT");
      assert(anthropicStubRequests.length === claudeCallsBeforeStaleMessage, "stale message가 Claude를 호출했습니다.");
    }
    live = result.snapshot;
  }

  assert(live.nextQuestion === null, "8개 필수 질문 여정이 종료되지 않았습니다.");
  assert(live.canonicalInformationItems.every((item) => item.status === "CONFIRMED"), "모든 canonical 정보가 CONFIRMED가 아닙니다.");
  assert(live.features.features.some((feature) => feature.name === "fixed_cost_ratio" && feature.state === "COMPUTED"), "결정론적 fixed_cost_ratio가 계산되지 않았습니다.");
  assert(live.goalSnapshot.status === "CONFIRMED", "직접 진술 목표가 확정되지 않았습니다.");

  const completed = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/complete`, {
      method: "POST",
      cookie,
      mutationOrigin: origin,
      body: {
        clientCommandId: "e2e-complete-1",
        expectedVersion: live.session.version,
        mode: "COMPLETE",
        borrowerConfirmed: true,
        reason: null,
      },
    }),
    200,
  );
  assert(completed.snapshot.snapshotType === "FINAL", "완료 결과가 FINAL이 아닙니다.");
  assert(completed.snapshot.completionStatus === "COMPLETE", "strict 완료가 COMPLETE가 아닙니다.");
  assert(completed.snapshot.contentHash.startsWith("sha256:"), "FINAL content hash가 없습니다.");
  assert(completed.evaluation?.status === "READY", "COMPLETE 평가가 READY가 아닙니다.");
  assert(completed.evaluation.approvalDecision === null && completed.evaluation.creditGrade === null, "승인 판단 또는 신용등급이 생성됐습니다.");
  assert(completed.evaluation.gradeScope === "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1", "보조 데이터 품질 등급 scope가 분리되지 않았습니다.");

  const reloadedFinal = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}`, { cookie }),
    200,
  );
  assert(reloadedFinal.snapshotType === "FINAL", "새로고침 GET이 FINAL을 반환하지 않았습니다.");
  assert(reloadedFinal.evaluationId === completed.evaluation.id, "FINAL 새로고침에서 evaluationId가 사라졌습니다.");
  const evaluation = expectSuccess(
    await apiRequest(origin, `/api/interview-evaluations/${encodeURIComponent(completed.evaluation.id)}`, { cookie }),
    200,
  );
  assert(evaluation.finalSnapshotId === completed.snapshot.id, "평가가 동일 FINAL snapshot을 참조하지 않습니다.");

  const acceptanceCreated = expectSuccess(
    await apiRequest(origin, "/api/interviews", {
      method: "POST",
      cookie,
      mutationOrigin: origin,
      body: {
        industryCode: "CAFE",
        requiredInformationList: createDevV1AcceptanceRequiredInformationItems(),
      },
    }),
    201,
  );
  assert(acceptanceCreated.informationItems.length === 11, "브라우저용 11-item catalog가 생성되지 않았습니다.");
  assert(acceptanceCreated.nextQuestion?.infoCode === "monthly_average_sales", "수용 시나리오 첫 질문이 중립적인 월평균 매출 질문이 아닙니다.");
  await grantCloudAiConsent(origin, acceptanceCreated.session.id, cookie);
  let acceptanceLive = acceptanceCreated;
  for (let turn = 0; turn < 14 && acceptanceLive.nextQuestion; turn += 1) {
    const infoCode = acceptanceLive.nextQuestion.infoCode;
    const answer = ACCEPTANCE_ANSWERS[infoCode];
    assert(answer, `11-item E2E 답변 fixture가 없습니다: ${infoCode}`);
    const result = expectSuccess(
      await apiRequest(
        origin,
        `/api/interviews/${encodeURIComponent(acceptanceCreated.session.id)}/messages`,
        {
          method: "POST",
          cookie,
          mutationOrigin: origin,
          body: {
            text: answer,
            clientMessageId: `e2e-acceptance-${turn + 1}`,
            expectedVersion: acceptanceLive.session.version,
            currentQuestionInfoCode: infoCode,
          },
        },
      ),
      200,
    );
    acceptanceLive = result.snapshot;
    if (infoCode === "platform_fee_pressure") {
      const byCode = new Map(acceptanceLive.informationItems.map((item) => [item.infoCode, item]));
      assert(byCode.get("platform_fee_pressure")?.status === "CONFIRMED", "플랫폼 비용부담이 즉시 확정되지 않았습니다.");
      assert(byCode.get("hall_customer_decline")?.status === "CONFIRMED", "홀손님 감소가 같은 발화에서 확정되지 않았습니다.");
      const repeatStatus = byCode.get("repeat_customer_share")?.status;
      if (repeatStatus === "NEEDS_FOLLOWUP") {
        assert(acceptanceLive.nextQuestion?.infoCode === "repeat_customer_share", "정확한 반복고객 비중 후속질문이 생성되지 않았습니다.");
      } else {
        assert(repeatStatus === "CONFIRMED", "반복고객 비중이 평가 가능한 상태로 보존되지 않았습니다.");
      }
    }
    if (infoCode === "repeat_customer_share") {
      const repeat = acceptanceLive.canonicalInformationItems.find((item) => item.infoCode === infoCode);
      assert(repeat?.status === "CONFIRMED" && repeat.revisions.length === 2, "45% 후속확인 revision이 보존되지 않았습니다.");
      const improvement = acceptanceLive.informationItems.find((item) => item.infoCode === "improvement_plan");
      if (improvement?.status !== "CONFIRMED") {
        assert(acceptanceLive.nextQuestion?.infoCode === "improvement_plan", "비중 확인 후 미수집 개선계획 질문으로 이어지지 않았습니다.");
      }
    }
    if (infoCode === "improvement_plan") {
      assert(acceptanceLive.goalSnapshot.status === "CONFIRMED", "18%→30% 목표가 확정되지 않았습니다.");
      assert(acceptanceLive.goalSnapshot.period?.value === 8 && acceptanceLive.goalSnapshot.period?.unit === "WEEK", "두 달 목표기간이 8주로 보존되지 않았습니다.");
      assert(acceptanceLive.goalSnapshot.measurementSources.includes("PHONE_ORDER_LOG"), "전화주문 측정원이 보존되지 않았습니다.");
    }
  }
  assert(acceptanceLive.nextQuestion === null, "11-item 수용 시나리오가 종료되지 않았습니다.");
  assert(acceptanceLive.canonicalInformationItems.length === 11, "FINAL 직전 canonical 11개가 유지되지 않았습니다.");

  const acceptanceCompleted = expectSuccess(
    await apiRequest(
      origin,
      `/api/interviews/${encodeURIComponent(acceptanceCreated.session.id)}/complete`,
      {
        method: "POST",
        cookie,
        mutationOrigin: origin,
        body: {
          clientCommandId: "e2e-acceptance-complete",
          expectedVersion: acceptanceLive.session.version,
          mode: "COMPLETE",
          borrowerConfirmed: true,
          reason: null,
        },
      },
    ),
    200,
  );
  assert(acceptanceCompleted.snapshot.completionStatus === "COMPLETE", "11-item strict COMPLETE가 실패했습니다.");
  assert(acceptanceCompleted.evaluation?.status === "READY", "11-item 평가가 READY가 아닙니다.");
  const acceptanceEvents = await collectSse(
    origin,
    acceptanceCreated.session.id,
    cookie,
    acceptanceCreated.session.lastEventSeq,
    acceptanceCompleted.snapshot.session.lastEventSeq,
  );
  const readyIndex = acceptanceEvents.findIndex((event) => event.type === "evaluation.ready");
  const completedIndex = acceptanceEvents.findIndex((event) => event.type === "interview.completed");
  assert(readyIndex >= 0 && completedIndex > readyIndex, "evaluation.ready → interview.completed 순서가 보장되지 않았습니다.");
  const evaluationList = expectSuccess(
    await apiRequest(origin, "/api/interview-evaluations", { cookie }),
    200,
  );
  assert(
    evaluationList.items.some((item) => item.id === acceptanceCompleted.evaluation.id),
    "완료 평가가 tenant 평가 목록에 나타나지 않았습니다.",
  );

  const postFinalMutation = await apiRequest(origin, `/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
    method: "POST",
    cookie,
    mutationOrigin: origin,
    body: {
      text: "종료 후 변경 시도",
      clientMessageId: "e2e-after-final",
      expectedVersion: reloadedFinal.session.version,
      currentQuestionInfoCode: null,
    },
  });
  expectError(postFinalMutation, 409, "INTERVIEW_FINALIZED");

  const forcedCreated = expectSuccess(
    await apiRequest(origin, "/api/interviews", {
      method: "POST",
      cookie,
      mutationOrigin: origin,
    }),
    201,
  );
  const forced = expectSuccess(
    await apiRequest(origin, `/api/interviews/${encodeURIComponent(forcedCreated.session.id)}/complete`, {
      method: "POST",
      cookie,
      mutationOrigin: origin,
      body: {
        clientCommandId: "e2e-force-1",
        expectedVersion: forcedCreated.session.version,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: false,
        reason: "차주 요청으로 E2E 조기 중단",
      },
    }),
    200,
  );
  assert(forced.snapshot.completionStatus === "INCOMPLETE", "강제 중단이 INCOMPLETE가 아닙니다.");
  assert(forced.evaluation === null && forced.evaluationEligibility.eligible === false, "INCOMPLETE에 READY 평가가 생성됐습니다.");
  assert(forced.snapshot.evaluationId === null, "INCOMPLETE FINAL에 evaluationId가 있습니다.");

  process.stdout.write(
    `E2E PASS: auth/tenant/CSRF, versioned cloud-AI consent, local Claude strict-tool adapter/metadata (${anthropicStubRequests.length} calls), audio WS reconnect/STT metadata, correction, SSE replay, 8-item core + 11-item acceptance FINAL/evaluation/list, forced incomplete (${origin})\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n${serverLog}\n`);
  process.exitCode = 1;
} finally {
  await stopProductionServer();
  await stopAnthropicStub();
  await stopSttStub();
  rmSync(tempDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 150,
  });
}
