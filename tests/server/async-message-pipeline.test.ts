import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { planDeterministicInterviewTurn } from "../../src/domain";
import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { ApplicationError } from "../../src/server/errors";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "Async planner tester",
  roles: ["ADMIN", "INTERVIEWER"],
};

class SyntheticRetryableClaudeError extends Error {
  readonly name = "ClaudeProviderError";
  readonly code: string;
  readonly retryable = true;

  constructor(code = "CLAUDE_TIMEOUT") {
    super("synthetic retryable provider failure");
    this.code = code;
  }
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function commandFor(
  created: ReturnType<InterviewService["createInterview"]>,
  clientMessageId: string,
) {
  return {
    text: "월평균 매출은 2,300만원입니다.",
    clientMessageId,
    expectedVersion: created.session.version,
    currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
  };
}

async function createStalePendingScenario(label: string) {
  const database = createInMemoryDatabase();
  databases.push(database);
  let id = 0;
  let providerCalls = 0;
  const service = new InterviewService(new InterviewRepository(database), {
    idFactory: () => `${label}-${++id}`,
    asyncTurnPlanner: {
      plan: async (input) => {
        providerCalls += 1;
        if (providerCalls === 1) throw new SyntheticRetryableClaudeError();
        return {
          plan: planDeterministicInterviewTurn(input),
          metadata: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            requestId: `req-${label}-${providerCalls}`,
            inputTokens: 12,
            outputTokens: 34,
            stopReason: "tool_use",
          },
        };
      },
    },
  });
  const created = service.createInterview(principal);
  const pendingCommand = commandFor(created, `${label}-pending`);
  const failed = await service.addMessageCommandAsync(
    created.session.id,
    pendingCommand,
    principal,
  );
  database
    .prepare("UPDATE interviews SET version = version + 1 WHERE id = ?")
    .run(created.session.id);
  return {
    database,
    service,
    created,
    pendingCommand,
    failed,
    providerCalls: () => providerCalls,
  };
}

