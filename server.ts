import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

import next from "next";
import { WebSocket, WebSocketServer, type RawData } from "ws";

import { assertConfiguredInterviewProvider } from "./src/ai/configured-interview-provider";
import {
  AUDIO_CONTROL_TYPES,
  AUDIO_PROTOCOL_VERSION,
  decodeAudioFrame,
  type AudioControlMessage,
  type AudioServerMessage,
} from "./src/realtime/audio-protocol";
import { createConfiguredStreamingSttAdapter } from "./src/realtime/server/configured-stt-adapter";
import { fetchBoundedJson } from "./src/realtime/server/bounded-json-fetch";
import {
  audioPrincipalOwnershipKey,
  assertAudioSessionStartAllowed,
  assertSafeAudioControlIdentifier,
  encodedAudioInterviewIdFromPath,
  MAX_AUDIO_CONNECTIONS_PER_CLIENT,
  MAX_RESUMABLE_AUDIO_SESSIONS,
} from "./src/realtime/server/audio-session-policy";
import {
  assertAudioFinalizationActive,
  cancelAudioOperationImmediately,
  endTurnWithFailureCleanup,
  shouldCancelAudioOperationOnSocketClose,
} from "./src/realtime/server/audio-session-lifecycle";
import {
  StreamingSttError,
  type StreamingSttSession,
} from "./src/realtime/server/stt-adapter";
import {
  readPersistedTranscriptProcessing,
  type PersistedTranscriptProcessingResult,
} from "./src/realtime/server/final-transcript-processing";
import { ConsentService } from "./src/server/consent-service";
import { getDatabase } from "./src/server/database";
import { ApplicationError } from "./src/server/errors";
import {
  AUDIO_TURN_LEASE_RENEW_INTERVAL_MS,
  AudioTurnLeaseConflictError,
  InterviewActivityRegistry,
  type AudioTurnLeaseIdentity,
} from "./src/server/interview-activity-registry";
import { AuthService } from "./src/server/auth";
import { applyCustomServerRuntimeMode } from "./src/server/runtime-mode";
import { assertCustomServerAuthenticationConfigured } from "./src/server/production-auth-policy";
import { initializeIapVerifier, isGoogleIapMode, verifyIapRequest } from "./src/server/iap-auth";
import { iapAudioRenewalDelay } from "./src/realtime/server/iap-audio-renewal";
import { isPublicReviewMode, reserveReviewUsage } from "./src/server/public-review";
import { PublicReviewRealtime } from "./src/server/public-review-realtime";

const development = process.argv.includes("--dev");
applyCustomServerRuntimeMode(development);
const hostname = process.env.DONGHAENG_HOST || "127.0.0.1";
const portValue = Number(process.env.DONGHAENG_PORT || 3000);
const port = Number.isSafeInteger(portValue) && portValue > 0 ? portValue : 3000;
// Authentication is a configuration-only startup boundary. Until an external
// IdP exists, production may run local auth only inside the exact loopback E2E
// gate; this executes before Next preparation, database/service creation, and
// port binding.
assertCustomServerAuthenticationConfigured({
  development,
  hostname,
  port,
});
const application = next({ dev: development, hostname, port });
const handle = application.getRequestHandler();
const sttAdapter = createConfiguredStreamingSttAdapter({
  development,
  nodeEnvironment: process.env.NODE_ENV,
});
const connectionsByClient = new Map<string, number>();
const connectionKeys = new WeakMap<WebSocket, string>();
const connectionPrincipalKeys = new WeakMap<WebSocket, string>();
const resumableAudioSessions = new Map<string, ConnectionState>();
const pendingAudioSessionIds = new Map<string, string>();
const MAX_TOTAL_AUDIO_CONNECTIONS = 200;
const INTERNAL_API_TIMEOUT_MS = 10_000;
// A final voice turn first waits for STT, then the saved transcript can await
// the Claude planner. Ten seconds made that second, legitimate phase look like
// a failed "internal transcription save" even though the speech was valid.
const INTERNAL_FINAL_TRANSCRIPT_TIMEOUT_MS = 45_000;
let customServerAuthService: AuthService | undefined;
let durableInterviewActivityRegistry: InterviewActivityRegistry | undefined;

function getCustomServerAuthService(): AuthService {
  customServerAuthService ??= new AuthService(getDatabase());
  return customServerAuthService;
}

function getInterviewActivityRegistry(): InterviewActivityRegistry {
  durableInterviewActivityRegistry ??= new InterviewActivityRegistry(getDatabase());
  return durableInterviewActivityRegistry;
}

