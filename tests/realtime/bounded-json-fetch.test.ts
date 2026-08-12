import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchBoundedJson } from "../../src/realtime/server/bounded-json-fetch";

describe("bounded internal JSON fetch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aborts the entire response read at the timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const pending = fetchBoundedJson({
      input: "http://127.0.0.1/internal",
      timeoutMs: 1_000,
      fetchImpl,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: "STT_INTERNAL_API_TIMEOUT",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejected;
  });

  it("propagates an external stop signal and prevents a late result", async () => {
    const externalController = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      }),
    );
    const pending = fetchBoundedJson({
      input: "http://127.0.0.1/internal",
      externalSignal: externalController.signal,
      fetchImpl,
    });
    const rejected = expect(pending).rejects.toMatchObject({
      code: "STT_SESSION_STOPPED",
      retryable: false,
    });
    externalController.abort();
    await rejected;
  });

  it("rejects a chunked JSON body above the byte ceiling", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"data":"123456789"}'));
        controller.close();
      },
    });
    await expect(fetchBoundedJson({
      input: "http://127.0.0.1/internal",
      maxResponseBytes: 10,
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(body, {
        headers: { "content-type": "application/json" },
      })),
    })).rejects.toMatchObject({
      code: "STT_INTERNAL_API_RESPONSE_INVALID",
      retryable: false,
    });
  });

  it("returns only a bounded JSON object response", async () => {
    await expect(fetchBoundedJson({
      input: "http://127.0.0.1/internal",
      fetchImpl: vi.fn<typeof fetch>(async () => new Response(
        JSON.stringify({ data: { version: 3 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      )),
    })).resolves.toEqual({
      ok: true,
      status: 200,
      body: { data: { version: 3 } },
    });
  });
});
