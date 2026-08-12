import { StreamingSttError } from "./stt-adapter";

export interface BoundedJsonFetchResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export interface BoundedJsonFetchOptions {
  input: string | URL;
  init?: RequestInit;
  externalSignal?: AbortSignal;
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImpl?: typeof fetch;
}

async function boundedResponseText(
  response: Response,
  maxResponseBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxResponseBytes) {
        await reader.cancel();
        throw new StreamingSttError(
          "STT_INTERNAL_API_RESPONSE_INVALID",
          "내부 API 응답이 허용 크기를 초과했습니다.",
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
        "STT_INTERNAL_API_RESPONSE_INVALID",
        "내부 API 응답이 UTF-8 형식이 아닙니다.",
        false,
      );
    }
  } catch (caught) {
    if (caught instanceof StreamingSttError) throw caught;
    throw caught;
  } finally {
    reader.releaseLock();
  }
}

export async function fetchBoundedJson(
  options: BoundedJsonFetchOptions,
): Promise<BoundedJsonFetchResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new StreamingSttError(
      "STT_INTERNAL_API_CONFIGURATION_INVALID",
      "내부 API timeout 설정이 올바르지 않습니다.",
      false,
    );
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new StreamingSttError(
      "STT_INTERNAL_API_CONFIGURATION_INVALID",
      "내부 API 응답 크기 설정이 올바르지 않습니다.",
      false,
    );
  }

  const controller = new AbortController();
  let timedOut = false;
  let externallyAborted = false;
  const abortFromExternal = () => {
    externallyAborted = true;
    controller.abort(options.externalSignal?.reason);
  };
  if (options.externalSignal?.aborted) abortFromExternal();
  else options.externalSignal?.addEventListener("abort", abortFromExternal, {
    once: true,
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await (options.fetchImpl ?? fetch)(options.input, {
      ...options.init,
      signal: controller.signal,
    });
    const rawContentLength = response.headers.get("content-length");
    if (rawContentLength !== null) {
      const declaredLength = Number(rawContentLength);
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength < 0 ||
        declaredLength > maxResponseBytes
      ) {
        void response.body?.cancel().catch(() => undefined);
        throw new StreamingSttError(
          "STT_INTERNAL_API_RESPONSE_INVALID",
          "내부 API 응답 크기가 올바르지 않습니다.",
          false,
        );
      }
    }
    const responseText = await boundedResponseText(response, maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new StreamingSttError(
        "STT_INTERNAL_API_RESPONSE_INVALID",
        "내부 API가 올바른 JSON 응답을 반환하지 않았습니다.",
        false,
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new StreamingSttError(
        "STT_INTERNAL_API_RESPONSE_INVALID",
        "내부 API 응답 형식이 올바르지 않습니다.",
        false,
      );
    }
    return {
      ok: response.ok,
      status: response.status,
      body: parsed as Record<string, unknown>,
    };
  } catch (caught) {
    if (caught instanceof StreamingSttError) throw caught;
    if (timedOut) {
      throw new StreamingSttError(
        "STT_INTERNAL_API_TIMEOUT",
        "음성 전사는 완료됐지만 답변을 저장하는 데 시간이 더 필요합니다. 잠시 후 상태를 다시 확인해 주세요.",
        true,
      );
    }
    if (externallyAborted) {
      throw new StreamingSttError(
        "STT_SESSION_STOPPED",
        "중지된 STT 세션의 전사는 저장하지 않습니다.",
        false,
      );
    }
    throw new StreamingSttError(
      "STT_INTERNAL_API_ERROR",
      "음성 전사 내부 API에 연결하지 못했습니다.",
      true,
    );
  } finally {
    clearTimeout(timeout);
    options.externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}
