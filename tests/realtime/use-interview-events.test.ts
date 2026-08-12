import { describe, expect, it } from "vitest";

import { parseLiveEventEnvelope } from "../../src/realtime/use-interview-events";

describe("live event envelope parser", () => {
  it("accepts the durable batch contract", () => {
    const event = parseLiveEventEnvelope(
      JSON.stringify({
        eventId: "42",
        seq: 42,
        interviewId: "interview-1",
        aggregateVersion: 7,
        snapshotType: "PREVIEW",
        occurredAt: "2026-08-10T00:00:00.000Z",
        turnId: "turn-7",
        batchIndex: 3,
        batchSize: 3,
        isBatchFinal: true,
        snapshotUrl: "/api/interviews/interview-1",
        type: "transcript.finalized",
        data: {},
      }),
    );
    expect(event.seq).toBe(42);
    expect(event.isBatchFinal).toBe(true);
  });

  it("accepts a durable transcript correction event", () => {
    const event = parseLiveEventEnvelope(
      JSON.stringify({
        eventId: "43",
        seq: 43,
        interviewId: "interview-1",
        aggregateVersion: 8,
        snapshotType: "PREVIEW",
        occurredAt: "2026-08-10T00:01:00.000Z",
        turnId: "correction-1",
        batchIndex: 0,
        batchSize: 1,
        isBatchFinal: true,
        snapshotUrl: "/api/interviews/interview-1",
        type: "transcript.corrected",
        data: { segmentId: "segment-1", revision: 2 },
      }),
    );
    expect(event.type).toBe("transcript.corrected");
    expect(event.isBatchFinal).toBe(true);
  });

  it("fails closed for malformed sequence metadata", () => {
    expect(() =>
      parseLiveEventEnvelope(
        JSON.stringify({ seq: -1, snapshotType: "PREVIEW", data: {} }),
      ),
    ).toThrow();
  });

  it("rejects event types that are not in the durable runtime contract", () => {
    expect(() =>
      parseLiveEventEnvelope(
        JSON.stringify({
          eventId: "44",
          seq: 44,
          interviewId: "interview-1",
          aggregateVersion: 9,
          snapshotType: "PREVIEW",
          occurredAt: "2026-08-10T00:02:00.000Z",
          turnId: "turn-9",
          batchIndex: 0,
          batchSize: 1,
          isBatchFinal: true,
          snapshotUrl: "/api/interviews/interview-1",
          type: "turn.committed",
          data: {},
        }),
      ),
    ).toThrow("LIVE_EVENT_INVALID");
  });
});
