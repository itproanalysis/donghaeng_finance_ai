import type {
  StreamingSttAdapter,
  StreamingSttCallbacks,
  StreamingSttSession,
} from "./stt-adapter";
import { StreamingSttError } from "./stt-adapter";

const MAX_TRANSCRIPT_CHARACTERS = 100_000;
const MAX_RESPONSE_BYTES = 1_000_000;

const AUDIO_MIME_FILES = new Map<string, { extension: string; mimeType: string }>([
  ["audio/flac", { extension: "flac", mimeType: "audio/flac" }],
  ["audio/mp3", { extension: "mp3", mimeType: "audio/mpeg" }],
  ["audio/mpeg", { extension: "mp3", mimeType: "audio/mpeg" }],
  ["audio/mp4", { extension: "m4a", mimeType: "audio/mp4" }],
  ["audio/ogg", { extension: "ogg", mimeType: "audio/ogg" }],
  ["audio/wav", { extension: "wav", mimeType: "audio/wav" }],
  ["audio/webm", { extension: "webm", mimeType: "audio/webm" }],
  ["audio/x-flac", { extension: "flac", mimeType: "audio/flac" }],
  ["audio/x-m4a", { extension: "m4a", mimeType: "audio/mp4" }],
  ["audio/x-wav", { extension: "wav", mimeType: "audio/wav" }],
]);

export interface OpenAiCompatibleSttAdapterConfig {
  endpoint: string | URL;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  maxTotalBufferBytes?: number;
  maxChunks?: number;
  fetchImpl?: typeof fetch;
}

interface AudioFileDescriptor {
  extension: string;
  mimeType: string;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  code: string,
): number {
  const selected = value ?? fallback;
  if (
    !Number.isSafeInteger(selected) ||
    selected < minimum ||
    selected > maximum
  ) {
    throw new StreamingSttError(code, `${code}: ${minimum}..${maximum}`, false);
  }
  return selected;
}

export function safeAudioFileDescriptor(mimeType: string): AudioFileDescriptor {
  if (
    typeof mimeType !== "string" ||
    mimeType.length === 0 ||
    mimeType.length > 200 ||
    /[\r\n\0]/.test(mimeType)
  ) {
    throw new StreamingSttError(
      "STT_MIME_UNSUPPORTED",
      "지원하지 않는 오디오 형식입니다.",
      false,
    );
  }
  const baseType = mimeType.split(";", 1)[0].trim().toLowerCase();
  const descriptor = AUDIO_MIME_FILES.get(baseType);
  if (!descriptor) {
    throw new StreamingSttError(
      "STT_MIME_UNSUPPORTED",
      "지원하지 않는 오디오 형식입니다.",
      false,
    );
  }
  return descriptor;
}

function parseEndpoint(value: string | URL): URL {
  let endpoint: URL;
  try {
    endpoint = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new StreamingSttError(
      "STT_ENDPOINT_INVALID",
      "STT endpoint가 올바른 URL이 아닙니다.",
      false,
    );
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash ||
    endpoint.search
  ) {
    throw new StreamingSttError(
      "STT_ENDPOINT_INVALID",
      "STT endpoint에는 HTTP(S) 경로만 사용할 수 있습니다.",
      false,
    );
  }
  return endpoint;
}

function validatedApiKey(value: string): string {
  const apiKey = value.trim();
  if (!apiKey || apiKey.length > 4_096 || /[\x00-\x1f\x7f]/.test(apiKey)) {
    throw new StreamingSttError(
      "STT_API_KEY_INVALID",
      "STT API key가 올바르지 않습니다.",
      false,
    );
  }
  return apiKey;
}

function validatedModel(value: string): string {
  const model = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(model)) {
    throw new StreamingSttError(
      "STT_MODEL_INVALID",
      "STT model 식별자가 올바르지 않습니다.",
      false,
    );
  }
  return model;
}

function providerLabel(endpoint: URL, model: string): string {
  const host = endpoint.hostname.slice(0, 48);
  const label = `OpenAI-compatible STT (${model} @ ${host})`;
  if (label.length > 128) {
    throw new StreamingSttError(
      "STT_PROVIDER_LABEL_INVALID",
      "STT provider 식별자가 너무 깁니다.",
      false,
    );
  }
  return label;
}