interface ConnectionState {
  interviewId: string;
  tenantId: string | null;
  cookie: string;
  iapAssertion: string;
  principalKey: string;
  activeSocket: WebSocket;
  audioSessionId: string | null;
  audioLeaseOwnerToken: string | null;
  audioLeaseRenewedAtEpochMs: number | null;
  lastAudioSeq: number;
  session: StreamingSttSession | null;
  sttProviderLabel: string | null;
  questionInfoCode: string | null;
  expectedVersion: number | null;
  finalized: boolean;
  finalTranscript: string | null;
  processingStatus: PersistedTranscriptResult["processingStatus"] | null;
  processingCode: string | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  startedAtEpochMs: number | null;
  speechStoppedAtEpochMs: number | null;
  operationController: AbortController | null;
  receivedAudioFrame: boolean;
  endTurnRequested: boolean;
}

interface ApiEnvelope {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
}

type PersistedTranscriptResult = PersistedTranscriptProcessingResult;

function send(socket: WebSocket, message: AudioServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function errorMessage(
  socket: WebSocket,
  state: ConnectionState,
  code: string,
  message: string,
  retryable: boolean,
  correlationId?: string,
): void {
  send(socket, {
    protocolVersion: AUDIO_PROTOCOL_VERSION,
    type: "audio.error",
    correlationId,
    audioSessionId: state.audioSessionId ?? undefined,
    code,
    message,
    retryable,
  });
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function authenticateAudioRequest(
  interviewId: string,
  cookie: string,
  origin: string,
  iapAssertion = "",
) {
  const principal = getCustomServerAuthService().authenticate(
    new Request(`${origin}/ws/interviews/${encodeURIComponent(interviewId)}/audio`, {
      headers: { cookie, "x-goog-iap-jwt-assertion": iapAssertion },
    }),
  );
  new ConsentService(getDatabase()).assertEffectiveConsent(
    interviewId,
    "MICROPHONE_INTERVIEW",
    principal,
  );
  const sttEndpoint = new URL((process.env.DONGHAENG_STT_ENDPOINT || "https://api.openai.com/v1/audio/transcriptions").trim());
  if (isPublicReviewMode() || !["127.0.0.1", "localhost", "[::1]"].includes(sttEndpoint.hostname)) {
    new ConsentService(getDatabase()).assertEffectiveConsent(interviewId, "CLOUD_AI_PROCESSING", principal);
  }
  return principal;
}

function newConnectionState(
  interviewId: string,
  cookie: string,
  principalKey: string,
  socket: WebSocket,
  iapAssertion = "",
): ConnectionState {
  return {
    interviewId,
    tenantId: null,
    cookie,
    iapAssertion,
    principalKey,
    activeSocket: socket,
    audioSessionId: null,
    audioLeaseOwnerToken: null,
    audioLeaseRenewedAtEpochMs: null,
    lastAudioSeq: 0,
    session: null,
    sttProviderLabel: null,
    questionInfoCode: null,
    expectedVersion: null,
    finalized: false,
    finalTranscript: null,
    processingStatus: null,
    processingCode: null,
    cleanupTimer: null,
    startedAtEpochMs: null,
    speechStoppedAtEpochMs: null,
    operationController: null,
    receivedAudioFrame: false,
    endTurnRequested: false,
  };
}

function audioTurnLeaseIdentity(
  state: ConnectionState,
  audioSessionId = state.audioSessionId,
): AudioTurnLeaseIdentity | null {
  if (!state.tenantId || !audioSessionId || !state.audioLeaseOwnerToken) return null;
  return {
    tenantId: state.tenantId,
    interviewId: state.interviewId,
    audioSessionId,
    ownerToken: state.audioLeaseOwnerToken,
  };
}

function beginAudioTurnLease(state: ConnectionState): void {
  const identity = audioTurnLeaseIdentity(state);
  if (!identity) throw new Error("AUDIO_TURN_LEASE_IDENTITY_MISSING");
  try {
    getInterviewActivityRegistry().beginTurn(identity);
    state.audioLeaseRenewedAtEpochMs = Date.now();
  } catch (error) {
    if (error instanceof AudioTurnLeaseConflictError) {
      throw new StreamingSttError(error.code, error.message, true);
    }
    throw error;
  }
}

function markAudioTurnTranscriptPending(state: ConnectionState): void {
  const identity = audioTurnLeaseIdentity(state);
  if (!identity) throw new Error("AUDIO_TURN_LEASE_IDENTITY_MISSING");
  try {
    getInterviewActivityRegistry().markFinalTranscriptPending(identity);
    state.audioLeaseRenewedAtEpochMs = Date.now();
  } catch (error) {
    if (error instanceof AudioTurnLeaseConflictError) {
      throw new StreamingSttError(error.code, error.message, false);
    }
    throw error;
  }
}

function renewAudioTurnLeaseIfDue(state: ConnectionState): void {
  const identity = audioTurnLeaseIdentity(state);
  if (!identity || state.finalized) return;
  const now = Date.now();
  if (
    state.audioLeaseRenewedAtEpochMs !== null &&
    now - state.audioLeaseRenewedAtEpochMs < AUDIO_TURN_LEASE_RENEW_INTERVAL_MS
  ) {
    return;
  }
  if (!getInterviewActivityRegistry().renewTurn(identity, new Date(now))) {
    throw new StreamingSttError(
      "AUDIO_TURN_LEASE_LOST",
      "음성 세션 보호 시간이 만료되었습니다. 답변을 다시 시작해 주세요.",
      false,
    );
  }
  state.audioLeaseRenewedAtEpochMs = now;
}

function finishAudioTurnLease(
  state: ConnectionState,
  audioSessionId = state.audioSessionId,
): void {
  const identity = audioTurnLeaseIdentity(state, audioSessionId);
  if (!identity) return;
  getInterviewActivityRegistry().finishTurn(identity);
  state.audioLeaseOwnerToken = null;
  state.audioLeaseRenewedAtEpochMs = null;
}

async function fetchInternalApi(
  input: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
  timeoutMs = INTERNAL_API_TIMEOUT_MS,
): Promise<{ ok: boolean; status: number; envelope: ApiEnvelope }> {
  const result = await fetchBoundedJson({
    input,
    init,
    externalSignal,
    timeoutMs,
  });
  return {
    ok: result.ok,
    status: result.status,
    envelope: result.body as ApiEnvelope,
  };
}

async function fetchInterviewContext(
  state: ConnectionState,
  signal?: AbortSignal,
): Promise<void> {
  const result = await fetchInternalApi(
    `http://127.0.0.1:${port}/api/interviews/${encodeURIComponent(state.interviewId)}`,
    {
      headers: { cookie: state.cookie, "x-goog-iap-jwt-assertion": state.iapAssertion },
    },
    signal,
  );
  const { envelope } = result;
  if (!result.ok || envelope.error) {
    throw new Error(envelope.error?.message || `인터뷰 조회 실패 (${result.status})`);
  }
  const root = readRecord(envelope.data);
  const snapshot = readRecord(root?.snapshot) ?? root;
  const session = readRecord(snapshot?.session);
  const question = readRecord(snapshot?.nextQuestion);
  state.expectedVersion =
    typeof session?.version === "number" ? session.version : null;
  state.questionInfoCode =
    typeof question?.infoCode === "string" ? question.infoCode : null;
  if (state.expectedVersion === null) throw new Error("인터뷰 버전을 확인할 수 없습니다.");
}

async function persistFinalTranscript(
  state: ConnectionState,
  transcript: string,
  operationController: AbortController,
  signal?: AbortSignal,
): Promise<PersistedTranscriptResult> {
  assertAudioFinalizationActive({
    expectedController: operationController,
    currentController: state.operationController,
    signal,
  });
  if (state.expectedVersion === null) await fetchInterviewContext(state, signal);
  assertAudioFinalizationActive({
    expectedController: operationController,
    currentController: state.operationController,
    signal,
  });
  const submitFinalTranscript = () => fetchInternalApi(
    `http://127.0.0.1:${port}/api/interviews/${encodeURIComponent(state.interviewId)}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: state.cookie,
        "x-goog-iap-jwt-assertion": state.iapAssertion,
        origin:
          process.env.DONGHAENG_APP_ORIGIN || `http://${hostname}:${port}`,
      },
      body: JSON.stringify({
        text: transcript,
        clientMessageId: `audio-${state.audioSessionId}-final`,
        expectedVersion: state.expectedVersion,
        currentQuestionInfoCode: state.questionInfoCode,
        transcriptMetadata: {
          startMs: 0,
          endMs:
            state.startedAtEpochMs === null
              ? null
              : Math.max(
                  0,
                  (state.speechStoppedAtEpochMs ?? Date.now()) -
                    state.startedAtEpochMs,
                ),
          sttConfidence: null,
          sttProvider: state.sttProviderLabel,
        },
      }),
    },
    signal,
    INTERNAL_FINAL_TRANSCRIPT_TIMEOUT_MS,
  );
  const attemptedQuestionInfoCode = state.questionInfoCode;
  let result = await submitFinalTranscript();
  const shouldRefreshAndRetry =
    result.status === 409 &&
    (result.envelope.error?.code === "VERSION_CONFLICT" ||
      result.envelope.error?.code === "STALE_QUESTION");
  // Consent/audit or another non-question mutation can advance the aggregate
  // between audio.start and the final transcript. Refresh once only when the
  // exact question is unchanged; never attach speech to a different question.
  if (shouldRefreshAndRetry) {
    await fetchInterviewContext(state, signal);
    assertAudioFinalizationActive({
      expectedController: operationController,
      currentController: state.operationController,
      signal,
    });
    if (state.questionInfoCode === attemptedQuestionInfoCode) {
      result = await submitFinalTranscript();
    }
  }
  assertAudioFinalizationActive({
    expectedController: operationController,
    currentController: state.operationController,
    signal,
  });
  const { envelope } = result;
  if (!result.ok || envelope.error) {
    throw new Error(envelope.error?.message || `음성 전사 저장 실패 (${result.status})`);
  }
  const { processingStatus, processingCode } =
    readPersistedTranscriptProcessing(envelope.data);
  state.processingStatus = processingStatus;
  state.processingCode = processingCode;
  state.finalized = true;
  state.finalTranscript = transcript;
  finishAudioTurnLease(state);
  return { processingStatus, processingCode };
}

