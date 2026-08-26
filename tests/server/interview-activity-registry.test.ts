import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import {
  createInMemoryDatabase,
  openDatabase,
} from "../../src/server/database";
import { ApplicationError } from "../../src/server/errors";
import {
  AudioTurnLeaseConflictError,
  InterviewActivityRegistry,
} from "../../src/server/interview-activity-registry";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];
const directories: string[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory && resolve(directory).startsWith(resolve(tmpdir()))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("durable interview activity completion gate", () => {
  it("tracks active/pending leases with owner-CAS cleanup and tenant isolation", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `lease-registry-${++id}`,
    });
    const created = service.createInterview(principal);
    const firstRegistry = new InterviewActivityRegistry(database, 1_000);
    const secondRegistry = new InterviewActivityRegistry(database, 1_000);
    const firstOwner = {
      tenantId: principal.tenantId,
      interviewId: created.session.id,
      audioSessionId: "audio-1",
      ownerToken: "worker-a",
    };
    const secondOwner = { ...firstOwner, ownerToken: "worker-b" };

    firstRegistry.beginTurn(firstOwner, "2026-08-10T00:00:00.000Z");
    expect(() =>
      secondRegistry.beginTurn(secondOwner, "2026-08-10T00:00:00.500Z"),
    ).toThrow(AudioTurnLeaseConflictError);
    firstRegistry.markFinalTranscriptPending(
      firstOwner,
      "2026-08-10T00:00:00.600Z",
    );
    expect(secondRegistry.snapshot(
      principal.tenantId,
      created.session.id,
      "2026-08-10T00:00:01.000Z",
    )).toEqual({
      activeTurn: true,
      finalTranscriptPending: true,
      activeAudioSessionIds: ["audio-1"],
      pendingAudioSessionIds: ["audio-1"],
    });

    expect(secondRegistry.snapshot(
      "another-tenant",
      created.session.id,
      "2026-08-10T00:00:01.000Z",
    ).activeTurn).toBe(false);
    expect(() =>
      firstRegistry.beginTurn(
        { ...firstOwner, tenantId: "another-tenant", audioSessionId: "audio-x" },
        "2026-08-10T00:00:01.000Z",
      ),
    ).toThrow(AudioTurnLeaseConflictError);

    secondRegistry.beginTurn(secondOwner, "2026-08-10T00:00:01.601Z");
    firstRegistry.finishTurn(firstOwner);
    expect(secondRegistry.snapshot(
      principal.tenantId,
      created.session.id,
      "2026-08-10T00:00:01.700Z",
    ).activeAudioSessionIds).toEqual(["audio-1"]);
    secondRegistry.finishTurn(secondOwner);
    secondRegistry.finishTurn(secondOwner);
    expect(secondRegistry.snapshot(
      principal.tenantId,
      created.session.id,
      "2026-08-10T00:00:01.700Z",
    ).activeTurn).toBe(false);
  });

  it("blocks COMPLETE and FORCE on a second DB instance, then recovers after TTL", () => {
    const directory = mkdtempSync(join(tmpdir(), "donghaeng-audio-lease-"));
    directories.push(directory);
    const databasePath = join(directory, "shared.db");
    const websocketDatabase = openDatabase(databasePath);
    const httpDatabase = openDatabase(databasePath);
    databases.push(websocketDatabase, httpDatabase);
    let id = 0;
    let clock = "2026-08-10T00:00:00.000Z";
    const setupService = new InterviewService(
      new InterviewRepository(websocketDatabase),
      { idFactory: () => `multi-instance-lease-${++id}` },
    );
    const created = setupService.createInterview(principal);
    const websocketRegistry = new InterviewActivityRegistry(
      websocketDatabase,
      1_000,
    );
    websocketRegistry.beginTurn(
      {
        tenantId: principal.tenantId,
        interviewId: created.session.id,
        audioSessionId: "cross-instance-audio",
        ownerToken: "websocket-worker",
      },
      clock,
    );
    websocketRegistry.markFinalTranscriptPending(
      {
        tenantId: principal.tenantId,
        interviewId: created.session.id,
        audioSessionId: "cross-instance-audio",
        ownerToken: "websocket-worker",
      },
      clock,
    );
    const completionService = new InterviewService(
      new InterviewRepository(httpDatabase),
      {
        now: () => new Date(clock),
        idFactory: () => `multi-instance-completion-${++id}`,
      },
    );

    for (const [clientCommandId, mode, reason] of [
      ["strict-during-audio", "COMPLETE", null],
      ["force-during-audio", "FORCE_INCOMPLETE", "차주가 중단을 요청함"],
    ] as const) {
      let caught: unknown;
      try {
        completionService.completeInterviewCommand(
          created.session.id,
          {
            clientCommandId,
            expectedVersion: created.session.version,
            mode,
            borrowerConfirmed: true,
            reason,
          },
          principal,
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ApplicationError);
      expect(caught).toMatchObject({
        code: "COMPLETION_BLOCKED",
        details: {
          blockers: expect.arrayContaining([
            expect.objectContaining({ code: "ACTIVE_TURN" }),
            expect.objectContaining({ code: "FINAL_TRANSCRIPT_PENDING" }),
          ]),
        },
      });
    }

    clock = "2026-08-10T00:00:01.001Z";
    const completed = completionService.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "force-after-crash-expiry",
        expectedVersion: created.session.version,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: true,
        reason: "음성 작업자 장애 후 lease 만료",
      },
      principal,
    );
    expect(completed.snapshot.completionStatus).toBe("INCOMPLETE");
    expect(() =>
      websocketRegistry.beginTurn(
        {
          tenantId: principal.tenantId,
          interviewId: created.session.id,
          audioSessionId: "post-final-audio",
          ownerToken: "late-websocket-worker",
        },
        "2026-08-10T00:00:01.100Z",
      ),
    ).toThrow(AudioTurnLeaseConflictError);
  });

  it("keeps completion blocked until delayed final-turn work settles", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.500Z"),
      idFactory: () => `delayed-final-turn-${++id}`,
    });
    const created = service.createInterview(principal);
    const registry = new InterviewActivityRegistry(database, 10_000);
    const identity = {
      tenantId: principal.tenantId,
      interviewId: created.session.id,
      audioSessionId: "delayed-final-audio",
      ownerToken: "websocket-final-worker",
    };
    registry.beginTurn(identity, "2026-08-10T00:00:00.000Z");
    registry.markFinalTranscriptPending(identity, "2026-08-10T00:00:00.100Z");
    let releasePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve;
    });
    const delayedFinalization = (async () => {
      await persistence;
      registry.finishTurn(identity);
    })();

    expect(() =>
      service.completeInterviewCommand(
        created.session.id,
        {
          clientCommandId: "force-before-final-route-settles",
          expectedVersion: created.session.version,
          mode: "FORCE_INCOMPLETE",
          borrowerConfirmed: true,
          reason: "지연 중 완료 시도",
        },
        principal,
      ),
    ).toThrow(expect.objectContaining({ code: "COMPLETION_BLOCKED" }));

    releasePersistence();
    await delayedFinalization;
    const completed = service.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "force-after-final-route-settles",
        expectedVersion: created.session.version,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: true,
        reason: "지연 작업 완료 후 종료",
      },
      principal,
    );
    expect(completed.snapshot.completionStatus).toBe("INCOMPLETE");
  });
});
