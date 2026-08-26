import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfiguredStreamingSttAdapter } from "../../src/realtime/server/configured-stt-adapter";
import { UnavailableStreamingSttAdapter } from "../../src/realtime/server/unavailable-stt-adapter";
import {
  MAX_PARTIAL_TRANSCRIPTS_PER_TURN,
  OpenAiCompatibleStreamingSttAdapter,
  safeAudioFileDescriptor,
} from "../../src/realtime/server/openai-compatible-stt-adapter";
import {
  StreamingSttError,
  type StreamingSttCallbacks,
} from "../../src/realtime/server/stt-adapter";

function callbacks(events: string[] = []): StreamingSttCallbacks {
  return {
    onSpeechStarted: () => events.push("started"),
    onSpeechStopped: () => events.push("stopped"),
    onPartial: (text) => events.push(`partial:${text}`),
    onFinal: async (text) => {
      events.push(`final:${text}`);
    },
    onError: (error) => events.push(
      `error:${error instanceof StreamingSttError ? error.code : error.message}`,
    ),
  };
}

function adapterWith(fetchImpl: typeof fetch, overrides: {
  timeoutMs?: number;
  maxBufferBytes?: number;
  maxTotalBufferBytes?: number;
  maxChunks?: number;
} = {}): OpenAiCompatibleStreamingSttAdapter {
  return new OpenAiCompatibleStreamingSttAdapter({
    endpoint: "https://speech.example.test/v1/audio/transcriptions",
    apiKey: "test-api-key",
    model: "gpt-4o-mini-transcribe",
    timeoutMs: overrides.timeoutMs ?? 5_000,
    maxBufferBytes: overrides.maxBufferBytes ?? 64_000,
    maxTotalBufferBytes: overrides.maxTotalBufferBytes ?? 64_000_000,
    maxChunks: overrides.maxChunks ?? 20,
    fetchImpl,
  });
}

describe("configured streaming STT provider", () => {
  it("keeps development in explicit text fallback until a real STT provider is configured", () => {
    const adapter = createConfiguredStreamingSttAdapter({
      development: true,
      environment: {},
    });
    expect(adapter).toBeInstanceOf(UnavailableStreamingSttAdapter);
    expect(adapter.providerLabel).toContain("임의 전사 사용 안 함");
  });

  it("fails startup closed for an unsupported provider, missing provider, or missing key", () => {
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: {},
    })).toThrow("DONGHAENG_STT_PROVIDER=openai-compatible");
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: { DONGHAENG_STT_PROVIDER: "mock" },
    })).toThrow("openai-compatible");
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: { DONGHAENG_STT_PROVIDER: "openai-compatible" },
    })).toThrow("API_KEY");
  });

  it("rejects a production NODE_ENV combined with the development flag", () => {
    expect(() => createConfiguredStreamingSttAdapter({
      development: true,
      nodeEnvironment: "production",
      environment: { DONGHAENG_STT_PROVIDER: "mock" },
    })).toThrow("NODE_ENV=production");
  });

  it("requires HTTPS in production and preserves the selected model in its label", () => {
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: {
        DONGHAENG_STT_PROVIDER: "openai-compatible",
        DONGHAENG_STT_API_KEY: "secret",
        DONGHAENG_STT_ENDPOINT: "http://speech.example.test/v1/audio/transcriptions",
      },
    })).toThrow("HTTPS");

    const adapter = createConfiguredStreamingSttAdapter({
      development: false,
      environment: {
        DONGHAENG_STT_PROVIDER: "openai-compatible",
        DONGHAENG_STT_API_KEY: "secret",
        DONGHAENG_STT_MODEL: "gpt-4o-transcribe",
      },
      fetchImpl: vi.fn<typeof fetch>(),
    });
    expect(adapter.providerLabel).toContain("gpt-4o-transcribe");
    expect(adapter.providerLabel).toContain("api.openai.com");
  });

  it("allows production HTTP only for the exact E2E flag and a loopback endpoint", () => {
    const baseEnvironment = {
      DONGHAENG_STT_PROVIDER: "openai-compatible",
      DONGHAENG_STT_API_KEY: "e2e-only-key",
    };
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: {
        ...baseEnvironment,
        DONGHAENG_STT_ENDPOINT: "http://127.0.0.1:43123/v1/audio/transcriptions",
      },
    })).toThrow("HTTPS");
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: {
        ...baseEnvironment,
        DONGHAENG_E2E_STT_ALLOW_HTTP_LOOPBACK: "true",
        DONGHAENG_STT_ENDPOINT: "http://localhost:43123/v1/audio/transcriptions",
      },
    })).toThrow("HTTPS");
    expect(() => createConfiguredStreamingSttAdapter({
      development: false,
      environment: {
        ...baseEnvironment,
        DONGHAENG_E2E_STT_ALLOW_HTTP_LOOPBACK: "1",
        DONGHAENG_STT_ENDPOINT: "http://speech.example.test/v1/audio/transcriptions",
      },
    })).toThrow("HTTPS");

    const adapter = createConfiguredStreamingSttAdapter({
      development: false,
      environment: {
        ...baseEnvironment,
        DONGHAENG_E2E_STT_ALLOW_HTTP_LOOPBACK: "1",
        DONGHAENG_STT_ENDPOINT: "http://127.0.0.1:43123/v1/audio/transcriptions",
      },
      fetchImpl: vi.fn<typeof fetch>(),
    });
    expect(adapter.providerLabel).toContain("127.0.0.1");
  });
});

