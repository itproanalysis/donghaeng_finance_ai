import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { POST as bootstrap } from "../../src/app/api/auth/bootstrap/route";
import { POST as createInterview } from "../../src/app/api/interviews/route";
import { GET as getInterview } from "../../src/app/api/interviews/[id]/route";
import { POST as addMessage } from "../../src/app/api/interviews/[id]/messages/route";
import { POST as correctTranscript } from "../../src/app/api/interviews/[id]/transcript-segments/[segmentId]/corrections/route";

interface TestGlobals {
  __donghaengDatabase?: DatabaseSync;
  __donghaengInterviewService?: unknown;
  __donghaengAuthService?: unknown;
  __donghaengRetentionService?: unknown;
}

const globals = globalThis as typeof globalThis & TestGlobals;
const originalDatabasePath = process.env.DONGHAENG_DB_PATH;
const temporaryDirectories: string[] = [];

function clearServices(): void {
  try {
    globals.__donghaengDatabase?.close();
  } catch {
    // A failed route may already have closed the test connection.
  }
  delete globals.__donghaengDatabase;
  delete globals.__donghaengInterviewService;
  delete globals.__donghaengAuthService;
  delete globals.__donghaengRetentionService;
}

function jsonRequest(
  url: string,
  body: Record<string, unknown>,
  cookie?: string,
  origin = new URL(url).origin,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function authenticatedTranscriptFixture() {
  const directory = mkdtempSync(join(tmpdir(), "donghaeng-correction-api-"));
  temporaryDirectories.push(directory);
  process.env.DONGHAENG_DB_PATH = join(directory, "correction-api.db");
  clearServices();

  const bootstrapResponse = await bootstrap(
    jsonRequest("http://localhost/api/auth/bootstrap", {}),
  );
  const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const createResponse = await createInterview(
    new Request("http://localhost/api/interviews", {
      method: "POST",
      headers: { origin: "http://localhost", cookie },
    }),
  );
  const created = (await createResponse.json()).data;
  const interviewId = String(created.session.id);
  const messageResponse = await addMessage(
    jsonRequest(
      `http://localhost/api/interviews/${interviewId}/messages`,
      {
        text: "월평균 매출은 2,300만원입니다.",
        clientMessageId: "api-transcript-message",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
      },
      cookie,
    ),
    { params: Promise.resolve({ id: interviewId }) },
  );
  const message = (await messageResponse.json()).data;
  const segment = globals.__donghaengDatabase
    ?.prepare(
      `SELECT id FROM transcript_segments
       WHERE interview_id = ? AND speaker = 'BORROWER'
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get(interviewId);
  if (!segment) throw new Error("API transcript fixture missing");
  return {
    cookie,
    interviewId,
    segmentId: String(segment.id),
    expectedVersion: Number(message.snapshot.session.version),
  };
}

afterEach(() => {
  clearServices();
  process.env.DONGHAENG_DB_PATH = originalDatabasePath;
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory && resolve(directory).startsWith(resolve(tmpdir()))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("transcript correction API", () => {
  it("authenticates, applies a CAS correction, and returns the stored envelope on retry", async () => {
    const fixture = await authenticatedTranscriptFixture();
    const url = `http://localhost/api/interviews/${fixture.interviewId}/transcript-segments/${fixture.segmentId}/corrections`;
    const command = {
      clientCorrectionId: "api-correction-1",
      expectedVersion: fixture.expectedVersion,
      correctedText: "월평균 매출은 2,500만원입니다.",
      reason: "STT 금액 정정",
    };

    const firstResponse = await correctTranscript(
      jsonRequest(url, command, fixture.cookie),
      {
        params: Promise.resolve({
          id: fixture.interviewId,
          segmentId: fixture.segmentId,
        }),
      },
    );
    const first = await firstResponse.json();
    const retryResponse = await correctTranscript(
      jsonRequest(url, command, fixture.cookie),
      {
        params: Promise.resolve({
          id: fixture.interviewId,
          segmentId: fixture.segmentId,
        }),
      },
    );
    const retry = await retryResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get("x-request-id")).toBeTruthy();
    expect(first).toMatchObject({
      data: {
        segment: {
          rawText: "월평균 매출은 2,300만원입니다.",
          correctedText: "월평균 매출은 2,500만원입니다.",
          revision: 1,
        },
        interview: { version: fixture.expectedVersion + 1 },
        events: expect.arrayContaining([
          expect.objectContaining({ type: "transcript.corrected" }),
          expect.objectContaining({ type: "info.value_changed" }),
          expect.objectContaining({ type: "coverage.changed" }),
          expect.objectContaining({ type: "feature.preview_updated" }),
          expect.objectContaining({ type: "summary.preview_updated" }),
        ]),
      },
      error: null,
      meta: { requestId: expect.any(String) },
    });
    expect(retryResponse.status).toBe(200);
    expect(retry.data).toEqual(first.data);
    const snapshotResponse = await getInterview(
      new Request(`http://localhost/api/interviews/${fixture.interviewId}`, {
        headers: { cookie: fixture.cookie },
      }),
      { params: Promise.resolve({ id: fixture.interviewId }) },
    );
    const snapshot = (await snapshotResponse.json()).data;
    const nextInfoCode = String(snapshot.nextQuestion?.infoCode ?? "");
    expect(nextInfoCode).not.toBe("");
    expect(nextInfoCode).not.toBe("monthly_average_sales");
    expect(
      globals.__donghaengDatabase
        ?.prepare("SELECT current_question_code FROM interviews WHERE id = ?")
        .get(fixture.interviewId)?.current_question_code,
    ).toBe(nextInfoCode);
    const nextAnswers: Record<string, string> = {
      fixed_operating_costs: "고정비는 월 1,000만원입니다",
      improvement_plan: "개선 계획은 3개월 동안 폐기비를 줄이는 것입니다",
      execution_readiness: "인력과 예산을 확보해 실행 준비가 됐습니다",
      confirmed_reservations: "확정 예약은 3건이고 총액은 120만원입니다",
      seasonality_outlook: "앞으로 3개월 수요는 10% 증가할 전망입니다",
      essential_household_expenses: "필수 가계지출은 월 300만원입니다",
      emergency_buffer_months: "비상자금은 4개월입니다",
    };
    const nextMessageResponse = await addMessage(
      jsonRequest(
        `http://localhost/api/interviews/${fixture.interviewId}/messages`,
        {
          text: nextAnswers[nextInfoCode] ?? "현재 질문에 답변합니다",
          clientMessageId: "api-after-correction-message",
          expectedVersion: first.data.interview.version,
          currentQuestionInfoCode: nextInfoCode,
        },
        fixture.cookie,
      ),
      { params: Promise.resolve({ id: fixture.interviewId }) },
    );
    expect(nextMessageResponse.status).toBe(200);
    await expect(nextMessageResponse.json()).resolves.toMatchObject({
      data: { snapshot: { session: { version: first.data.interview.version + 1 } } },
      error: null,
    });
    const selectedRevision = globals.__donghaengDatabase
      ?.prepare(
        `SELECT r.revision_json
         FROM canonical_information_records c
         JOIN canonical_value_revisions r
           ON r.id = json_extract(c.record_json, '$.selectedRevisionId')
         WHERE c.interview_id = ? AND c.info_code = 'monthly_average_sales'`,
      )
      .get(fixture.interviewId);
    expect(JSON.parse(String(selectedRevision?.revision_json))).toMatchObject({
      value: {
        amount: { kind: "EXACT", value: 25_000_000 },
        currency: "KRW",
      },
      supersedesRevisionId: expect.any(String),
    });
    expect(
      JSON.parse(
        String(
          globals.__donghaengDatabase
            ?.prepare(
              `SELECT raw_value_json FROM live_features
               WHERE interview_id = ? AND feature_code = 'monthly_average_sales'`,
            )
            .get(fixture.interviewId)?.raw_value_json,
        ),
      ),
    ).toEqual({ kind: "EXACT", value: 25_000_000 });
    const resolvedConflict = globals.__donghaengDatabase
      ?.prepare(
        `SELECT status, conflict_json FROM canonical_value_conflicts
         WHERE interview_id = ? AND info_code = 'monthly_average_sales'`,
      )
      .get(fixture.interviewId);
    expect(resolvedConflict).toBeUndefined();
    expect(
      globals.__donghaengDatabase
        ?.prepare("SELECT COUNT(*) AS count FROM transcript_corrections WHERE interview_id = ?")
        .get(fixture.interviewId)?.count,
    ).toBe(1);
  });

  it("rolls back transcript, canonical revisions, features, outbox, and version together", async () => {
    const fixture = await authenticatedTranscriptFixture();
    const database = globals.__donghaengDatabase;
    if (!database) throw new Error("API database missing");
    const before = {
      aggregate: database
        .prepare("SELECT version, event_seq FROM interviews WHERE id = ?")
        .get(fixture.interviewId),
      transcript: database
        .prepare("SELECT text, raw_text, revision FROM transcript_segments WHERE id = ?")
        .get(fixture.segmentId),
      revisions: database
        .prepare(
          "SELECT COUNT(*) AS count FROM canonical_value_revisions WHERE interview_id = ?",
        )
        .get(fixture.interviewId)?.count,
      evidence: database
        .prepare("SELECT COUNT(*) AS count FROM evidence_refs WHERE interview_id = ?")
        .get(fixture.interviewId)?.count,
      outbox: database
        .prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE interview_id = ?")
        .get(fixture.interviewId)?.count,
      conflict: database
        .prepare(
          `SELECT status, conflict_json, resolved_at
           FROM canonical_value_conflicts WHERE interview_id = ?`,
        )
        .get(fixture.interviewId),
    };
    database.exec(`
      CREATE TRIGGER fail_correction_feature_rebuild
      BEFORE INSERT ON live_features
      BEGIN
        SELECT RAISE(ABORT, 'forced feature rebuild failure');
      END;
    `);

    const response = await correctTranscript(
      jsonRequest(
        `http://localhost/api/interviews/${fixture.interviewId}/transcript-segments/${fixture.segmentId}/corrections`,
        {
          clientCorrectionId: "api-correction-rollback",
          expectedVersion: fixture.expectedVersion,
          correctedText: "월평균 매출은 2,900만원입니다.",
          reason: "rollback 검증",
        },
        fixture.cookie,
      ),
      {
        params: Promise.resolve({
          id: fixture.interviewId,
          segmentId: fixture.segmentId,
        }),
      },
    );

    expect(response.status).toBe(500);
    expect(database.prepare("SELECT version, event_seq FROM interviews WHERE id = ?").get(fixture.interviewId)).toEqual(before.aggregate);
    expect(database.prepare("SELECT text, raw_text, revision FROM transcript_segments WHERE id = ?").get(fixture.segmentId)).toEqual(before.transcript);
    expect(database.prepare("SELECT COUNT(*) AS count FROM canonical_value_revisions WHERE interview_id = ?").get(fixture.interviewId)?.count).toBe(before.revisions);
    expect(database.prepare("SELECT COUNT(*) AS count FROM evidence_refs WHERE interview_id = ?").get(fixture.interviewId)?.count).toBe(before.evidence);
    expect(database.prepare("SELECT COUNT(*) AS count FROM outbox_events WHERE interview_id = ?").get(fixture.interviewId)?.count).toBe(before.outbox);
    expect(
      database
        .prepare(
          `SELECT status, conflict_json, resolved_at
           FROM canonical_value_conflicts WHERE interview_id = ?`,
        )
        .get(fixture.interviewId),
    ).toEqual(before.conflict);
    expect(database.prepare("SELECT COUNT(*) AS count FROM transcript_corrections WHERE interview_id = ?").get(fixture.interviewId)?.count).toBe(0);
  });

  it("enforces authentication, same-origin mutation, validation, and stale-version errors", async () => {
    const fixture = await authenticatedTranscriptFixture();
    const url = `http://localhost/api/interviews/${fixture.interviewId}/transcript-segments/${fixture.segmentId}/corrections`;
    const command = {
      clientCorrectionId: "api-correction-guard",
      expectedVersion: fixture.expectedVersion,
      correctedText: "월평균 매출은 2,450만원입니다.",
      reason: "STT 정정",
    };
    const context = {
      params: Promise.resolve({ id: fixture.interviewId, segmentId: fixture.segmentId }),
    };

    const unauthorized = await correctTranscript(jsonRequest(url, command), context);
    expect(unauthorized.status).toBe(401);

    const crossSite = await correctTranscript(
      jsonRequest(url, command, fixture.cookie, "https://attacker.example"),
      context,
    );
    expect(crossSite.status).toBe(403);

    const invalid = await correctTranscript(
      jsonRequest(url, { ...command, reason: "" }, fixture.cookie),
      context,
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_CORRECTION_COMMAND", details: { field: "reason" } },
      meta: { requestId: expect.any(String) },
    });

    const stale = await correctTranscript(
      jsonRequest(
        url,
        { ...command, clientCorrectionId: "api-stale", expectedVersion: fixture.expectedVersion - 1 },
        fixture.cookie,
      ),
      context,
    );
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      data: null,
      error: { code: "VERSION_CONFLICT" },
      meta: { requestId: expect.any(String) },
    });
  });
});
