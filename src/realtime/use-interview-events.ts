"use client";

import { useEffect, useRef } from "react";

import type {
  LiveConnectionState,
  LiveEventEnvelope,
} from "./live-store";

interface UseInterviewEventsOptions {
  interviewId: string;
  afterSeq: number;
  enabled?: boolean;
  onEvent: (event: LiveEventEnvelope) => void;
  onBatchCommitted: (event: LiveEventEnvelope) => void | Promise<void>;
  onConnectionChange: (state: LiveConnectionState) => void;
  onResyncRequired?: () => Promise<number | void>;
  onError?: (message: string) => void;
}

const DURABLE_EVENT_TYPES = [
  "transcript.finalized",
  "info.status_changed",
  "info.value_changed",
  "coverage.changed",
  "feature.preview_updated",
  "summary.preview_updated",
  "question.generated",
  "conflict.detected",
  "ready_to_complete",
  "evaluation.ready",
  "transcript.corrected",
  "interview.completed",
] as const satisfies readonly LiveEventEnvelope["type"][];

function isDurableEventType(value: unknown): value is LiveEventEnvelope["type"] {
  return (
    typeof value === "string" &&
    (DURABLE_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`LIVE_EVENT_${key.toUpperCase()}_INVALID`);
  }
  return value;
}

function requiredInteger(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`LIVE_EVENT_${key.toUpperCase()}_INVALID`);
  }
  return value as number;
}

export function parseLiveEventEnvelope(raw: string): LiveEventEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("LIVE_EVENT_INVALID_JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("LIVE_EVENT_INVALID");
  }
  const record = value as Record<string, unknown>;
  const data = record.data;
  const snapshotType = record.snapshotType;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    (snapshotType !== "PREVIEW" && snapshotType !== "FINAL") ||
    typeof record.isBatchFinal !== "boolean" ||
    !isDurableEventType(record.type)
  ) {
    throw new Error("LIVE_EVENT_INVALID");
  }

  return {
    eventId: requiredString(record, "eventId"),
    seq: requiredInteger(record, "seq"),
    interviewId: requiredString(record, "interviewId"),
    aggregateVersion: requiredInteger(record, "aggregateVersion"),
    snapshotType,
    occurredAt: requiredString(record, "occurredAt"),
    turnId: requiredString(record, "turnId"),
    batchIndex: requiredInteger(record, "batchIndex"),
    batchSize: requiredInteger(record, "batchSize"),
    isBatchFinal: record.isBatchFinal,
    snapshotUrl: requiredString(record, "snapshotUrl"),
    type: record.type,
    data: data as Record<string, unknown>,
  };
}

export function useInterviewEvents({
  interviewId,
  afterSeq,
  enabled = true,
  onEvent,
  onBatchCommitted,
  onConnectionChange,
  onResyncRequired,
  onError,
}: UseInterviewEventsOptions): void {
  const callbacks = useRef({
    onEvent,
    onBatchCommitted,
    onConnectionChange,
    onResyncRequired,
    onError,
  });

  useEffect(() => {
    callbacks.current = {
      onEvent,
      onBatchCommitted,
      onConnectionChange,
      onResyncRequired,
      onError,
    };
  }, [onBatchCommitted, onConnectionChange, onError, onEvent, onResyncRequired]);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let closed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    let cursor = afterSeq;

    async function recoverFromSnapshot() {
      try {
        const nextCursor = await callbacks.current.onResyncRequired?.();
        if (typeof nextCursor === "number" && Number.isSafeInteger(nextCursor)) {
          cursor = nextCursor;
        }
        retryCount = 0;
      } catch (caught) {
        callbacks.current.onError?.(
          caught instanceof Error ? caught.message : "snapshot 재동기화에 실패했습니다.",
        );
      }
      if (!closed) connect();
    }

    function connect() {
      if (closed) return;
      callbacks.current.onConnectionChange(
        retryCount === 0 ? "CONNECTING" : "RECONNECTING",
      );
      source = new EventSource(
        `/api/interviews/${encodeURIComponent(interviewId)}/events?after=${cursor}`,
        { withCredentials: true },
      );
      source.onopen = () => {
        retryCount = 0;
        callbacks.current.onConnectionChange("OPEN");
      };
      const receive = (message: MessageEvent<string>) => {
        try {
          const event = parseLiveEventEnvelope(message.data);
          if (event.interviewId !== interviewId || event.seq <= cursor) return;
          if (event.seq !== cursor + 1) {
            source?.close();
            source = null;
            callbacks.current.onConnectionChange("RECONNECTING");
            void recoverFromSnapshot();
            return;
          }
          cursor = event.seq;
          callbacks.current.onEvent(event);
          if (event.isBatchFinal) {
            void callbacks.current.onBatchCommitted(event);
          }
        } catch (error) {
          callbacks.current.onError?.(
            error instanceof Error ? error.message : "실시간 이벤트가 올바르지 않습니다.",
          );
        }
      };
      source.onmessage = receive;
      for (const eventType of DURABLE_EVENT_TYPES) {
        source.addEventListener(eventType, receive as EventListener);
      }
      source.addEventListener("stream.error", ((message: MessageEvent<string>) => {
        callbacks.current.onError?.(`SSE_REPLAY_FAILED: ${message.data}`);
        source?.close();
        source = null;
        callbacks.current.onConnectionChange("RECONNECTING");
        void recoverFromSnapshot();
      }) as EventListener);
      source.onerror = () => {
        source?.close();
        source = null;
        if (closed) return;
        callbacks.current.onConnectionChange("RECONNECTING");
        retryCount += 1;
        if (retryCount >= 3 && callbacks.current.onResyncRequired) {
          retryTimer = setTimeout(() => void recoverFromSnapshot(), 250);
        } else {
          const delay = Math.min(10_000, 500 * 2 ** Math.min(retryCount, 5));
          retryTimer = setTimeout(connect, delay);
        }
      };
    }

    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
      callbacks.current.onConnectionChange("CLOSED");
    };
  }, [afterSeq, enabled, interviewId]);
}