async function terminateAudioSession(
  state: ConnectionState,
  audioSessionId: string,
): Promise<void> {
  const session = state.session;
  const operationController = state.operationController;
  state.session = null;
  state.operationController = null;
  state.endTurnRequested = false;
  try {
    await cancelAudioOperationImmediately(operationController, session);
  } finally {
    if (resumableAudioSessions.get(audioSessionId) === state) {
      resumableAudioSessions.delete(audioSessionId);
    }
    finishAudioTurnLease(state, audioSessionId);
  }
}

function evictOneFinalizedReplaySession(): boolean {
  for (const [audioSessionId, state] of resumableAudioSessions) {
    if (!state.finalized) continue;
    if (state.cleanupTimer) clearTimeout(state.cleanupTimer);
    state.operationController?.abort();
    state.operationController = null;
    const session = state.session;
    state.session = null;
    resumableAudioSessions.delete(audioSessionId);
    void session?.stop().catch(() => undefined);
    finishAudioTurnLease(state, audioSessionId);
    return true;
  }
  return false;
}

function retainedSessionsForPrincipal(principalKey: string): number {
  let count = 0;
  for (const state of resumableAudioSessions.values()) {
    if (state.principalKey === principalKey && !state.finalized) count += 1;
  }
  for (const pendingPrincipalKey of pendingAudioSessionIds.values()) {
    if (pendingPrincipalKey === principalKey) count += 1;
  }
  return count;
}

