import { apiFailure, requestIdFor } from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { outboxEventBroker } from "@/server/outbox-broker";
import { getAuthService, getInterviewService } from "@/server/service-instance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const encoder = new TextEncoder();

function parseSequence(value: string | null, field: string): number | null {
  if (value === null || value === "") return null;
  if (!/^\d+$/.test(value)) {
    throw new ApplicationError(400, "INVALID_EVENT_SEQUENCE", `${field}는 0 이상의 정수여야 합니다.`, {
      field,
    });
  }
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new ApplicationError(400, "INVALID_EVENT_SEQUENCE", `${field}는 0 이상의 정수여야 합니다.`, {
      field,
    });
  }
  return sequence;
}

function requestedSequence(request: Request): number {
  const url = new URL(request.url);
  const fromHeader = parseSequence(request.headers.get("last-event-id"), "Last-Event-ID");
  const fromQuery = parseSequence(url.searchParams.get("after"), "after");
  if (fromHeader !== null && fromQuery !== null && fromHeader !== fromQuery) {
    throw new ApplicationError(
      400,
      "EVENT_SEQUENCE_MISMATCH",
      "Last-Event-ID와 after 값이 서로 다릅니다.",
      { lastEventId: fromHeader, after: fromQuery },
    );
  }
  return fromHeader ?? fromQuery ?? 0;
}

export async function GET(request: Request, { params }: RouteContext) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    const { id } = await params;
    const initialAfter = requestedSequence(request);
    const service = getInterviewService();
    const bounds = service.getRealtimeReplayBounds(principal, id);
    if (initialAfter > bounds.lastEventSeq) {
      throw new ApplicationError(
        400,
        "EVENT_SEQUENCE_AHEAD",
        "요청한 이벤트 sequence가 현재 stream보다 앞서 있습니다.",
        { requestedAfter: initialAfter, lastEventSeq: bounds.lastEventSeq },
      );
    }
    if (
      bounds.minimumAvailable !== null &&
      initialAfter < bounds.minimumAvailable - 1 &&
      initialAfter < bounds.lastEventSeq
    ) {
      throw new ApplicationError(
        409,
        "EVENT_REPLAY_GAP",
        "요청한 이벤트가 replay 보존기간을 벗어났습니다. 최신 snapshot으로 재동기화하세요.",
        {
          requestedAfter: initialAfter,
          minimumAvailable: bounds.minimumAvailable,
          lastEventSeq: bounds.lastEventSeq,
          snapshotUrl: `/api/interviews/${encodeURIComponent(id)}`,
        },
      );
    }

    let cursor = initialAfter;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let removeAbortListener: (() => void) | null = null;
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

    const close = () => {
      if (closed) return;
      closed = true;
      outboxEventBroker.off(`interview:${id}`, flush);
      if (pollTimer) clearInterval(pollTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      removeAbortListener?.();
      try {
        controllerRef?.close();
      } catch {
        // The client may already have cancelled the stream.
      }
    };
    const hasCapacity = () => {
      const desiredSize = controllerRef?.desiredSize;
      return desiredSize === null || desiredSize === undefined || desiredSize > 0;
    };
    const enqueue = (chunk: string): boolean => {
      if (closed || !controllerRef || !hasCapacity()) return false;
      try {
        controllerRef.enqueue(encoder.encode(chunk));
        return true;
      } catch {
        close();
        return false;
      }
    };
    const flush = () => {
      if (closed || !hasCapacity()) return;
      try {
        const currentPrincipal = getAuthService().authenticate(request);
        if (
          currentPrincipal.tenantId !== principal.tenantId ||
          currentPrincipal.userId !== principal.userId
        ) {
          throw new ApplicationError(
            401,
            "SSE_PRINCIPAL_CHANGED",
            "SSE 연결의 인증 주체가 변경되었습니다.",
          );
        }
        const events = service.getRealtimeEvents(principal, id, cursor);
        if (events.length === 0) return;

        // One replay query is emitted as one stream chunk. The repository query is
        // bounded, while the stream queue is kept at a single chunk by hasCapacity().
        // This preserves backpressure without truncating replays above 64 events.
        const batch = events
          .map(
            (event) =>
              `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join("");
        if (enqueue(batch)) cursor = events.at(-1)?.seq ?? cursor;
      } catch (error) {
        enqueue(
          `event: stream.error\ndata: ${JSON.stringify({
            code:
              error instanceof ApplicationError
                ? error.code
                : "SSE_REPLAY_FAILED",
            requestId,
            snapshotUrl: `/api/interviews/${encodeURIComponent(id)}`,
          })}\n\n`,
        );
        close();
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        enqueue("retry: 3000\n\n");
        outboxEventBroker.on(`interview:${id}`, flush);
        pollTimer = setInterval(flush, 5000);
        heartbeatTimer = setInterval(() => enqueue(`: heartbeat ${Date.now()}\n\n`), 15_000);
        const abort = () => close();
        request.signal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => request.signal.removeEventListener("abort", abort);
      },
      pull() {
        flush();
      },
      cancel() {
        closed = true;
        outboxEventBroker.off(`interview:${id}`, flush);
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        removeAbortListener?.();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-ID": requestId,
        Vary: "Cookie, Authorization, Last-Event-ID",
      },
    });
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
