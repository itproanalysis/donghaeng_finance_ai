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
import { TranscriptCorrectionService } from "../../src/server/transcript-correction-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

function harness(reprocessingHook?: ConstructorParameters<typeof TranscriptCorrectionService>[1]) {
  const database = createInMemoryDatabase();
  databases.push(database);
  let interviewSequence = 0;
  const interviewService = new InterviewService(new InterviewRepository(database), {
    now: () => new Date("2026-08-10T01:00:00.000Z"),
    idFactory: () => `interview-fixture-${++interviewSequence}`,
  });
  const created = interviewService.createInterview(principal);
  const message = interviewService.addMessageCommand(
    created.session.id,
    {
      text: "월평균 매출은 2,300만원입니다.",
      clientMessageId: "transcript-fixture-message",
      expectedVersion: created.session.version,
      currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
    },
    principal,
  );
  const borrowerSegment = database
    .prepare(
      `SELECT id FROM transcript_segments
       WHERE interview_id = ? AND speaker = 'BORROWER'
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get(created.session.id);
  if (!borrowerSegment) throw new Error("borrower transcript fixture missing");

  let correctionSequence = 0;
  const correctionService = new TranscriptCorrectionService(database, {
    now: () => new Date("2026-08-10T01:01:00.000Z"),
    idFactory: () => `correction-fixture-${++correctionSequence}`,
    ...reprocessingHook,
  });
  return {
    database,
    interviewService,
    correctionService,
    interviewId: created.session.id,
    segmentId: String(borrowerSegment.id),
    version: message.snapshot.session.version,
  };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("transcript correction transaction", () => {
  it("blocks correction while the same transcript has a pending Claude command", () => {
    const fixture = harness();
    const currentQuestion = fixture.database
      .prepare("SELECT current_question_code FROM interviews WHERE id = ?")
      .get(fixture.interviewId)?.current_question_code ?? null;
    fixture.database
      .prepare(
        `INSERT INTO message_command_stages(
          id, tenant_id, interview_id, client_message_id, request_hash,
          expected_version, current_question_code, transcript_segment_id,
          status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      )
      .run(
        "pending-correction-stage",
        principal.tenantId,
        fixture.interviewId,
        "pending-correction-command",
        "a".repeat(64),
        fixture.version,
        currentQuestion,
        fixture.segmentId,
        "2026-08-10T01:00:30.000Z",
      );
    const before = fixture.database
      .prepare("SELECT text, revision FROM transcript_segments WHERE id = ?")
      .get(fixture.segmentId);

    expect(() =>
      fixture.correctionService.correctTranscriptSegment(
        fixture.interviewId,
        fixture.segmentId,
        {
          clientCorrectionId: "blocked-pending-correction",
          expectedVersion: fixture.version,
          correctedText: "corrected text that must not be persisted",
          reason: "operator correction",
        },
        principal,
      ),
    ).toThrowError(expect.objectContaining({
      status: 409,
      code: "TRANSCRIPT_PROCESSING_PENDING",
    }));
    expect(
      fixture.database
        .prepare("SELECT text, revision FROM transcript_segments WHERE id = ?")
        .get(fixture.segmentId),
    ).toEqual(before);
    expect(
      fixture.database
        .prepare("SELECT status FROM message_command_stages WHERE id = ?")
        .get("pending-correction-stage")?.status,
    ).toBe("PENDING");
    expect(
      fixture.database.prepare("SELECT version FROM interviews WHERE id = ?")
        .get(fixture.interviewId)?.version,
    ).toBe(fixture.version);
  });

  it("preserves timing and raw STT text while appending a durable revision and outbox batch", () => {
    let hookCalls = 0;
    const fixture = harness({
      reprocessingHook: (context) => {
        hookCalls += 1;
        expect(context.database.isTransaction).toBe(true);
        expect(context.rawText).toBe("월평균 매출은 2,300만원입니다.");
        return {
          outboxEvents: [
            {
              type: "info.value_changed",
              data: { infoCode: "monthly_average_sales", reprocessed: true },
            },
          ],
        };
      },
    });
    fixture.database
      .prepare(
        `UPDATE transcript_segments
         SET start_ms = 120, end_ms = 2480, stt_confidence = 0.87
         WHERE id = ?`,
      )
      .run(fixture.segmentId);

    const command = {
      clientCorrectionId: "correction-1",
      expectedVersion: fixture.version,
      correctedText: "월평균 매출은 2,500만원입니다.",
      reason: "차주가 STT 금액 오인식을 바로잡음",
    };
    const first = fixture.correctionService.correctTranscriptSegment(
      fixture.interviewId,
      fixture.segmentId,
      command,
      principal,
    );
    const retry = fixture.correctionService.correctTranscriptSegment(
      fixture.interviewId,
      fixture.segmentId,
      command,
      principal,
    );

    expect(retry).toEqual(first);
    expect(hookCalls).toBe(1);
    expect(first.interview.version).toBe(fixture.version + 1);
    expect(first.segment).toMatchObject({
      startMs: 120,
      endMs: 2480,
      sttConfidence: 0.87,
      rawText: "월평균 매출은 2,300만원입니다.",
      correctedText: "월평균 매출은 2,500만원입니다.",
      text: "월평균 매출은 2,500만원입니다.",
      revision: 1,
      confirmation: "FINAL",
    });
    expect(first.events.map((event) => event.type)).toEqual([
      "transcript.corrected",
      "info.value_changed",
    ]);
    expect(first.events.at(-1)?.isBatchFinal).toBe(true);
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM transcript_corrections WHERE interview_id = ?")
        .get(fixture.interviewId)?.count,
    ).toBe(1);
    expect(
      fixture.database
        .prepare(
          `SELECT COUNT(*) AS count FROM outbox_events
           WHERE interview_id = ? AND event_type = 'transcript.corrected'`,
        )
        .get(fixture.interviewId)?.count,
    ).toBe(1);

    expect(() =>
      fixture.database
        .prepare("UPDATE transcript_segments SET raw_text = ? WHERE id = ?")
        .run("원문 변조", fixture.segmentId),
    ).toThrow(/immutable/i);
    expect(() =>
      fixture.database
        .prepare("DELETE FROM transcript_corrections WHERE id = ?")
        .run(first.correction.id),
    ).toThrow(/immutable/i);
  });

  it("rejects partial persistence, idempotency-key reuse, stale versions, and tenant leaks", () => {
    const fixture = harness();

    expect(() =>
      fixture.database
        .prepare(
          `INSERT INTO transcript_segments(
            id, interview_id, sequence, speaker, text, confirmation, created_at
          ) VALUES (?, ?, 999, 'BORROWER', 'partial', 'PARTIAL', ?)`,
        )
        .run("partial-segment", fixture.interviewId, "2026-08-10T01:02:00.000Z"),
    ).toThrow();

    const command = {
      clientCorrectionId: "same-correction-key",
      expectedVersion: fixture.version,
      correctedText: "월평균 매출은 2,400만원입니다.",
      reason: "금액 정정",
    };
    fixture.correctionService.correctTranscriptSegment(
      fixture.interviewId,
      fixture.segmentId,
      command,
      principal,
    );

    expect(() =>
      fixture.correctionService.correctTranscriptSegment(
        fixture.interviewId,
        fixture.segmentId,
        { ...command, correctedText: "월평균 매출은 2,600만원입니다." },
        principal,
      ),
    ).toThrow(/clientCorrectionId/);
    expect(() =>
      fixture.correctionService.correctTranscriptSegment(
        fixture.interviewId,
        fixture.segmentId,
        {
          ...command,
          clientCorrectionId: "stale-correction",
          correctedText: "월평균 매출은 2,700만원입니다.",
        },
        principal,
      ),
    ).toThrow(/다른 요청/);
    expect(() =>
      fixture.correctionService.correctTranscriptSegment(
        fixture.interviewId,
        fixture.segmentId,
        {
          ...command,
          clientCorrectionId: "other-tenant-correction",
          expectedVersion: fixture.version + 1,
        },
        { ...principal, tenantId: "another-tenant" },
      ),
    ).toThrow(/찾을 수 없습니다/);
  });

  it("rolls back the segment, aggregate version, history, and outbox when reprocessing fails", () => {
    const fixture = harness({
      reprocessingHook: () => {
        throw new Error("reprocessing failed");
      },
    });
    const beforeSegment = fixture.database
      .prepare(
        "SELECT text, raw_text, corrected_text, revision FROM transcript_segments WHERE id = ?",
      )
      .get(fixture.segmentId);
    const beforeAggregate = fixture.database
      .prepare("SELECT version, event_seq FROM interviews WHERE id = ?")
      .get(fixture.interviewId);
    const beforeOutboxCount = fixture.database
      .prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE interview_id = ?")
      .get(fixture.interviewId)?.count;

    // A caller-owned transaction must not weaken correction atomicity. The
    // service uses a savepoint so hook failure still removes every local write.
    fixture.database.exec("BEGIN IMMEDIATE;");
    expect(() =>
      fixture.correctionService.correctTranscriptSegment(
        fixture.interviewId,
        fixture.segmentId,
        {
          clientCorrectionId: "rollback-correction",
          expectedVersion: fixture.version,
          correctedText: "월평균 매출은 2,900만원입니다.",
          reason: "rollback 검증",
        },
        principal,
      ),
    ).toThrow("reprocessing failed");

    expect(
      fixture.database
        .prepare(
          "SELECT text, raw_text, corrected_text, revision FROM transcript_segments WHERE id = ?",
        )
        .get(fixture.segmentId),
    ).toEqual(beforeSegment);
    expect(
      fixture.database
        .prepare("SELECT version, event_seq FROM interviews WHERE id = ?")
        .get(fixture.interviewId),
    ).toEqual(beforeAggregate);
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM transcript_corrections WHERE interview_id = ?")
        .get(fixture.interviewId)?.count,
    ).toBe(0);
    expect(
      fixture.database
        .prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE interview_id = ?")
        .get(fixture.interviewId)?.count,
    ).toBe(beforeOutboxCount);
    fixture.database.exec("COMMIT;");
  });

  it("allows corrections only while the interview aggregate is ACTIVE", () => {
    const fixture = harness();
    fixture.database
      .prepare(
        `UPDATE interviews
         SET lifecycle_status = 'INCOMPLETE', completed_at = ?
         WHERE id = ?`,
      )
      .run("2026-08-10T01:05:00.000Z", fixture.interviewId);

    expect(() =>
      fixture.correctionService.correctTranscriptSegment(
        fixture.interviewId,
        fixture.segmentId,
        {
          clientCorrectionId: "finalized-correction",
          expectedVersion: fixture.version,
          correctedText: "종료 후 변경 시도",
          reason: "금지 검증",
        },
        principal,
      ),
    ).toThrow(/종료된 인터뷰/);
  });
});