function parseControl(raw: RawData): AudioControlMessage {
  const value = JSON.parse(raw.toString()) as Partial<AudioControlMessage>;
  if (
    value.protocolVersion !== AUDIO_PROTOCOL_VERSION ||
    typeof value.type !== "string" ||
    !AUDIO_CONTROL_TYPES.includes(value.type as AudioControlMessage["type"]) ||
    typeof value.correlationId !== "string" ||
    typeof value.audioSessionId !== "string" ||
    typeof value.interviewId !== "string"
  ) {
    throw new Error("AUDIO_CONTROL_INVALID");
  }
  assertSafeAudioControlIdentifier(value.correlationId, "correlationId");
  assertSafeAudioControlIdentifier(value.audioSessionId, "audioSessionId");
  assertSafeAudioControlIdentifier(value.interviewId, "interviewId");
  if (
    value.mimeType !== undefined &&
    (
      typeof value.mimeType !== "string" ||
      value.mimeType.length === 0 ||
      value.mimeType.length > 200 ||
      /[\r\n\0]/.test(value.mimeType)
    )
  ) {
    throw new Error("AUDIO_CONTROL_INVALID");
  }
  return value as AudioControlMessage;
}

async function startServer(): Promise<void> {
if (isGoogleIapMode()) await initializeIapVerifier();
await application.prepare();
if (isPublicReviewMode()) {
  const calls = new PublicReviewRealtime(getDatabase());
  let sweeping = false;
  const sweep = async () => {
    if (sweeping) return;
    sweeping = true;
    try { await calls.sweep(); } finally { sweeping = false; }
  };
  void sweep();
  setInterval(() => { void sweep(); }, 5_000).unref();
}

// Fail before binding a public port when the production Claude provider or
// its server-only credential is missing/invalid. This guard is deliberately
// configuration-only: the Next route bundle must own its service singleton and
// ApplicationError class graph instead of receiving a source-runtime instance
// through globalThis.
assertConfiguredInterviewProvider();

const server = createServer((request, response) => {
  if (isGoogleIapMode()) {
    try {
      verifyIapRequest(new Request(process.env.DONGHAENG_APP_ORIGIN!, {
        headers: { "x-goog-iap-jwt-assertion": typeof request.headers["x-goog-iap-jwt-assertion"] === "string" ? request.headers["x-goog-iap-jwt-assertion"] : "" },
      }));
    } catch (error) {
      response.writeHead(error instanceof ApplicationError ? error.status : 401, {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ data: null, error: { code: error instanceof ApplicationError ? error.code : "IAP_ASSERTION_INVALID", message: "Google 인증을 확인한 뒤 접속해 주세요." } }));
      return;
    }
  }
  void handle(request, response);
});

const websocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: 2 * 1024 * 1024,
  perMessageDeflate: false,
});

