import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  AuthService,
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";
import { PlatformRepository } from "../../src/server/platform-repository";
import { RetentionService } from "../../src/server/retention-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 데모 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

afterEach(() => {
  while (databases.length) databases.pop()?.close();
});

describe("retention enforcement", () => {
  it("supports dry-run and purges only enabled expired artifacts", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `retention-${++id}`,
    });
    const created = service.createInterview(principal);
    new AuthService(database, () => new Date("2026-08-10T00:00:00.000Z")).bootstrapLocalWorkspace();
    const retention = new RetentionService(
      database,
      () => new Date("2030-08-10T00:00:00.000Z"),
      () => `retention-run-${++id}`,
    );

    const dryRun = retention.enforce(true);
    expect(dryRun.candidates.authSessions).toBeGreaterThan(0);
    expect(dryRun.candidates.outboxEvents).toBeGreaterThan(0);
    expect(dryRun.deleted).toEqual({ authSessions: 0, outboxEvents: 0 });

    const purge = retention.enforce(false);
    expect(purge.deleted.authSessions).toBe(dryRun.candidates.authSessions);
    expect(purge.deleted.outboxEvents).toBe(dryRun.candidates.outboxEvents);
    expect(database.prepare("SELECT COUNT(*) AS count FROM transcript_segments").get()?.count).toBe(
      1,
    );
    expect(database.prepare("SELECT COUNT(*) AS count FROM evidence_refs").get()?.count).toBe(0);
    expect(
      new PlatformRepository(database).getReplayBounds(principal.tenantId, created.session.id),
    ).toEqual({
      minimumAvailable: created.session.lastEventSeq + 1,
      lastEventSeq: created.session.lastEventSeq,
    });
  });

  it("keeps FINAL snapshots protected from retention deletion", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `final-retention-${++id}`,
    });
    const created = service.createInterview(principal);
    service.completeInterviewCommand(
      created.session.id,
      {
        clientCommandId: "retention-complete",
        expectedVersion: 1,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: false,
        reason: "보존 테스트 중단",
      },
      principal,
    );

    new RetentionService(database, () => new Date("2030-08-10T00:00:00.000Z")).enforce(
      false,
    );
    expect(database.prepare("SELECT COUNT(*) AS count FROM final_snapshots").get()?.count).toBe(1);
    expect(() => database.prepare("DELETE FROM final_snapshots").run()).toThrow(/immutable/i);
  });
});
