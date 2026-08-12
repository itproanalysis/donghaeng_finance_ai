import { describe, expect, it } from "vitest";

import type { LiveInterviewSnapshot } from "../../src/domain";
import {
  INITIAL_INTERVIEW_LIVE_STATE,
  interviewLiveReducer,
  type LiveEventEnvelope,
} from "../../src/realtime/live-store";

function snapshot(version: number): LiveInterviewSnapshot {
  return {
    session: {
      id: "interview-1",
      lifecycleStatus: "ACTIVE",
      snapshotType: "PREVIEW",
      version,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      completedAt: null,
    },
    borrower: { id: "borrower-1", name: "테스트" },
    business: {
      id: "business-1",
      borrowerId: "borrower-1",
      businessName: "테스트 상점",
      industry: "카페",
    },
    informationItems: [],
    transcript: [],
    evidence: [],
    coverage: {
      snapshotType: "PREVIEW",
      totalRequired: 0,
      resolvedRequired: 0,
      evaluableRequired: 0,
      statusConfirmationRate: 0,
      evaluableValueRate: 0,
      requiredInformationRate: 0,
      overallRate: 0,
      unresolvedP0: 0,
      byCategory: {
        CURRENT_STATE: { total: 0, resolved: 0, evaluable: 0, confirmationRate: 0, evaluableRate: 0 },
        IMPROVEMENT_INTENT: { total: 0, resolved: 0, evaluable: 0, confirmationRate: 0, evaluableRate: 0 },
        FUTURE_OUTLOOK: { total: 0, resolved: 0, evaluable: 0, confirmationRate: 0, evaluableRate: 0 },
        HOUSEHOLD_STATE: { total: 0, resolved: 0, evaluable: 0, confirmationRate: 0, evaluableRate: 0 },
      },
    },
    nextQuestion: null,
  };
}

function event(
  seq: number,
  aggregateVersion: number,
  overrides: Partial<LiveEventEnvelope> = {},
): LiveEventEnvelope {
  return {
    eventId: String(seq),
    seq,
    interviewId: "interview-1",
    aggregateVersion,
    snapshotType: "PREVIEW",
    occurredAt: "2026-08-10T00:00:00.000Z",
    turnId: "turn-1",
    batchIndex: 1,
    batchSize: 1,
    isBatchFinal: true,
    snapshotUrl: "/api/interviews/interview-1",
    type: "coverage.changed",
    data: {},
    ...overrides,
  };
}

describe("interview live reducer", () => {
  it("ignores duplicate events and requests an authoritative refresh for newer versions", () => {
    const hydrated = interviewLiveReducer(INITIAL_INTERVIEW_LIVE_STATE, {
      type: "snapshot.hydrated",
      snapshot: snapshot(2),
      lastEventSeq: 4,
    });
    const duplicate = interviewLiveReducer(hydrated, {
      type: "server.event_received",
      event: event(4, 2),
    });
    expect(duplicate).toBe(hydrated);

    const next = interviewLiveReducer(duplicate, {
      type: "server.event_received",
      event: event(5, 3),
    });
    expect(next.needsResync).toBe(true);
    expect(next.lastEventSeq).toBe(5);
    expect(next).toMatchObject({
      lastObservedEventType: "coverage.changed",
      lastObservedEventAt: "2026-08-10T00:00:00.000Z",
      currentBatchIndex: 1,
      currentBatchSize: 1,
      currentBatchFinal: true,
      batchPending: true,
    });
  });

  it("detects sequence gaps instead of applying out-of-order deltas", () => {
    const hydrated = interviewLiveReducer(INITIAL_INTERVIEW_LIVE_STATE, {
      type: "snapshot.hydrated",
      snapshot: snapshot(2),
      lastEventSeq: 4,
    });
    const gap = interviewLiveReducer(hydrated, {
      type: "server.event_received",
      event: event(7, 3),
    });
    expect(gap.needsResync).toBe(true);
    expect(gap.lastObservedEventType).toBe("coverage.changed");
    expect(gap.batchPending).toBe(true);
  });

  it("tracks the latest accepted batch event without letting duplicates overwrite it", () => {
    const hydrated = interviewLiveReducer(INITIAL_INTERVIEW_LIVE_STATE, {
      type: "snapshot.hydrated",
      snapshot: snapshot(2),
      lastEventSeq: 4,
    });
    const observed = interviewLiveReducer(hydrated, {
      type: "server.event_received",
      event: event(5, 3, {
        type: "feature.preview_updated",
        occurredAt: "2026-08-10T00:00:05.000Z",
        batchIndex: 3,
        batchSize: 7,
        isBatchFinal: false,
      }),
    });

    expect(observed).toMatchObject({
      lastObservedEventType: "feature.preview_updated",
      lastObservedEventAt: "2026-08-10T00:00:05.000Z",
      currentBatchIndex: 3,
      currentBatchSize: 7,
      currentBatchFinal: false,
      batchPending: true,
    });

    const duplicate = interviewLiveReducer(observed, {
      type: "server.event_received",
      event: event(5, 3, {
        type: "summary.preview_updated",
        occurredAt: "2026-08-10T00:00:06.000Z",
        batchIndex: 4,
        batchSize: 7,
      }),
    });
    expect(duplicate).toBe(observed);
  });

  it("clears pending batch state after an authoritative resync while retaining observation metadata", () => {
    const observed = interviewLiveReducer(
      interviewLiveReducer(INITIAL_INTERVIEW_LIVE_STATE, {
        type: "snapshot.hydrated",
        snapshot: snapshot(2),
        lastEventSeq: 4,
      }),
      {
        type: "server.event_received",
        event: event(5, 3, {
          type: "question.generated",
          occurredAt: "2026-08-10T00:00:05.000Z",
          batchIndex: 7,
          batchSize: 7,
          isBatchFinal: true,
        }),
      },
    );

    const resynced = interviewLiveReducer(observed, {
      type: "resync.completed",
      snapshot: snapshot(3),
      lastEventSeq: 5,
    });
    expect(resynced).toMatchObject({
      lastObservedEventType: "question.generated",
      lastObservedEventAt: "2026-08-10T00:00:05.000Z",
      currentBatchIndex: 7,
      currentBatchSize: 7,
      currentBatchFinal: true,
      batchPending: false,
      needsResync: false,
    });
  });
});