describe("OpenAI-compatible multipart STT adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffers resumed audio, excludes paused chunks, and submits a safe Korean multipart request", async () => {
    let capturedInit: RequestInit | undefined;
    let capturedUrl = "";
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        text: "  최근 한 달 단골 매출은 45%입니다.  ",
        usage: { type: "duration", seconds: 3.2 },
      }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    });
    const events: string[] = [];
    const adapter = adapterWith(fetchImpl);
    const session = adapter.createSession({
      locale: "ko-KR",
      mimeType: "audio/webm;codecs=opus",
      callbacks: callbacks(events),
    });

    await session.start();
    await session.pushAudio(new Uint8Array([1, 2]), 1);
    await session.pause();
    await session.pushAudio(new Uint8Array([99]), 2);
    await session.resume();
    await session.pushAudio(new Uint8Array([3, 4]), 3);
    await session.endTurn();

    expect(capturedUrl).toBe("https://speech.example.test/v1/audio/transcriptions");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-api-key");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.has("content-type")).toBe(false);
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.redirect).toBe("error");
    const form = capturedInit?.body as FormData;
    expect(form.get("model")).toBe("gpt-4o-mini-transcribe");
    expect(form.get("language")).toBe("ko");
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("interview-audio.webm");
    expect(file.type).toBe("audio/webm");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(session.providerLabel).toContain("gpt-4o-mini-transcribe");
    expect(events).toEqual([
      "started",
      "stopped",
      "partial:최근 한 달 단골 매출은 45%입니다.",
      "final:최근 한 달 단골 매출은 45%입니다.",
    ]);
  });

  it("emits a rolling caption before endTurn while keeping the final transcript authoritative", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      return (
      new Response(JSON.stringify({
        text: requestCount === 1
          ? "말씀하시는 중입니다"
          : "최근 매출은 이천만 원입니다.",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
      );
    });
    const session = adapterWith(fetchImpl).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm;codecs=opus",
      callbacks: callbacks(events),
    });

    await session.start();
    for (let audioSeq = 1; audioSeq <= 4; audioSeq += 1) {
      await vi.advanceTimersByTimeAsync(400);
      await session.pushAudio(new Uint8Array([audioSeq]), audioSeq);
    }
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(events).toContain("partial:말씀하시는 중입니다");
    expect(events).not.toContain("stopped");

    await session.endTurn();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toBe("final:최근 매출은 이천만 원입니다.");
  });

  it("bounds whole-turn preview decodes so concurrent final turns retain priority", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      return new Response(JSON.stringify({ text: `중간 자막 ${requestCount}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const session = adapterWith(fetchImpl, { maxChunks: 40 }).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm;codecs=opus",
      callbacks: callbacks(),
    });

    await session.start();
    for (let audioSeq = 1; audioSeq <= 24; audioSeq += 1) {
      await vi.advanceTimersByTimeAsync(400);
      await session.pushAudio(new Uint8Array([audioSeq]), audioSeq);
      await vi.advanceTimersByTimeAsync(0);
    }

    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PARTIAL_TRANSCRIPTS_PER_TURN);
    await session.endTurn();
    expect(fetchImpl).toHaveBeenCalledTimes(MAX_PARTIAL_TRANSCRIPTS_PER_TURN + 1);
  });

  it("aborts a pending preview before starting the authoritative final request", async () => {
    vi.useFakeTimers();
    const requestOrder: string[] = [];
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      requestCount += 1;
      if (requestCount === 1) {
        requestOrder.push("partial-started");
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            requestOrder.push("partial-aborted");
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        });
      }
      requestOrder.push("final-started");
      return new Response(JSON.stringify({ text: "최종 답변입니다." }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const events: string[] = [];
    const session = adapterWith(fetchImpl).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm;codecs=opus",
      callbacks: callbacks(events),
    });

    await session.start();
    for (let audioSeq = 1; audioSeq <= 4; audioSeq += 1) {
      await vi.advanceTimersByTimeAsync(400);
      await session.pushAudio(new Uint8Array([audioSeq]), audioSeq);
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(requestOrder).toEqual(["partial-started"]);

    await session.endTurn();

    expect(requestOrder).toEqual([
      "partial-started",
      "partial-aborted",
      "final-started",
    ]);
    expect(events.at(-1)).toBe("final:최종 답변입니다.");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("isolates a rolling-caption provider failure from final transcription", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      requestCount += 1;
      return requestCount === 1
        ? new Response("preview failed", {
            status: 503,
            headers: { "content-type": "text/plain" },
          })
        : new Response(JSON.stringify({ text: "실제 최종 답변" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
    });
    const events: string[] = [];
    const session = adapterWith(fetchImpl).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm;codecs=opus",
      callbacks: callbacks(events),
    });

    await session.start();
    for (let audioSeq = 1; audioSeq <= 4; audioSeq += 1) {
      await vi.advanceTimersByTimeAsync(400);
      await session.pushAudio(new Uint8Array([audioSeq]), audioSeq);
    }
    await vi.advanceTimersByTimeAsync(0);
    await session.endTurn();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.startsWith("error:"))).toBe(false);
    expect(events.at(-1)).toBe("final:실제 최종 답변");
  });

  it("fails closed when the bounded chunk count is exceeded", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const events: string[] = [];
    const session = adapterWith(fetchImpl, { maxChunks: 1 }).createSession({
      locale: "ko-KR",
      mimeType: "audio/mp4;codecs=mp4a.40.2",
      callbacks: callbacks(events),
    });
    await session.start();
    await session.pushAudio(new Uint8Array([1]), 1);
    await expect(session.pushAudio(new Uint8Array([2]), 2)).rejects.toMatchObject({
      code: "STT_BUFFER_LIMIT_EXCEEDED",
      retryable: false,
      reported: true,
    });
    expect(events).toContain("error:STT_BUFFER_LIMIT_EXCEEDED");
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(session.endTurn()).rejects.toMatchObject({
      code: "STT_SESSION_NOT_ACTIVE",
    });
  });

  it("fails closed before buffered audio exceeds the byte ceiling", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const events: string[] = [];
    const session = adapterWith(fetchImpl, { maxBufferBytes: 64_000 }).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: callbacks(events),
    });
    await session.start();
    await session.pushAudio(new Uint8Array(64_000), 1);
    await expect(session.pushAudio(new Uint8Array([1]), 2)).rejects.toMatchObject({
      code: "STT_BUFFER_LIMIT_EXCEEDED",
      reported: true,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces and releases the adapter-wide audio buffer budget", async () => {
    const adapter = adapterWith(vi.fn<typeof fetch>(), {
      maxBufferBytes: 64_000,
      maxTotalBufferBytes: 64_000,
    });
    const createSession = () => adapter.createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: callbacks(),
    });
    const first = createSession();
    const second = createSession();
    await first.start();
    await second.start();
    await first.pushAudio(new Uint8Array(40_000), 1);
    await expect(
      second.pushAudio(new Uint8Array(30_001), 1),
    ).rejects.toMatchObject({
      code: "STT_BUFFER_LIMIT_EXCEEDED",
      retryable: true,
    });

    await first.stop();
    const afterRelease = createSession();
    await afterRelease.start();
    await expect(
      afterRelease.pushAudio(new Uint8Array(64_000), 1),
    ).resolves.toBeUndefined();
    await afterRelease.stop();
  });

  it.each([
    {
      name: "non-json content type",
      response: new Response('{"text":"전사"}', {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    },
    {
      name: "json prefix content type",
      response: new Response('{"text":"전사"}', {
        status: 200,
        headers: { "content-type": "application/jsonp" },
      }),
    },
    {
      name: "missing text",
      response: new Response('{"usage":{}}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    },
    {
      name: "empty text",
      response: new Response('{"text":"   "}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    },
    {
      name: "malformed json",
      response: new Response('{', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    },
  ])("rejects a strict provider response: $name", async ({ response }) => {
    const events: string[] = [];
    const session = adapterWith(vi.fn<typeof fetch>(async () => response)).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: callbacks(events),
    });
    await session.start();
    await session.pushAudio(new Uint8Array([1]), 1);
    await expect(session.endTurn()).rejects.toMatchObject({
      code: "STT_PROVIDER_RESPONSE_INVALID",
      retryable: false,
      reported: true,
    });
    expect(events).toContain("error:STT_PROVIDER_RESPONSE_INVALID");
  });

  it("aborts a provider call at the configured timeout", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const session = adapterWith(fetchImpl, { timeoutMs: 1_000 }).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: callbacks(events),
    });
    await session.start();
    await session.pushAudio(new Uint8Array([1]), 1);
    const ending = expect(session.endTurn()).rejects.toMatchObject({
      code: "STT_PROVIDER_TIMEOUT",
      retryable: true,
      reported: true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await ending;
    expect(events).toContain("error:STT_PROVIDER_TIMEOUT");
  });

  it("keeps a stop signal alive through final persistence", async () => {
    let notifyFinalStarted: (() => void) | undefined;
    const finalStarted = new Promise<void>((resolve) => {
      notifyFinalStarted = resolve;
    });
    let persistenceSignal: AbortSignal | undefined;
    const sessionCallbacks = callbacks();
    sessionCallbacks.onFinal = async (_text, signal) => {
      persistenceSignal = signal;
      notifyFinalStarted?.();
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    };
    const session = adapterWith(vi.fn<typeof fetch>(async () =>
      new Response('{"text":"전사 완료"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: sessionCallbacks,
    });
    await session.start();
    await session.pushAudio(new Uint8Array([1]), 1);
    const ending = session.endTurn();
    const rejected = expect(ending).rejects.toMatchObject({ name: "AbortError" });
    await finalStarted;
    await session.stop();
    await rejected;
    expect(persistenceSignal?.aborted).toBe(true);
  });

  it("marks throttling and provider outages retryable without trusting an error body", async () => {
    const events: string[] = [];
    const session = adapterWith(vi.fn<typeof fetch>(async () =>
      new Response('{"text":"이 값은 오류 응답이라 사용하면 안 됩니다."}', {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    )).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: callbacks(events),
    });
    await session.start();
    await session.pushAudio(new Uint8Array([1]), 1);
    await expect(session.endTurn()).rejects.toMatchObject({
      code: "STT_PROVIDER_HTTP_ERROR",
      retryable: true,
      reported: true,
    });
    expect(events).toContain("error:STT_PROVIDER_HTTP_ERROR");
    expect(events.some((event) => event.includes("사용하면 안 됩니다"))).toBe(false);
  });

  it("bounds a chunked response even when content-length is absent", async () => {
    const events: string[] = [];
    const oversizedResponse = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(1_000_001)));
        controller.close();
      },
    });
    const session = adapterWith(vi.fn<typeof fetch>(async () =>
      new Response(oversizedResponse, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )).createSession({
      locale: "ko-KR",
      mimeType: "audio/webm",
      callbacks: callbacks(events),
    });
    await session.start();
    await session.pushAudio(new Uint8Array([1]), 1);
    await expect(session.endTurn()).rejects.toMatchObject({
      code: "STT_PROVIDER_RESPONSE_INVALID",
      reported: true,
    });
    expect(events).toContain("error:STT_PROVIDER_RESPONSE_INVALID");
  });

  it("does not trust MIME parameters or use them as a filename", () => {
    expect(safeAudioFileDescriptor("audio/mp4;codecs=mp4a.40.2")).toEqual({
      extension: "m4a",
      mimeType: "audio/mp4",
    });
    expect(() => safeAudioFileDescriptor("video/webm")).toThrow(
      "지원하지 않는 오디오 형식",
    );
    expect(() => safeAudioFileDescriptor("audio/webm\r\nX-Evil: true")).toThrow(
      "지원하지 않는 오디오 형식",
    );
  });
});