describe("async transcript-first message pipeline", () => {
  it("checks cloud consent before staging so a denied request leaves no transcript or pending command", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let consentGranted = false;
    let providerCalls = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `async-consent-${++id}`,
      beforeAsyncStage: () => {
        expect(database.isTransaction).toBe(false);
        if (!consentGranted) {
          throw new ApplicationError(
            403,
            "CLOUD_AI_PROCESSING_CONSENT_REQUIRED",
            "Cloud AI processing consent is required.",
          );
        }
      },
      asyncTurnPlanner: {
        plan: async (input) => {
          providerCalls += 1;
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-consented",
              inputTokens: 10,
              outputTokens: 20,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    const command = commandFor(created, "async-consent-command");

    await expect(
      service.addMessageCommandAsync(created.session.id, command, principal),
    ).rejects.toMatchObject({ code: "CLOUD_AI_PROCESSING_CONSENT_REQUIRED" });
    expect(providerCalls).toBe(0);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(created.session.id)?.count,
    ).toBe(0);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(0);
    expect(
      database.prepare("SELECT version FROM interviews WHERE id = ?").get(created.session.id)
        ?.version,
    ).toBe(created.session.version);

    consentGranted = true;
    const applied = await service.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    expect(applied.processing.status).toBe("APPLIED");
    expect(providerCalls).toBe(1);
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
        .prepare("SELECT COUNT(*) AS count FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("rechecks consent after staging and resumes the same pending command without calling the provider while revoked", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let allowProviderCall = false;
    let providerCalls = 0;
    let preStageChecks = 0;
    let prePlanChecks = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `async-consent-toctou-${++id}`,
      beforeAsyncStage: () => {
        preStageChecks += 1;
        expect(database.isTransaction).toBe(false);
      },
      beforeAsyncPlan: () => {
        prePlanChecks += 1;
        expect(database.isTransaction).toBe(false);
        if (!allowProviderCall) {
          throw new ApplicationError(
            403,
            "CLOUD_AI_PROCESSING_CONSENT_REQUIRED",
            "Cloud AI processing consent was revoked before the provider call.",
          );
        }
      },
      asyncTurnPlanner: {
        plan: async (input) => {
          providerCalls += 1;
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-after-consent-restore",
              inputTokens: 10,
              outputTokens: 20,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    const command = commandFor(created, "async-consent-toctou-command");

    await expect(
      service.addMessageCommandAsync(created.session.id, command, principal),
    ).rejects.toMatchObject({ code: "CLOUD_AI_PROCESSING_CONSENT_REQUIRED" });
    expect(providerCalls).toBe(0);
    expect(preStageChecks).toBe(1);
    expect(prePlanChecks).toBe(1);
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
        .prepare("SELECT status FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id)?.status,
    ).toBe("PENDING");
    expect(
      database.prepare("SELECT version FROM interviews WHERE id = ?").get(created.session.id)
        ?.version,
    ).toBe(created.session.version);

    allowProviderCall = true;
    const applied = await service.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    expect(applied.processing.status).toBe("APPLIED");
    expect(providerCalls).toBe(1);
    expect(preStageChecks).toBe(2);
    expect(prePlanChecks).toBe(2);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("commits FINAL transcript/stage before planning, calls the provider outside SQLite, then applies with metadata", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    const repository = new InterviewRepository(database);
    let id = 0;
    let providerCalls = 0;
    let interviewId = "";
    const service = new InterviewService(repository, {
      now: () => new Date("2026-08-11T03:00:00.000Z"),
      idFactory: () => `async-success-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          providerCalls += 1;
          expect(database.isTransaction).toBe(false);
          expect(
            database
              .prepare(
                `SELECT s.confirmation, m.status
                 FROM transcript_segments s
                 JOIN message_command_stages m ON m.transcript_segment_id = s.id
                 WHERE s.interview_id = ? AND s.speaker = 'BORROWER'`,
              )
              .get(interviewId),
          ).toEqual({ confirmation: "FINAL", status: "PENDING" });
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-safe-123",
              inputTokens: 321,
              outputTokens: 87,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    interviewId = created.session.id;
    const command = commandFor(created, "async-success-command");

    const result = await service.addMessageCommandAsync(interviewId, command, principal);

    expect(result.processing).toEqual({
      status: "APPLIED",
      code: null,
      metadata: {
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        requestId: "req-safe-123",
        inputTokens: 321,
        outputTokens: 87,
        stopReason: "tool_use",
      },
    });
    expect(result.snapshot.session.version).toBe(created.session.version + 1);
    expect(
      database
        .prepare(
          `SELECT status, failure_code, provider_metadata_json
           FROM message_command_stages WHERE interview_id = ?`,
        )
        .get(interviewId),
    ).toMatchObject({ status: "APPLIED", failure_code: null });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
        .get(interviewId)?.count,
    ).toBe(1);

    const retry = await service.addMessageCommandAsync(interviewId, command, principal);
    expect(retry).toEqual(result);
    expect(providerCalls).toBe(1);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(interviewId)?.count,
    ).toBe(1);
  });

  it("keeps a failed stage pending and explicitly retries the same transcript to success", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let providerCalls = 0;
    class SyntheticClaudeError extends Error {
      readonly code = "ANTHROPIC_TIMEOUT";
      readonly retryable = true;
      constructor() {
        super("synthetic raw error containing sk-ant-secret-that-must-never-be-stored");
        this.name = "ClaudeProviderError";
      }
    }
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-11T03:01:00.000Z"),
      idFactory: () => `async-failure-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          providerCalls += 1;
          expect(database.isTransaction).toBe(false);
          if (providerCalls === 1) throw new SyntheticClaudeError();
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-retry-success",
              inputTokens: 20,
              outputTokens: 30,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    const command = commandFor(created, "async-failure-command");

    const result = await service.addMessageCommandAsync(created.session.id, command, principal);

    expect(result.processing).toEqual({
      status: "RETRYABLE_FAILURE",
      code: "TURN_PROCESSING_FAILED",
    });
    expect(result.snapshot.session.version).toBe(created.session.version);
    expect(result.acceptedTranscript).toMatchObject({
      text: command.text,
      confirmation: "FINAL",
    });
    expect(
      database
        .prepare("SELECT status, failure_code FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id),
    ).toEqual({ status: "PENDING", failure_code: null });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(0);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM outbox_events
           WHERE interview_id = ? AND event_type = 'transcript.finalized'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);
    const audit = database
      .prepare(
        `SELECT payload_json FROM audit_events
         WHERE interview_id = ? AND event_type = 'TURN_PROCESSING_FAILED'`,
      )
      .get(created.session.id);
    expect(String(audit?.payload_json)).toContain("ClaudeProviderError");
    expect(String(audit?.payload_json)).toContain("ANTHROPIC_TIMEOUT");
    expect(String(audit?.payload_json)).not.toContain("sk-ant");
    expect(String(audit?.payload_json)).not.toContain("raw error");

    await expect(
      service.addMessageCommandAsync(
        created.session.id,
        { ...command, text: "같은 ID에 다른 본문" },
        principal,
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED", status: 409 });
    expect(providerCalls).toBe(1);

    const retry = await service.addMessageCommandAsync(created.session.id, command, principal);
    expect(retry.processing).toMatchObject({
      status: "APPLIED",
      code: null,
      metadata: { provider: "anthropic", requestId: "req-retry-success" },
    });
    expect(retry.snapshot.session.version).toBe(created.session.version + 1);
    expect(providerCalls).toBe(2);
    expect(
      database
        .prepare("SELECT status, failure_code FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id),
    ).toEqual({ status: "APPLIED", failure_code: null });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("uses expected version/question CAS after the network await and keeps the staged transcript on conflict", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let interviewId = "";
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-11T03:02:00.000Z"),
      idFactory: () => `async-cas-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          expect(database.isTransaction).toBe(false);
          database
            .prepare("UPDATE interviews SET version = version + 1 WHERE id = ?")
            .run(interviewId);
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-raced",
              inputTokens: 10,
              outputTokens: 20,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    interviewId = created.session.id;
    const command = commandFor(created, "async-cas-command");

    const result = await service.addMessageCommandAsync(interviewId, command, principal);

    expect(result.processing).toMatchObject({
      status: "NON_RETRYABLE_FAILURE",
      code: "TURN_PROCESSING_REJECTED",
      metadata: { provider: "anthropic", requestId: "req-raced" },
    });
    expect(result.snapshot.session.version).toBe(created.session.version + 1);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER' AND confirmation = 'FINAL'`,
        )
        .get(interviewId)?.count,
    ).toBe(1);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM evidence_refs WHERE transcript_segment_id = ?")
        .get(result.acceptedTranscript.id)?.count,
    ).toBe(0);
  });

  it("reuses a pending transcript after a process-restart-equivalent service recreation", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    const repository = new InterviewRepository(database);
    let firstId = 0;
    let firstProviderCalls = 0;
    const firstService = new InterviewService(repository, {
      idFactory: () => `async-restart-first-${++firstId}`,
      asyncTurnPlanner: {
        plan: async () => {
          firstProviderCalls += 1;
          throw new SyntheticRetryableClaudeError("CLAUDE_NETWORK_ERROR");
        },
      },
    });
    const created = firstService.createInterview(principal);
    const command = commandFor(created, "async-restart-command");
    const failed = await firstService.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    expect(failed.processing.status).toBe("RETRYABLE_FAILURE");
    expect(firstProviderCalls).toBe(1);
    const hydrated = firstService.getInterviewSnapshot(created.session.id, principal);
    expect(hydrated).toMatchObject({
      snapshotType: "PREVIEW",
      pendingCommand: {
        clientMessageId: command.clientMessageId,
        text: command.text,
        expectedVersion: command.expectedVersion,
        currentQuestionInfoCode: command.currentQuestionInfoCode,
        transcriptMetadata: null,
        processingState: "READY",
      },
    });
    await expect(
      firstService.addMessageCommandAsync(
        created.session.id,
        { ...command, clientMessageId: "async-restart-new-command" },
        principal,
      ),
    ).rejects.toMatchObject({ status: 409, code: "MESSAGE_STAGE_PENDING" });
    expect(firstProviderCalls).toBe(1);

    let secondId = 0;
    let secondProviderCalls = 0;
    const restartedService = new InterviewService(repository, {
      idFactory: () => `async-restart-second-${++secondId}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          secondProviderCalls += 1;
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-after-restart",
              inputTokens: 11,
              outputTokens: 22,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const applied = await restartedService.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );

    expect(applied.processing.status).toBe("APPLIED");
    expect(secondProviderCalls).toBe(1);
    expect(applied.acceptedTranscript.id).toBe(failed.acceptedTranscript.id);
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
        .prepare("SELECT status FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id)?.status,
    ).toBe("APPLIED");
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("deduplicates concurrent explicit retries of one pending stage before the paid provider call", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let providerCalls = 0;
    let releaseProvider: (() => void) | undefined;
    let markProviderStarted: (() => void) | undefined;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `async-dedupe-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          providerCalls += 1;
          if (providerCalls === 1) throw new SyntheticRetryableClaudeError();
          markProviderStarted?.();
          await providerGate;
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-4-5",
              requestId: "req-deduped",
              inputTokens: 12,
              outputTokens: 34,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    const command = commandFor(created, "async-concurrent-command");

    const failed = await service.addMessageCommandAsync(created.session.id, command, principal);
    expect(failed.processing.status).toBe("RETRYABLE_FAILURE");
    expect(providerCalls).toBe(1);
    const first = service.addMessageCommandAsync(created.session.id, command, principal);
    const second = service.addMessageCommandAsync(created.session.id, command, principal);
    await providerStarted;
    expect(providerCalls).toBe(2);
    releaseProvider?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toEqual(firstResult);
    expect(firstResult.processing.status).toBe("APPLIED");
    expect(providerCalls).toBe(2);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("uses a database lease so two service instances cannot pay for the same retry", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    const repository = new InterviewRepository(database);
    let bootstrapId = 0;
    const bootstrap = new InterviewService(repository, {
      idFactory: () => `async-lease-bootstrap-${++bootstrapId}`,
      asyncTurnPlanner: {
        plan: async () => {
          throw new SyntheticRetryableClaudeError();
        },
      },
    });
    const created = bootstrap.createInterview(principal);
    const command = commandFor(created, "async-cross-instance-command");
    const failed = await bootstrap.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    expect(failed.processing.status).toBe("RETRYABLE_FAILURE");

    let providerCalls = 0;
    let markStarted: (() => void) | undefined;
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const planner = {
      plan: async (input: Parameters<typeof planDeterministicInterviewTurn>[0]) => {
        providerCalls += 1;
        markStarted?.();
        await gate;
        return {
          plan: planDeterministicInterviewTurn(input),
          metadata: {
            provider: "anthropic",
            model: "claude-sonnet-5",
            requestId: "req-cross-instance",
            inputTokens: 10,
            outputTokens: 20,
            stopReason: "tool_use",
          },
        };
      },
    };
    let firstId = 0;
    let secondId = 0;
    const firstService = new InterviewService(repository, {
      idFactory: () => `async-lease-first-${++firstId}`,
      asyncTurnPlanner: planner,
    });
    const secondService = new InterviewService(repository, {
      idFactory: () => `async-lease-second-${++secondId}`,
      asyncTurnPlanner: planner,
    });

    const first = firstService.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    await started;
    await expect(
      secondService.addMessageCommandAsync(
        created.session.id,
        { ...command, clientMessageId: "async-cross-instance-different-command" },
        principal,
      ),
    ).rejects.toMatchObject({ status: 409, code: "MESSAGE_STAGE_PENDING" });
    await expect(
      secondService.addMessageCommandAsync(
        created.session.id,
        command,
        principal,
      ),
    ).rejects.toMatchObject({ status: 409, code: "MESSAGE_STAGE_BUSY" });
    expect(providerCalls).toBe(1);
    expect(() =>
      secondService.completeInterviewCommand(
        created.session.id,
        {
          clientCommandId: "async-complete-while-claimed",
          expectedVersion: created.session.version,
          mode: "FORCE_INCOMPLETE",
          borrowerConfirmed: false,
          reason: "operator requested interruption",
        },
        principal,
      ),
    ).toThrowError(expect.objectContaining({
      status: 409,
      code: "PENDING_MESSAGE_COMMAND",
    }));
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM final_snapshots WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(0);
    release?.();
    const applied = await first;
    expect(applied.processing.status).toBe("APPLIED");
    expect(providerCalls).toBe(1);
    const completed = secondService.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "async-complete-after-apply",
        expectedVersion: applied.snapshot.session.version,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: false,
        reason: "operator requested interruption",
      },
      principal,
    );
    expect(completed.snapshot.snapshotType).toBe("FINAL");
  });

  it("receipt-caches a non-retryable Claude rejection without another provider call", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let providerCalls = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `async-terminal-${++id}`,
      asyncTurnPlanner: {
        plan: async () => {
          providerCalls += 1;
          const error = new Error("synthetic invalid structured output") as Error & {
            code: string;
            retryable: boolean;
          };
          error.name = "ClaudeProviderError";
          error.code = "CLAUDE_RESPONSE_INVALID";
          error.retryable = false;
          throw error;
        },
      },
    });
    const created = service.createInterview(principal);
    const command = commandFor(created, "async-terminal-command");

    const first = await service.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    expect(first.processing).toEqual({
      status: "NON_RETRYABLE_FAILURE",
      code: "TURN_PROCESSING_REJECTED",
    });
    expect(first.snapshot.pendingCommand).toBeNull();
    expect(
      database
        .prepare("SELECT status, failure_code FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id),
    ).toEqual({ status: "FAILED", failure_code: "TURN_PROCESSING_REJECTED" });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM command_receipts WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);

    const duplicate = await service.addMessageCommandAsync(
      created.session.id,
      command,
      principal,
    );
    expect(duplicate).toEqual(first);
    expect(providerCalls).toBe(1);
  });

  it("serializes different message IDs per interview so only the first same-version command reaches the provider", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    let providerCalls = 0;
    let markProviderStarted: (() => void) | undefined;
    let releaseProvider: (() => void) | undefined;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `async-interview-queue-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          providerCalls += 1;
          markProviderStarted?.();
          await providerGate;
          return {
            plan: planDeterministicInterviewTurn(input),
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-5",
              requestId: "req-serialized-first",
              inputTokens: 12,
              outputTokens: 34,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(principal);
    const firstCommand = commandFor(created, "async-queue-first");
    const secondCommand = commandFor(created, "async-queue-second");

    const first = service.addMessageCommandAsync(
      created.session.id,
      firstCommand,
      principal,
    );
    await providerStarted;
    const second = service.addMessageCommandAsync(
      created.session.id,
      secondCommand,
      principal,
    );
    expect(providerCalls).toBe(1);
    releaseProvider?.();
    const [firstSettled, secondSettled] = await Promise.allSettled([first, second]);

    expect(firstSettled.status).toBe("fulfilled");
    expect(secondSettled.status).toBe("rejected");
    if (secondSettled.status !== "rejected") throw new Error("second command unexpectedly applied");
    expect(secondSettled.reason).toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
    });
    expect(providerCalls).toBe(1);
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
        .prepare("SELECT COUNT(*) AS count FROM message_command_stages WHERE interview_id = ?")
        .get(created.session.id)?.count,
    ).toBe(1);
  });

  it("rejects a pending stage that became stale after another command without another provider call", async () => {
    const scenario = await createStalePendingScenario("async-stale-stage");
    expect(scenario.failed.processing.status).toBe("RETRYABLE_FAILURE");
    expect(scenario.providerCalls()).toBe(1);

    await expect(
      scenario.service.addMessageCommandAsync(
        scenario.created.session.id,
        scenario.pendingCommand,
        principal,
      ),
    ).rejects.toMatchObject({ status: 409, code: "MESSAGE_STAGE_STALE" });
    expect(scenario.providerCalls()).toBe(1);
    expect(
      scenario.database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(scenario.created.session.id)?.count,
    ).toBe(1);
  });

  it("rejects every repeated retry of one stale pending stage before the provider", async () => {
    const scenario = await createStalePendingScenario("async-stale-repeat");
    const paidCallsBeforeRetries = scenario.providerCalls();
    const transcriptCountBeforeRetries = scenario.database
      .prepare(
        `SELECT COUNT(*) AS count FROM transcript_segments
         WHERE interview_id = ? AND speaker = 'BORROWER'`,
      )
      .get(scenario.created.session.id)?.count;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        scenario.service.addMessageCommandAsync(
          scenario.created.session.id,
          scenario.pendingCommand,
          principal,
        ),
      ).rejects.toMatchObject({ status: 409, code: "MESSAGE_STAGE_STALE" });
    }

    expect(scenario.providerCalls()).toBe(paidCallsBeforeRetries);
    expect(
      scenario.database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(scenario.created.session.id)?.count,
    ).toBe(transcriptCountBeforeRetries);
  });

  it("rolls the transcript back if atomic command staging cannot be inserted", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `async-atomic-${++id}`,
    });
    const created = service.createInterview(principal);
    database.exec(`
      CREATE TRIGGER reject_test_message_stage
      BEFORE INSERT ON message_command_stages
      BEGIN
        SELECT RAISE(ABORT, 'synthetic stage rejection');
      END;
    `);

    await expect(
      service.addMessageCommandAsync(
        created.session.id,
        commandFor(created, "async-atomic-command"),
        principal,
      ),
    ).rejects.toThrow(/synthetic stage rejection/);
    expect(
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM transcript_segments
           WHERE interview_id = ? AND speaker = 'BORROWER'`,
        )
        .get(created.session.id)?.count,
    ).toBe(0);
  });
});
