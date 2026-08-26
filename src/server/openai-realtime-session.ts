import { createHash } from "node:crypto";

import {
  OPENAI_REALTIME_MODEL,
  OPENAI_REALTIME_TRANSCRIPTION_MODEL,
  OPENAI_REALTIME_VOICE,
  realtimeSessionInstructions,
  type RealtimeClientSecretView,
} from "@/realtime/openai-realtime-voice";

import { ApplicationError } from "./errors";

const OPENAI_REALTIME_CLIENT_SECRET_ENDPOINT =
  "https://api.openai.com/v1/realtime/client_secrets";
const SESSION_ISSUE_WINDOW_MS = 60_000;
const MAX_SESSIONS_PER_WINDOW = 6;
const UPSTREAM_TIMEOUT_MS = 10_000;

type UnknownRecord = Record<string, unknown>;

interface RealtimeSessionIssuerOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  apiKey?: string | null;
}

interface IssueRealtimeSessionInput {
  interviewId: string;
  userId: string;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeApiKey(value: string | null | undefined): string | null {
  const key = value?.trim() ?? "";
  if (
    !key ||
    key.length < 20 ||
    key.length > 2_048 ||
    !key.startsWith("sk-") ||
    /\s/u.test(key)
  ) {
    return null;
  }
  return key;
}

function safetyIdentifier(userId: string): string {
  return `donghaeng-${createHash("sha256").update(userId).digest("hex").slice(0, 32)}`;
}

function upstreamSecret(value: unknown): { value: string; expiresAt: number | null } | null {
  if (!isRecord(value)) return null;
  const nested = isRecord(value.client_secret) ? value.client_secret : null;
  const secret = typeof value.value === "string"
    ? value.value.trim()
    : typeof nested?.value === "string"
      ? nested.value.trim()
      : "";
  const expiry = value.expires_at ?? nested?.expires_at ?? null;
  if (
    !secret ||
    secret.length > 2_048 ||
    (expiry !== null &&
      (typeof expiry !== "number" || !Number.isFinite(expiry) || expiry <= 0))
  ) {
    return null;
  }
  return { value: secret, expiresAt: expiry as number | null };
}

export function openAIRealtimeSessionConfig(): UnknownRecord {
  return {
    session: {
      type: "realtime",
      model: OPENAI_REALTIME_MODEL,
      output_modalities: ["audio"],
      max_output_tokens: 220,
      instructions: realtimeSessionInstructions(),
      reasoning: {
        effort: "low",
      },
      audio: {
        input: {
          transcription: {
            model: OPENAI_REALTIME_TRANSCRIPTION_MODEL,
            language: "ko",
            prompt:
              "한국어 소상공인 금융 인터뷰입니다. 매출, 고정비, 배달 매출, 재방문율, 예약, 부채, 상환, 생활비와 같은 사업 용어를 정확히 전사하세요.",
          },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          voice: OPENAI_REALTIME_VOICE,
        },
      },
    },
  };
}

export class OpenAIRealtimeSessionIssuer {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly configuredApiKey: string | null | undefined;
  private readonly windows = new Map<string, RateWindow>();

  constructor(options: RealtimeSessionIssuerOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
    this.configuredApiKey = options.apiKey;
  }

  private assertRateLimit(input: IssueRealtimeSessionInput) {
    const now = this.now();
    const key = `${input.userId}:${input.interviewId}`;
    const existing = this.windows.get(key);
    if (!existing || now - existing.startedAt >= SESSION_ISSUE_WINDOW_MS) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    if (existing.count >= MAX_SESSIONS_PER_WINDOW) {
      throw new ApplicationError(
        429,
        "OPENAI_REALTIME_RATE_LIMITED",
        "실시간 음성 연결을 너무 자주 다시 시작했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    existing.count += 1;
  }

  async issue(input: IssueRealtimeSessionInput): Promise<RealtimeClientSecretView> {
    const apiKey = safeApiKey(
      this.configuredApiKey === undefined
        ? process.env.OPENAI_API_KEY
        : this.configuredApiKey,
    );
    if (!apiKey) {
      throw new ApplicationError(
        503,
        "OPENAI_REALTIME_NOT_CONFIGURED",
        "실시간 AI 음성 키가 아직 설정되지 않아 로컬 음성으로 전환합니다.",
      );
    }
    this.assertRateLimit(input);

    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_REALTIME_CLIENT_SECRET_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": safetyIdentifier(input.userId),
        },
        body: JSON.stringify(openAIRealtimeSessionConfig()),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      throw new ApplicationError(
        502,
        "OPENAI_REALTIME_UNAVAILABLE",
        "실시간 AI 음성 서버에 연결하지 못해 로컬 음성으로 전환합니다.",
      );
    }

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApplicationError(
        response.status === 429 ? 429 : 502,
        response.status === 429
          ? "OPENAI_REALTIME_UPSTREAM_RATE_LIMITED"
          : "OPENAI_REALTIME_UNAVAILABLE",
        response.status === 429
          ? "실시간 AI 음성 사용량이 잠시 제한되어 로컬 음성으로 전환합니다."
          : "실시간 AI 음성 세션을 시작하지 못해 로컬 음성으로 전환합니다.",
        { upstreamStatus: response.status },
      );
    }
    const secret = upstreamSecret(payload);
    if (!secret) {
      throw new ApplicationError(
        502,
        "OPENAI_REALTIME_INVALID_RESPONSE",
        "실시간 AI 음성 연결 정보를 확인하지 못해 로컬 음성으로 전환합니다.",
      );
    }
    return {
      value: secret.value,
      expiresAt: secret.expiresAt,
      model: OPENAI_REALTIME_MODEL,
      voice: OPENAI_REALTIME_VOICE,
    };
  }
}

const globalRealtimeIssuer = globalThis as typeof globalThis & {
  __donghaengOpenAIRealtimeSessionIssuer?: OpenAIRealtimeSessionIssuer;
};

export function getOpenAIRealtimeSessionIssuer(): OpenAIRealtimeSessionIssuer {
  if (!globalRealtimeIssuer.__donghaengOpenAIRealtimeSessionIssuer) {
    globalRealtimeIssuer.__donghaengOpenAIRealtimeSessionIssuer =
      new OpenAIRealtimeSessionIssuer();
  }
  return globalRealtimeIssuer.__donghaengOpenAIRealtimeSessionIssuer;
}