server.on("upgrade", (request, socket, head) => {
  let encodedInterviewId: string | null;
  try {
    const url = new URL(
      request.url || "/",
      `http://${request.headers.host || hostname}`,
    );
    encodedInterviewId = encodedAudioInterviewIdFromPath(url.pathname);
  } catch {
    return;
  }
  if (encodedInterviewId === null) {
    // Next.js owns non-audio upgrades such as /_next/webpack-hmr.
    return;
  }
  const requestOrigin = request.headers.origin;
  const forwardedProtocol = request.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProtocol === "string" && forwardedProtocol === "https"
      ? "https"
      : "http";
  const expectedOrigin =
    process.env.DONGHAENG_APP_ORIGIN ||
    `${protocol}://${request.headers.host || `${hostname}:${port}`}`;
  if (
    (process.env.NODE_ENV === "production" && !requestOrigin) ||
    (requestOrigin && requestOrigin !== expectedOrigin)
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  let decodedInterviewId: string;
  try {
    decodedInterviewId = decodeURIComponent(encodedInterviewId);
  } catch {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  let principalKey = "";
  try {
    const principal = authenticateAudioRequest(
      decodedInterviewId,
      request.headers.cookie || "",
      expectedOrigin,
      typeof request.headers["x-goog-iap-jwt-assertion"] === "string" ? request.headers["x-goog-iap-jwt-assertion"] : "",
    );
    principalKey = audioPrincipalOwnershipKey(principal);
  } catch (caught) {
    const status = caught instanceof ApplicationError ? caught.status : 401;
    const responseStatus = status === 403 ? "403 Forbidden" : status === 404 ? "404 Not Found" : "401 Unauthorized";
    socket.write(`HTTP/1.1 ${responseStatus}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
    return;
  }
  const remoteAddress = request.socket.remoteAddress || "unknown";
  const connectionKey = `${remoteAddress}:${principalKey}`;
  if (
    websocketServer.clients.size >= MAX_TOTAL_AUDIO_CONNECTIONS ||
    (connectionsByClient.get(connectionKey) ?? 0) >= MAX_AUDIO_CONNECTIONS_PER_CLIENT
  ) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    connectionsByClient.set(
      connectionKey,
      (connectionsByClient.get(connectionKey) ?? 0) + 1,
    );
    connectionKeys.set(websocket, connectionKey);
    connectionPrincipalKeys.set(websocket, principalKey);
    websocketServer.emit("connection", websocket, request, decodedInterviewId);
  });
});

websocketServer.on(
  "connection",
  (socket: WebSocket, request: import("node:http").IncomingMessage, interviewId: string) => {
    const principalKey = connectionPrincipalKeys.get(socket);
    if (!principalKey) {
      socket.close(1011, "authenticated principal unavailable");
      return;
    }
    let state = newConnectionState(
      interviewId,
      request.headers.cookie || "",
      principalKey,
      socket,
      typeof request.headers["x-goog-iap-jwt-assertion"] === "string" ? request.headers["x-goog-iap-jwt-assertion"] : "",
    );
    let messageChain = Promise.resolve();
    let authenticationRenewalTimer: ReturnType<typeof setTimeout> | null = null;
    if (isGoogleIapMode()) {
      const identity = verifyIapRequest(new Request(process.env.DONGHAENG_APP_ORIGIN!, { headers: { "x-goog-iap-jwt-assertion": state.iapAssertion } }));
      const renew = () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        // Never interrupt the bounded final-transcript transaction. Normal
        // finalization closes this socket; a long capture resumes by sequence.
        if (state.endTurnRequested || state.finalized) {
          authenticationRenewalTimer = setTimeout(renew, 1_000);
          return;
        }
        socket.close(4001, "refresh Google authentication");
      };
      authenticationRenewalTimer = setTimeout(renew, iapAudioRenewalDelay(identity.expiresAt, Date.now()));
    }
    let messageWindowStartedAt = Date.now();
    let messagesInWindow = 0;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.close(4000, "audio session idle timeout");
        }
      }, 60_000);
    };
    resetIdleTimer();

    socket.on("message", (raw, isBinary) => {
      resetIdleTimer();
      const now = Date.now();
      if (now - messageWindowStartedAt >= 60_000) {
        messageWindowStartedAt = now;
        messagesInWindow = 0;
      }
      messagesInWindow += 1;
      if (messagesInWindow > 400) {
        socket.close(1008, "audio message rate exceeded");
        return;
      }
      if (!isBinary) {
        try {
          const immediateControl = parseControl(raw);
          if (
            state.activeSocket === socket &&
            immediateControl.interviewId === state.interviewId &&
            immediateControl.audioSessionId === state.audioSessionId
          ) {
            if (immediateControl.type === "audio.end_turn") {
              state.endTurnRequested = true;
            }
            if (immediateControl.type === "audio.stop") {
              void terminateAudioSession(state, immediateControl.audioSessionId);
            }
          }
        } catch {
          // The ordered handler below owns protocol validation and reporting.
        }
      }
      messageChain = messageChain.then(async () => {
        try {
          if (isBinary) {
            if (!state.session || !state.audioSessionId) {
              throw new Error("AUDIO_SESSION_NOT_STARTED");
            }
            renewAudioTurnLeaseIfDue(state);
            const bytes = new Uint8Array(
              raw instanceof Buffer
                ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
                : raw as ArrayBuffer,
            );
            const frame = decodeAudioFrame(bytes);
            if (frame.header.audioSessionId !== state.audioSessionId) {
              throw new Error("AUDIO_SESSION_MISMATCH");
            }
            if (frame.header.audioSeq <= state.lastAudioSeq) {
              send(socket, {
                protocolVersion: AUDIO_PROTOCOL_VERSION,
                type: "audio.ack",
                audioSessionId: state.audioSessionId,
                lastAudioSeq: state.lastAudioSeq,
              });
              return;
            }
            if (frame.header.audioSeq !== state.lastAudioSeq + 1) {
              errorMessage(
                socket,
                state,
                "AUDIO_SEQUENCE_GAP",
                "오디오 순서가 끊겨 답변을 안전하게 확정할 수 없습니다. 텍스트로 전환해 주세요.",
                false,
              );
              return;
            }
            await state.session.pushAudio(frame.audio, frame.header.audioSeq);
            state.lastAudioSeq = frame.header.audioSeq;
            if (frame.audio.byteLength > 0) state.receivedAudioFrame = true;
            send(socket, {
              protocolVersion: AUDIO_PROTOCOL_VERSION,
              type: "audio.ack",
              audioSessionId: state.audioSessionId,
              lastAudioSeq: state.lastAudioSeq,
            });
            return;
          }

          const control = parseControl(raw);
          if (control.interviewId !== state.interviewId) {
            throw new Error("INTERVIEW_ID_MISMATCH");
          }
          renewAudioTurnLeaseIfDue(state);
          if (control.type === "audio.start") {
            if (!control.mimeType) throw new Error("AUDIO_MIME_TYPE_REQUIRED");
            const principal = authenticateAudioRequest(
              interviewId,
              request.headers.cookie || "",
              process.env.DONGHAENG_APP_ORIGIN || `http://${hostname}:${port}`,
              typeof request.headers["x-goog-iap-jwt-assertion"] === "string" ? request.headers["x-goog-iap-jwt-assertion"] : "",
            );
            const requestPrincipalKey = audioPrincipalOwnershipKey(principal);
            const existing = resumableAudioSessions.get(control.audioSessionId);
            while (
              !existing &&
              resumableAudioSessions.size + pendingAudioSessionIds.size >=
                MAX_RESUMABLE_AUDIO_SESSIONS &&
              evictOneFinalizedReplaySession()
            ) {
              // Preserve active sessions by evicting only finalized replay state.
            }
            assertAudioSessionStartAllowed({
              currentAudioSessionId: state.audioSessionId,
              hasActiveSession: state.session !== null,
              requestedAudioSessionId: control.audioSessionId,
              requestedSessionExists: existing !== undefined,
              requestedSessionPending: pendingAudioSessionIds.has(
                control.audioSessionId,
              ),
              resumableSessionCount:
                resumableAudioSessions.size + pendingAudioSessionIds.size,
              principalSessionCount: retainedSessionsForPrincipal(
                requestPrincipalKey,
              ),
            });
            if (existing) {
              if (
                existing.interviewId !== interviewId ||
                existing.principalKey !== requestPrincipalKey
              ) {
                throw new Error("AUDIO_SESSION_RESUME_FORBIDDEN");
              }
              if (
                existing.activeSocket !== socket &&
                existing.activeSocket.readyState === WebSocket.OPEN
              ) {
                existing.activeSocket.close(4001, "audio session resumed elsewhere");
              }
              if (existing.cleanupTimer) clearTimeout(existing.cleanupTimer);
              existing.cleanupTimer = null;
              existing.activeSocket = socket;
              state = existing;
              state.cookie = request.headers.cookie || "";
              state.iapAssertion = typeof request.headers["x-goog-iap-jwt-assertion"] === "string" ? request.headers["x-goog-iap-jwt-assertion"] : "";
              if (!state.finalized) {
                beginAudioTurnLease(state);
              }
              send(socket, {
                protocolVersion: AUDIO_PROTOCOL_VERSION,
                type: "audio.ack",
                correlationId: control.correlationId,
                audioSessionId: control.audioSessionId,
                lastAudioSeq: state.lastAudioSeq,
              });
              if (state.finalized && state.finalTranscript) {
                if (state.processingStatus === null) {
                  errorMessage(
                    socket,
                    state,
                    "TURN_PROCESSING_STATUS_INVALID",
                    "저장된 음성 답변의 처리 상태를 확인하지 못했습니다. 최신 인터뷰 상태를 다시 확인해 주세요.",
                    true,
                  );
                  return;
                }
                send(socket, {
                  protocolVersion: AUDIO_PROTOCOL_VERSION,
                  type: "stt.final",
                  audioSessionId: control.audioSessionId,
                  text: state.finalTranscript,
                  provider: state.sttProviderLabel ?? sttAdapter.providerLabel,
                  serverTime: new Date().toISOString(),
                  processingStatus: state.processingStatus,
                  processingCode: state.processingCode,
                });
              }
              return;
            }

            pendingAudioSessionIds.set(
              control.audioSessionId,
              requestPrincipalKey,
            );
            try {
              state = newConnectionState(
                interviewId,
                request.headers.cookie || "",
                requestPrincipalKey,
                socket,
                typeof request.headers["x-goog-iap-jwt-assertion"] === "string" ? request.headers["x-goog-iap-jwt-assertion"] : "",
              );
              await fetchInterviewContext(state);
              if (socket.readyState !== WebSocket.OPEN) {
                throw new StreamingSttError(
                  "AUDIO_CONNECTION_CLOSED",
                  "연결이 닫힌 뒤에는 오디오 세션을 시작하지 않습니다.",
                  false,
                );
              }
              state.audioSessionId = control.audioSessionId;
              state.tenantId = principal.tenantId;
              state.audioLeaseOwnerToken = randomUUID();
              state.startedAtEpochMs = Date.now();
              state.operationController = new AbortController();
              beginAudioTurnLease(state);
              const sessionState = state;
              reserveReviewUsage(getDatabase(), "stt", principal.tenantId, 4);
              state.session = sttAdapter.createSession({
                locale: "ko-KR",
                mimeType: control.mimeType,
                callbacks: {
                  onSpeechStarted: () =>
                    send(sessionState.activeSocket, {
                      protocolVersion: AUDIO_PROTOCOL_VERSION,
                      type: "vad.speech_started",
                      audioSessionId: control.audioSessionId,
                      serverTime: new Date().toISOString(),
                    }),
                  onSpeechStopped: () => {
                    sessionState.speechStoppedAtEpochMs = Date.now();
                    send(sessionState.activeSocket, {
                      protocolVersion: AUDIO_PROTOCOL_VERSION,
                      type: "vad.speech_stopped",
                      audioSessionId: control.audioSessionId,
                      serverTime: new Date().toISOString(),
                    });
                  },
                  onPartial: (text) =>
                    send(sessionState.activeSocket, {
                      protocolVersion: AUDIO_PROTOCOL_VERSION,
                      type: "stt.partial",
                      audioSessionId: control.audioSessionId,
                      text,
                      provider:
                        sessionState.sttProviderLabel ?? sttAdapter.providerLabel,
                      serverTime: new Date().toISOString(),
                    }),
                  onFinal: async (text, signal) => {
                    const operationController = sessionState.operationController;
                    const activeOperationController = assertAudioFinalizationActive({
                      expectedController: operationController,
                      currentController: sessionState.operationController,
                      signal,
                    });
                    const persistenceSignal = signal
                      ? AbortSignal.any([activeOperationController.signal, signal])
                      : activeOperationController.signal;
                    // Recognition is complete at this point. Tell the browser
                    // immediately so it can render the borrower's words while
                    // durable staging, Claude validation and projections run.
                    // stt.final below remains the authoritative applied-turn
                    // boundary and keeps the existing idempotent persistence
                    // contract intact.
                    send(sessionState.activeSocket, {
                      protocolVersion: AUDIO_PROTOCOL_VERSION,
                      type: "stt.recognized",
                      audioSessionId: control.audioSessionId,
                      text,
                      provider:
                        sessionState.sttProviderLabel ?? sttAdapter.providerLabel,
                      serverTime: new Date().toISOString(),
                    });
                    const persisted = await persistFinalTranscript(
                      sessionState,
                      text,
                      activeOperationController,
                      persistenceSignal,
                    );
                    assertAudioFinalizationActive({
                      expectedController: activeOperationController,
                      currentController: sessionState.operationController,
                      signal: persistenceSignal,
                    });
                    send(sessionState.activeSocket, {
                      protocolVersion: AUDIO_PROTOCOL_VERSION,
                      type: "stt.final",
                      audioSessionId: control.audioSessionId,
                      text,
                      provider:
                        sessionState.sttProviderLabel ?? sttAdapter.providerLabel,
                      serverTime: new Date().toISOString(),
                      processingStatus: persisted.processingStatus,
                      processingCode: persisted.processingCode,
                    });
                    if (
                      sessionState.operationController === activeOperationController
                    ) {
                      sessionState.operationController = null;
                    }
                  },
                  onError: (error) => {
                    errorMessage(
                      sessionState.activeSocket,
                      sessionState,
                      error instanceof StreamingSttError
                        ? error.code
                        : "STT_PROVIDER_ERROR",
                      error.message,
                      error instanceof StreamingSttError
                        ? error.retryable
                        : true,
                    );
                  },
                },
              });
              state.sttProviderLabel = state.session.providerLabel;
              await state.session.start();
              resumableAudioSessions.set(control.audioSessionId, state);
            } catch (caught) {
              if (state.audioSessionId === control.audioSessionId) {
                await terminateAudioSession(state, control.audioSessionId);
              }
              throw caught;
            } finally {
              pendingAudioSessionIds.delete(control.audioSessionId);
            }
            send(socket, {
              protocolVersion: AUDIO_PROTOCOL_VERSION,
              type: "audio.ack",
              correlationId: control.correlationId,
              audioSessionId: control.audioSessionId,
              lastAudioSeq: state.lastAudioSeq,
            });
            return;
          }
          if (
            control.type === "audio.stop" &&
            control.audioSessionId === state.audioSessionId
          ) {
            await terminateAudioSession(state, control.audioSessionId);
            send(socket, {
              protocolVersion: AUDIO_PROTOCOL_VERSION,
              type: "audio.ack",
              correlationId: control.correlationId,
              audioSessionId: state.audioSessionId,
              lastAudioSeq: state.lastAudioSeq,
            });
            return;
          }
          if (!state.session || control.audioSessionId !== state.audioSessionId) {
            throw new Error("AUDIO_SESSION_MISMATCH");
          }
          if (control.type === "audio.pause") await state.session.pause();
          if (control.type === "audio.resume") await state.session.resume();
          if (control.type === "audio.end_turn") {
            state.endTurnRequested = true;
            markAudioTurnTranscriptPending(state);
            try {
              await endTurnWithFailureCleanup(
                state.session,
                () => terminateAudioSession(state, control.audioSessionId),
              );
            } finally {
              state.endTurnRequested = false;
            }
          }
          send(socket, {
            protocolVersion: AUDIO_PROTOCOL_VERSION,
            type: "audio.ack",
            correlationId: control.correlationId,
            audioSessionId: state.audioSessionId,
            lastAudioSeq: state.lastAudioSeq,
          });
        } catch (caught) {
          if (caught instanceof StreamingSttError && caught.reported) return;
          errorMessage(
            socket,
            state,
            caught instanceof ApplicationError
              ? caught.code
              : caught instanceof StreamingSttError
                ? caught.code
              : "AUDIO_PROTOCOL_ERROR",
            caught instanceof Error ? caught.message : "음성 요청을 처리하지 못했습니다.",
            caught instanceof StreamingSttError ? caught.retryable : false,
          );
        }
      });
    });

    socket.on("close", () => {
      if (authenticationRenewalTimer) clearTimeout(authenticationRenewalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (state.audioSessionId && state.activeSocket === socket) {
        const retainedState = state;
        const retainedAudioSessionId = state.audioSessionId;
        if (retainedState.session === null) {
          // An explicit stop already released this session.
        } else if (shouldCancelAudioOperationOnSocketClose({
          endTurnRequested: retainedState.endTurnRequested,
          finalized: retainedState.finalized,
          receivedAudioFrame: retainedState.receivedAudioFrame,
        })) {
          void terminateAudioSession(
            retainedState,
            retainedAudioSessionId,
          );
        } else {
          retainedState.cleanupTimer = setTimeout(
            () => {
              if (retainedState.audioSessionId) {
                void terminateAudioSession(
                  retainedState,
                  retainedState.audioSessionId,
                );
              }
            },
            retainedState.finalized ? 120_000 : 30_000,
          );
        }
      }
      const connectionKey = connectionKeys.get(socket);
      if (connectionKey) {
        const remaining = Math.max(
          0,
          (connectionsByClient.get(connectionKey) ?? 1) - 1,
        );
        if (remaining === 0) connectionsByClient.delete(connectionKey);
        else connectionsByClient.set(connectionKey, remaining);
      }
    });
    socket.on("error", () => {
      // close performs bounded session retention and connection accounting.
    });
  },
);

server.listen(port, hostname, () => {
  process.stdout.write(
    `Donghaeng Finance AI ${development ? "development" : "production"} server listening on http://${hostname}:${port}\n`,
  );
  process.stdout.write(`STT provider: ${sttAdapter.providerLabel}\n`);
});

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  const shutdownDeadline = setTimeout(() => process.exit(1), 15_000);
  shutdownDeadline.unref();
  if (isPublicReviewMode()) await new PublicReviewRealtime(getDatabase()).sweep(true);
  for (const client of websocketServer.clients) {
    client.close(1001, "server shutdown");
  }
  for (const [audioSessionId, state] of resumableAudioSessions) {
    void terminateAudioSession(state, audioSessionId);
  }
  server.close(() => {
    try {
      getDatabase().close();
    } finally {
      process.exit(0);
    }
  });
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
}

void startServer().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