function strictTranscriptResponse(responseText: string): string {
  if (Buffer.byteLength(responseText, "utf8") > MAX_RESPONSE_BYTES) {
    throw new StreamingSttError(
      "STT_PROVIDER_RESPONSE_INVALID",
      "STT 제공자 응답이 허용 크기를 초과했습니다.",
      false,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new StreamingSttError(
      "STT_PROVIDER_RESPONSE_INVALID",
      "STT 제공자 응답이 올바른 JSON이 아닙니다.",
      false,
    );
  }
  const record = recordValue(parsed);
  if (!record || typeof record.text !== "string") {
    throw new StreamingSttError(
      "STT_PROVIDER_RESPONSE_INVALID",
      "STT 제공자 응답에 전사문이 없습니다.",
      false,
    );
  }
  const transcript = record.text.trim();
  if (!transcript || transcript.length > MAX_TRANSCRIPT_CHARACTERS) {
    throw new StreamingSttError(
      "STT_PROVIDER_RESPONSE_INVALID",
      "STT 제공자 전사문이 비어 있거나 너무 깁니다.",
      false,
    );
  }
  return transcript;
}

async function boundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new StreamingSttError(
          "STT_PROVIDER_RESPONSE_INVALID",
          "STT 제공자 응답이 허용 크기를 초과했습니다.",
          false,
        );
      }
      chunks.push(next.value);
    }
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(combined);
    } catch {
      throw new StreamingSttError(
        "STT_PROVIDER_RESPONSE_INVALID",
        "STT 제공자 응답이 UTF-8이 아닙니다.",
        false,
      );
    }
  } finally {
    reader.releaseLock();
  }
}

function discardResponseBody(response: Response): void {
  const cancellation = response.body?.cancel();
  if (cancellation) void cancellation.catch(() => undefined);
}

class OpenAiCompatibleSttSession implements StreamingSttSession {
  readonly providerLabel: string;
  private readonly descriptor: AudioFileDescriptor;
  private readonly chunks: ArrayBuffer[] = [];
  private bufferedBytes = 0;
  private lastAudioSeq = 0;
  private started = false;
  private paused = false;
  private speechStarted = false;
  private ending = false;
  private stopped = false;
  private failed = false;
  private inFlightController: AbortController | null = null;

  constructor(
    private readonly endpoint: URL,
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly maxBufferBytes: number,
    private readonly maxChunks: number,
    private readonly reserveBufferBytes: (byteLength: number) => boolean,
    private readonly releaseBufferBytes: (byteLength: number) => void,
    private readonly mimeType: string,
    private readonly callbacks: StreamingSttCallbacks,
    private readonly fetchImpl: typeof fetch,
  ) {
    this.descriptor = safeAudioFileDescriptor(mimeType);
    this.providerLabel = providerLabel(endpoint, model);
  }

  async start(): Promise<void> {
    this.assertUsable();
    if (this.started) {
      throw new StreamingSttError(
        "STT_SESSION_ALREADY_STARTED",
        "STT 세션이 이미 시작되었습니다.",
        false,
      );
    }
    this.started = true;
  }

  async pushAudio(audio: Uint8Array, audioSeq: number): Promise<void> {
    this.assertActive();
    if (!Number.isSafeInteger(audioSeq) || audioSeq !== this.lastAudioSeq + 1) {
      throw this.report(
        new StreamingSttError(
          "STT_AUDIO_SEQUENCE_INVALID",
          "STT 오디오 순서가 연속적이지 않습니다.",
          false,
        ),
      );
    }
    this.lastAudioSeq = audioSeq;
    if (this.paused || audio.byteLength === 0) return;
    if (
      this.chunks.length >= this.maxChunks ||
      this.bufferedBytes + audio.byteLength > this.maxBufferBytes
    ) {
      throw this.report(
        new StreamingSttError(
          "STT_BUFFER_LIMIT_EXCEEDED",
          "음성 답변이 서버 전사 버퍼 한도를 초과했습니다. 답변을 나누거나 텍스트로 전환해 주세요.",
          false,
        ),
      );
    }
    if (!this.reserveBufferBytes(audio.byteLength)) {
      throw this.report(
        new StreamingSttError(
          "STT_BUFFER_LIMIT_EXCEEDED",
          "서버의 전체 음성 버퍼 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
          true,
        ),
      );
    }
    try {
      const copy = new Uint8Array(audio.byteLength);
      copy.set(audio);
      this.chunks.push(copy.buffer);
      this.bufferedBytes += copy.byteLength;
    } catch {
      this.releaseBufferBytes(audio.byteLength);
      throw this.report(
        new StreamingSttError(
          "STT_BUFFER_ALLOCATION_FAILED",
          "음성 버퍼를 안전하게 할당하지 못했습니다.",
          true,
        ),
      );
    }
    if (!this.speechStarted) {
      this.speechStarted = true;
      try {
        this.callbacks.onSpeechStarted();
      } catch {
        throw this.report(
          new StreamingSttError(
            "STT_CALLBACK_FAILED",
            "STT 시작 이벤트를 처리하지 못했습니다.",
            true,
          ),
        );
      }
    }
  }

