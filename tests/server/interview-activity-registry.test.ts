import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { ApplicationError } from "../../src/server/errors";
import { interviewActivityRegistry } from "../../src/server/interview-activity-registry";
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
  interviewActivityRegistry.resetForTests();
  while (databases.length > 0) databases.pop()?.close();
});

describe("interview activity completion gate", () => {
  it("tracks active and transcript-pending audio sessions independently", () => {
    interviewActivityRegistry.beginTurn("interview-1", "audio-1");
    expect(interviewActivityRegistry.snapshot("interview-1")).toEqual({
      activeTurn: true,
      finalTranscriptPending: false,
      activeAudioSessionIds: ["audio-1"],
      pendingAudioSessionIds: [],
    });

    interviewActivityRegistry.markFinalTranscriptPending("interview-1", "audio-1");
    interviewActivityRegistry.beginTurn("interview-1", "audio-2");
    expect(interviewActivityRegistry.snapshot("interview-1")).toMatchObject({
      activeTurn: true,
      finalTranscriptPending: true,
      activeAudioSessionIds: ["audio-1", "audio-2"],
      pendingAudioSessionIds: ["audio-1"],
    });

    interviewActivityRegistry.finishTurn("interview-1", "audio-1");
    expect(interviewActivityRegistry.snapshot("interview-1")).toMatchObject({
      activeTurn: true,
      finalTranscriptPending: false,
      activeAudioSessionIds: ["audio-2"],
    });
    interviewActivityRegistry.finishTurn("interview-1", "audio-2");
    expect(interviewActivityRegistry.snapshot("interview-1")).toMatchObject({
      activeTurn: false,
      finalTranscriptPending: false,
    });
  });

  it("passes live audio activity into the authoritative completion policy", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `activity-gate-${++id}`,
    });
    const created = service.createInterview(principal);
    interviewActivityRegistry.beginTurn(created.session.id, "audio-active");
    interviewActivityRegistry.markFinalTranscriptPending(
      created.session.id,
      "audio-active",
    );

    let caught: unknown;
    try {
      service.completeInterviewCommand(
        created.session.id,
        {
          clientCommandId: "complete-during-audio",
          expectedVersion: created.session.version,
          mode: "COMPLETE",
          borrowerConfirmed: true,
          reason: null,
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

    expect(() =>
      service.completeInterviewCommand(
        created.session.id,
        {
          clientCommandId: "force-stop-during-audio",
          expectedVersion: created.session.version,
          mode: "FORCE_INCOMPLETE",
          borrowerConfirmed: false,
          reason: "차주가 중단을 요청함",
        },
        principal,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "COMPLETION_BLOCKED",
        details: {
          blockers: expect.arrayContaining([
            expect.objectContaining({ code: "ACTIVE_TURN" }),
            expect.objectContaining({ code: "FINAL_TRANSCRIPT_PENDING" }),
          ]),
        },
      }),
    );
  });
});
