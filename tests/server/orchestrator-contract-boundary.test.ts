import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createValidatedOrchestratorProvider } from "../../src/domain";
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
  displayName: "Contract boundary tester",
  roles: ["ADMIN", "INTERVIEWER"],
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("orchestrator contract failure boundary", () => {
  it("turns malformed structured output into a retryable failure after preserving FINAL text", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `contract-boundary-${++id}`,
      turnPlanner: createValidatedOrchestratorProvider({
        plan: () => ({ providerNarrative: "unstructured prose instead of the contract" }),
      }),
    });
    const created = service.createInterview(principal);
    const command = {
      text: "월평균 매출은 23,000,000원입니다.",
      clientMessageId: "malformed-provider-output",
      expectedVersion: created.session.version,
      currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
    };

    const result = service.addMessageCommand(created.session.id, command, principal);

    expect(result.processing).toEqual({
      status: "RETRYABLE_FAILURE",
      code: "TURN_PROCESSING_FAILED",
    });
    expect(result.acceptedTranscript).toMatchObject({
      text: command.text,
      confirmation: "FINAL",
    });
    expect(result.evidenceAdded).toEqual([]);
    expect(
      database
        .prepare("SELECT raw_text FROM transcript_segments WHERE id = ?")
        .get(result.acceptedTranscript.id),
    ).toEqual({ raw_text: command.text });
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events
           WHERE interview_id = ? AND event_type = 'TURN_PROCESSING_FAILED'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);

    const retry = service.addMessageCommand(created.session.id, command, principal);
    expect(retry).toEqual(result);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM transcript_segments WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(2); // initial assistant question + exactly one borrower FINAL segment
  });
});