  async pause(): Promise<void> {
    this.assertActive();
    this.paused = true;
  }

  async resume(): Promise<void> {
    this.assertActive();
    this.paused = false;
  }

  async endTurn(): Promise<void> {
    this.assertActive();
    if (this.ending) {
      throw new StreamingSttError(
        "STT_END_TURN_IN_PROGRESS",
        "STT 답변 확정이 이미 진행 중입니다.",
        false,
      );
    }
    if (this.bufferedBytes === 0) {
      throw this.report(
        new StreamingSttError(
          "STT_AUDIO_EMPTY",
          "전사할 음성 데이터가 없습니다.",
          false,
        ),
      );
    }

    this.ending = true;
    this.paused = false;
    if (this.speechStarted) {
      try {
        this.callbacks.onSpeechStopped();
      } catch {
        throw this.report(
          new StreamingSttError(
            "STT_CALLBACK_FAILED",
            "STT 종료 이벤트를 처리하지 못했습니다.",
            true,
          ),
        );
      }
    }
    const controller = new AbortController();
    this.inFlightController = controller;
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let transcript: string;
    let providerCompleted = false;

    try {
      const form = new FormData();
      form.append(
        "file",
        new Blob(this.chunks, { type: this.descriptor.mimeType }),
        `interview-audio.${this.descriptor.extension}`,
      );
      form.set("model", this.model);
      form.set("language", "ko");
      form.set("response_format", "json");
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        discardResponseBody(response);
        throw new StreamingSttError(
          "STT_PROVIDER_HTTP_ERROR",
          `STT 제공자 요청이 실패했습니다. (HTTP ${response.status})`,
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
      }
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      const mediaType = contentType.split(";", 1)[0].trim();
      if (mediaType !== "application/json") {
        discardResponseBody(response);
        throw new StreamingSttError(
          "STT_PROVIDER_RESPONSE_INVALID",
          "STT 제공자가 JSON이 아닌 응답을 반환했습니다.",
          false,
        );
      }
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        discardResponseBody(response);
        throw new StreamingSttError(
          "STT_PROVIDER_RESPONSE_INVALID",
          "STT 제공자 응답이 허용 크기를 초과했습니다.",
          false,
        );
      }
      transcript = strictTranscriptResponse(await boundedResponseText(response));
      providerCompleted = true;
    } catch (caught) {
      if (caught instanceof StreamingSttError) throw this.report(caught);
      if (controller.signal.aborted && !this.stopped) {
        throw this.report(
          new StreamingSttError(
            "STT_PROVIDER_TIMEOUT",
            "STT 제공자 응답 시간이 초과되었습니다.",
            true,
          ),
        );
      }
      if (this.stopped) {
        throw new StreamingSttError(
          "STT_SESSION_STOPPED",
          "STT 세션이 중지되었습니다.",
          false,
        );
      }
      throw this.report(
        new StreamingSttError(
          "STT_PROVIDER_NETWORK_ERROR",
          "STT 제공자에 연결하지 못했습니다.",
          true,
        ),
      );
    } finally {
      clearTimeout(timeout);
      if (!providerCompleted && this.inFlightController === controller) {
        this.inFlightController = null;
      }
    }

