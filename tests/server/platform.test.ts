import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  AuthService,
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase, migrateDatabase } from "../../src/server/database";
import { ApplicationError } from "../../src/server/errors";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";
import { PlatformRepository } from "../../src/server/platform-repository";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

function harness() {
  const database = createInMemoryDatabase();
  databases.push(database);
  let id = 0;
  const repository = new InterviewRepository(database);
  const service = new InterviewService(repository, {
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    idFactory: () => `platform-test-${++id}`,
  });
  return { database, repository, service, platform: new PlatformRepository(database) };
}

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("migration integrity", () => {
  it("discovers every migration and records immutable checksums", () => {
    const { database } = harness();
    const rows = database
      .prepare("SELECT version, checksum FROM app_schema_migrations ORDER BY version")
      .all();

    expect(rows.map((row) => row.version)).toEqual([
      "001_initial",
      "002_platform_integrity",
      "003_domain_output_storage",
      "004_canonical_information_records",
      "005_transcript_corrections",
      "006_transcript_provider",
      "007_consent_integrity",
      "008_canonical_conflicts",
      "009_transcript_finalized_outbox",
      "010_evaluation_ready_outbox",
      "011_async_message_command_staging",
      "012_cloud_ai_processing_consent",
      "013_message_command_retry_integrity",
      "014_borrower_improvement_candidate_selections",
      "015_durable_audio_turn_leases",
    ]);
    expect(rows.every((row) => String(row.checksum).length === 64)).toBe(true);
    expect(database.prepare("PRAGMA user_version").get()?.user_version).toBe(15);
  });

  it("refuses a changed migration checksum", () => {
    const { database } = harness();
    database
      .prepare("UPDATE app_schema_migrations SET checksum = ? WHERE version = ?")
      .run("0".repeat(64), "001_initial");

    expect(() => migrateDatabase(database)).toThrow(/checksum mismatch/i);
  });

  it("rejects malformed JSON at the database boundary", () => {
    const { database } = harness();

    expect(() =>
      database
        .prepare(
          `INSERT INTO retention_runs(id, started_at, completed_at, dry_run, result_json)
           VALUES ('bad-json', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z', 1, 'not-json')`,
        )
        .run(),
    ).toThrow();
  });
});

describe("local synthetic authentication", () => {
  it("bootstraps a hashed local account, authenticates the cookie, and revokes it", () => {
    const { database } = harness();
    const auth = new AuthService(database, () => new Date("2026-08-10T00:00:00.000Z"), {
      DONGHAENG_LOCAL_PASSWORD: "test-local-password",
    });
    const session = auth.bootstrapLocalWorkspace();
    const request = new Request("http://localhost/api/auth/me", {
      headers: { cookie: `donghaeng_session=${session.token}` },
    });

    expect(auth.authenticate(request)).toMatchObject({
      tenantId: LOCAL_WORKSPACE_TENANT_ID,
      userId: LOCAL_WORKSPACE_USER_ID,
    });
    expect(
      database.prepare("SELECT password_hash FROM users WHERE id = ?").get(LOCAL_WORKSPACE_USER_ID)
        ?.password_hash,
    ).not.toBe("UNINITIALIZED");
    auth.logout(request);
    expect(() => auth.authenticate(request)).toThrow(ApplicationError);
  });

  it("accepts the development password only after bootstrap and rejects a wrong password", () => {
    const { database } = harness();
    const auth = new AuthService(database, () => new Date("2026-08-10T00:00:00.000Z"), {
      DONGHAENG_LOCAL_PASSWORD: "test-local-password",
    });
    auth.bootstrapLocalWorkspace();

    expect(auth.login(LOCAL_WORKSPACE_EMAIL, "test-local-password").principal.userId).toBe(
      LOCAL_WORKSPACE_USER_ID,
    );
    expect(() => auth.login(LOCAL_WORKSPACE_EMAIL, "wrong-password")).toThrow(
      /이메일 또는 비밀번호/,
    );
  });
});

