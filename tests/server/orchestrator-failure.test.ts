import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("orchestrator failure boundary", () => {
  it("durably preserves the FINAL transcript and idempotent receipt for reprocessing", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `orchestrator-failure-${++id}`,
      turnPlanner: {
        plan: () => {
          throw new Error("synthetic provider timeout");
        },
      },
    });
    const created = service.createInterview(principal);
    const command = {
      text: "월평균 매출은 2,300만원입니다",
      clientMessageId: "planner-failure-message",
      expectedVersion: created.session.version,
      currentQuestionInfoCode: "monthly_average_sales",
    };

    const failed = service.addMessageCommand(
      created.session.id,
      command,
      principal,
    );
    expect(failed.processing).toEqual({
      status: "RETRYABLE_FAILURE",
      code: "TURN_PROCESSING_FAILED",
    });
    expect(failed.acceptedTranscript).toMatchObject({
      speaker: "BORROWER",
      confirmation: "FINAL",
      text: command.text,
    });
    expect(failed.evidenceAdded).toEqual([]);
    expect(failed.snapshot.nextQuestion?.infoCode).toBe("monthly_average_sales");
    expect(
      service
        .getRealtimeEvents(
          principal,
          created.session.id,
          created.session.lastEventSeq,
        )
        .find((event) => event.type === "transcript.finalized"),
    ).toMatchObject({
      batchIndex: 0,
      data: {
        segment: { id: failed.acceptedTranscript.id, confirmation: "FINAL" },
        processing: {
          status: "RETRYABLE_FAILURE",
          code: "TURN_PROCESSING_FAILED",
        },
      },
    });
    expect(
      database
        .prepare(
          `SELECT raw_text, corrected_text, revision
           FROM transcript_segments WHERE id = ?`,
        )
        .get(failed.acceptedTranscript.id),
    ).toEqual({ raw_text: command.text, corrected_text: null, revision: 0 });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE interview_id = ? AND event_type = 'TURN_PROCESSING_FAILED'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);

    const retry = service.addMessageCommand(
      created.session.id,
      command,
      principal,
    );
    expect(retry).toEqual(failed);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM command_receipts
           WHERE interview_id = ? AND command_type = 'MESSAGE'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("rejects malformed structured output after preserving the FINAL transcript", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    const service = new InterviewService(new InterviewRepository(database), {
      turnPlanner: {
        plan: () =>
          ({
            text: "변조된 원문",
            currentInfoCode: "unknown_info_code",
            extractedItems: [],
            stateChanges: [],
            nextQuestion: null,
            requiresPersistence: false,
            normalized: 1,
          }) as never,
      },
    });
    const created = service.createInterview(principal);
    const command = {
      text: "월평균 매출은 2,300만원입니다",
      clientMessageId: "malformed-provider-turn",
      expectedVersion: created.session.version,
      currentQuestionInfoCode: "monthly_average_sales",
    };

    const failed = service.addMessageCommand(created.session.id, command, principal);

    expect(failed.processing).toEqual({
      status: "RETRYABLE_FAILURE",
      code: "TURN_PROCESSING_FAILED",
    });
    expect(failed.acceptedTranscript).toMatchObject({
      confirmation: "FINAL",
      text: command.text,
    });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE id = ? AND confirmation = 'FINAL'`,
        )
        .get(failed.acceptedTranscript.id)?.count,
    ).toBe(1);
  });
});