    this.clearBuffer();
    try {
      this.callbacks.onPartial(transcript);
      await this.callbacks.onFinal(transcript, controller.signal);
      this.stopped = true;
    } catch (caught) {
      this.failed = true;
      throw caught;
    } finally {
      if (this.inFlightController === controller) {
        this.inFlightController = null;
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.inFlightController?.abort();
    this.clearBuffer();
  }

  private assertUsable(): void {
    if (this.stopped || this.failed) {
      throw new StreamingSttError(
        "STT_SESSION_NOT_ACTIVE",
        "STT 세션이 활성 상태가 아닙니다.",
        false,
      );
    }
  }

  private assertActive(): void {
    this.assertUsable();
    if (!this.started || this.ending) {
      throw new StreamingSttError(
        "STT_SESSION_NOT_ACTIVE",
        "STT 세션이 활성 상태가 아닙니다.",
        false,
      );
    }
  }

  private report(error: StreamingSttError): StreamingSttError {
    this.failed = true;
    this.clearBuffer();
    error.reported = true;
    try {
      this.callbacks.onError(error);
    } catch {
      // Provider failures remain authoritative even if an observer fails.
    }
    return error;
  }

  private clearBuffer(): void {
    if (this.bufferedBytes > 0) {
      this.releaseBufferBytes(this.bufferedBytes);
    }
    this.chunks.splice(0, this.chunks.length);
    this.bufferedBytes = 0;
  }
}

export class OpenAiCompatibleStreamingSttAdapter implements StreamingSttAdapter {
  readonly providerLabel: string;
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxBufferBytes: number;
  private readonly maxTotalBufferBytes: number;
  private readonly maxChunks: number;
  private readonly fetchImpl: typeof fetch;
  private totalBufferedBytes = 0;

  constructor(config: OpenAiCompatibleSttAdapterConfig) {
    this.endpoint = parseEndpoint(config.endpoint);
    this.apiKey = validatedApiKey(config.apiKey);
    this.model = validatedModel(config.model);
    this.timeoutMs = positiveInteger(
      config.timeoutMs,
      30_000,
      1_000,
      120_000,
      "STT_TIMEOUT_INVALID",
    );
    this.maxBufferBytes = positiveInteger(
      config.maxBufferBytes,
      4_000_000,
      64_000,
      20_000_000,
      "STT_BUFFER_LIMIT_INVALID",
    );
    this.maxTotalBufferBytes = positiveInteger(
      config.maxTotalBufferBytes,
      64_000_000,
      64_000,
      256_000_000,
      "STT_TOTAL_BUFFER_LIMIT_INVALID",
    );
    if (this.maxTotalBufferBytes < this.maxBufferBytes) {
      throw new StreamingSttError(
        "STT_TOTAL_BUFFER_LIMIT_INVALID",
        "전체 STT 버퍼 한도는 세션별 버퍼 한도보다 작을 수 없습니다.",
        false,
      );
    }
    this.maxChunks = positiveInteger(
      config.maxChunks,
      2_048,
      1,
      10_000,
      "STT_CHUNK_LIMIT_INVALID",
    );
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.providerLabel = providerLabel(this.endpoint, this.model);
  }

  createSession(options: {
    locale: "ko-KR";
    mimeType: string;
    callbacks: StreamingSttCallbacks;
  }): StreamingSttSession {
    if (options.locale !== "ko-KR") {
      throw new StreamingSttError(
        "STT_LOCALE_UNSUPPORTED",
        "현재 STT adapter는 ko-KR 인터뷰만 지원합니다.",
        false,
      );
    }
    return new OpenAiCompatibleSttSession(
      this.endpoint,
      this.apiKey,
      this.model,
      this.timeoutMs,
      this.maxBufferBytes,
      this.maxChunks,
      (byteLength) => this.reserveBuffer(byteLength),
      (byteLength) => this.releaseBuffer(byteLength),
      options.mimeType,
      options.callbacks,
      this.fetchImpl,
    );
  }

  private reserveBuffer(byteLength: number): boolean {
    if (this.totalBufferedBytes + byteLength > this.maxTotalBufferBytes) {
      return false;
    }
    this.totalBufferedBytes += byteLength;
    return true;
  }

  private releaseBuffer(byteLength: number): void {
    this.totalBufferedBytes = Math.max(0, this.totalBufferedBytes - byteLength);
  }
}