describe("tenant-scoped atomic commands", () => {
  it("applies one version per message and returns the exact stored response on retry", () => {
    const { database, service } = harness();
    const created = service.createInterview(principal);
    const command = {
      text: "월 2,300만원입니다",
      clientMessageId: "client-message-1",
      expectedVersion: created.session.version,
      currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
    };
    const first = service.addMessageCommand(created.session.id, command, principal);
    const transcriptCount = database
      .prepare("SELECT COUNT(*) AS count FROM transcript_segments WHERE interview_id = ?")
      .get(created.session.id)?.count;
    const second = service.addMessageCommand(created.session.id, command, principal);

    expect(first.snapshot.session.version).toBe(created.session.version + 1);
    expect(first.snapshot.session.lastEventSeq).toBeGreaterThan(created.session.lastEventSeq);
    expect(second).toEqual(first);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM transcript_segments WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(transcriptCount);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("persists final STT timing, confidence, provider, and immutable raw text", () => {
    const { database, service } = harness();
    const created = service.createInterview(principal);
    const result = service.addMessageCommand(
      created.session.id,
      {
        text: "월 2,300만원입니다",
        clientMessageId: "audio-final-1",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
        transcriptMetadata: {
          startMs: 140,
          endMs: 2_640,
          sttConfidence: 0.94,
          sttProvider: "mock-streaming-stt",
        },
      },
      principal,
    );
    const row = database
      .prepare(
        `SELECT confirmation, start_ms, end_ms, stt_confidence, stt_provider,
                raw_text, corrected_text, revision
         FROM transcript_segments
         WHERE id = ?`,
      )
      .get(result.acceptedTranscript.id);

    expect(row).toEqual({
      confirmation: "FINAL",
      start_ms: 140,
      end_ms: 2_640,
      stt_confidence: 0.94,
      stt_provider: "mock-streaming-stt",
      raw_text: "월 2,300만원입니다",
      corrected_text: null,
      revision: 0,
    });
    expect(() =>
      database
        .prepare("UPDATE transcript_segments SET raw_text = ? WHERE id = ?")
        .run("덮어쓴 원문", result.acceptedTranscript.id),
    ).toThrow(/raw text is immutable/i);
    expect(() =>
      database
        .prepare(
          `INSERT INTO transcript_segments(
             id, interview_id, sequence, speaker, text, confirmation, created_at
           ) VALUES (?, ?, ?, 'BORROWER', 'partial', 'PARTIAL', ?)`,
        )
        .run(
          "partial-is-not-durable",
          created.session.id,
          999,
          "2026-08-10T00:00:00.000Z",
        ),
    ).toThrow();
  });

  it("rejects idempotency key reuse and stale versions without side effects", () => {
    const { database, service } = harness();
    const created = service.createInterview(principal);
    const command = {
      text: "월 2,300만원입니다",
      clientMessageId: "same-key",
      expectedVersion: 1,
      currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
    };
    service.addMessageCommand(created.session.id, command, principal);
    const before = database
      .prepare("SELECT COUNT(*) AS count FROM transcript_segments WHERE interview_id = ?")
      .get(created.session.id)?.count;

    expect(() =>
      service.addMessageCommand(
        created.session.id,
        { ...command, text: "다른 내용입니다" },
        principal,
      ),
    ).toThrow(/client command ID/i);
    expect(() =>
      service.addMessageCommand(
        created.session.id,
        { ...command, clientMessageId: "stale-key" },
        principal,
      ),
    ).toThrow(/다른 요청/);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM transcript_segments WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(before);
  });

  it("rolls back the CAS when message processing fails", () => {
    const { service, platform } = harness();
    const created = service.createInterview(principal);

    expect(() =>
      service.addMessageCommand(
        created.session.id,
        {
          text: "   ",
          clientMessageId: "invalid-message",
          expectedVersion: 1,
          currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
        },
        principal,
      ),
    ).toThrow(/1자 이상/);
    expect(platform.getInterviewAggregate(principal.tenantId, created.session.id)).toMatchObject({
      version: 1,
      lastEventSeq: created.session.lastEventSeq,
    });
  });

  it("keeps ordered replay metadata and tenant isolation", () => {
    const { service } = harness();
    const created = service.createInterview(principal);
    const result = service.addMessageCommand(
      created.session.id,
      {
        text: "월 2,300만원입니다",
        clientMessageId: "event-message",
        expectedVersion: 1,
        currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
      },
      principal,
    );
    const replay = service.getRealtimeEvents(principal, created.session.id, created.session.lastEventSeq);

    expect(replay.length).toBeGreaterThan(0);
    expect(replay.map((event) => event.seq)).toEqual(
      Array.from(
        { length: replay.length },
        (_, index) => created.session.lastEventSeq + index + 1,
      ),
    );
    expect(replay.at(-1)).toMatchObject({
      isBatchFinal: true,
      aggregateVersion: result.snapshot.session.version,
      snapshotUrl: `/api/interviews/${created.session.id}`,
    });
    expect(() =>
      service.getInterviewSnapshot(created.session.id, {
        ...principal,
        tenantId: "another-tenant",
      }),
    ).toThrow(/찾을 수 없습니다/);
  });

  it("force-completes idempotently, returns FINAL only, and does not create an evaluation", () => {
    const { database, service } = harness();
    const created = service.createInterview(principal);
    const command = {
      clientCommandId: "force-complete-1",
      expectedVersion: created.session.version,
      mode: "FORCE_INCOMPLETE" as const,
      borrowerConfirmed: true,
      reason: "차주가 인터뷰 중단을 요청함",
      improvementChoice: {
        id: "catalog-improvement-action",
        title: "한 가지 개선 행동 정하기",
        origin: "CATALOG_SUGGESTION" as const,
        sourceInfoCodes: ["improvement_plan"],
        evidenceIds: [],
      },
    };
    const first = service.completeInterviewCommand(created.session.id, command, principal);
    const second = service.completeInterviewCommand(created.session.id, command, principal);
    const read = service.getInterviewSnapshot(created.session.id, principal);

    expect(second).toEqual(first);
    expect(first.snapshot).toMatchObject({
      snapshotType: "FINAL",
      completionStatus: "INCOMPLETE",
      evaluationId: null,
      session: { snapshotType: "FINAL", lifecycleStatus: "INCOMPLETE" },
    });
    expect(first.evaluation).toBeNull();
    expect(first.evaluationEligibility.eligible).toBe(false);
    expect(first.improvementSelection).toMatchObject({
      eventType: "BORROWER_SELECTED_IMPROVEMENT_CANDIDATE",
      choice: command.improvementChoice,
      liveVersion: created.session.version + 1,
    });
    expect(read.snapshotType).toBe("FINAL");
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM evaluations WHERE interview_id = ?").get(
        created.session.id,
      )?.count,
    ).toBe(0);
    expect(
      database.prepare(
        "SELECT COUNT(*) AS count FROM borrower_improvement_candidate_selections WHERE interview_id = ?",
      ).get(created.session.id)?.count,
    ).toBe(1);
    expect(
      database.prepare(
        "SELECT COUNT(*) AS count FROM audit_events WHERE interview_id = ? AND event_type = 'BORROWER_SELECTED_IMPROVEMENT_CANDIDATE'",
      ).get(created.session.id)?.count,
    ).toBe(1);
    expect(() => database.prepare(
      "UPDATE borrower_improvement_candidate_selections SET candidate_title = '덮어쓰기' WHERE interview_id = ?",
    ).run(created.session.id)).toThrow(/immutable/i);
  });

  it("rejects a client-authored improvement title and rolls back completion CAS", () => {
    const { database, service, platform } = harness();
    const created = service.createInterview(principal);

    expect(() => service.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "tampered-improvement-choice",
        expectedVersion: created.session.version,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: true,
        reason: "차주 요청",
        improvementChoice: {
          id: "catalog-improvement-action",
          title: "대출 승인 확정",
          origin: "CATALOG_SUGGESTION",
          sourceInfoCodes: ["improvement_plan"],
          evidenceIds: [],
        },
      },
      principal,
    )).toThrowError(expect.objectContaining({ code: "IMPROVEMENT_CHOICE_NOT_ALLOWLISTED" }));

    expect(platform.getInterviewAggregate(principal.tenantId, created.session.id)).toMatchObject({
      lifecycleStatus: "ACTIVE",
      version: created.session.version,
    });
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM borrower_improvement_candidate_selections WHERE interview_id = ?",
    ).get(created.session.id)?.count).toBe(0);
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM final_snapshots WHERE interview_id = ?",
    ).get(created.session.id)?.count).toBe(0);
  });

  it("blocks normal completion until every server condition is satisfied", () => {
    const { service } = harness();
    const created = service.createInterview(principal);

    expect(() =>
      service.completeInterviewCommand(
        created.session.id,
        {
          clientCommandId: "normal-complete-1",
          expectedVersion: 1,
          mode: "COMPLETE",
          borrowerConfirmed: true,
          reason: null,
        },
        principal,
      ),
    ).toThrow(/필수 완료 조건/);
  });
});
