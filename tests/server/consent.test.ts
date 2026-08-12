import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { ConsentService } from "../../src/server/consent-service";
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

describe("versioned microphone consent", () => {
  it("defaults raw storage off and records append-only grant and revocation decisions", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const interview = new InterviewService(new InterviewRepository(database), {
      now: () => new Date("2026-08-10T00:00:00.000Z"),
      idFactory: () => `consent-interview-${++id}`,
    }).createInterview(principal);
    const consent = new ConsentService(
      database,
      () => new Date("2026-08-10T00:00:00.000Z"),
      () => `consent-decision-${++id}`,
    );

    expect(consent.list(interview.session.id, principal)).toMatchObject({
      microphoneEnabled: false,
      rawAudioStorageEnabled: false,
      cloudAiProcessingEnabled: false,
    });
    expect(() =>
      consent.assertEffectiveConsent(
        interview.session.id,
        "CLOUD_AI_PROCESSING",
        principal,
      ),
    ).toThrow(/Claude API/);
    expect(() =>
      consent.assertEffectiveConsent(
        interview.session.id,
        "MICROPHONE_INTERVIEW",
        principal,
      ),
    ).toThrow(/현재 동의/);
    const granted = consent.record(
      interview.session.id,
      {
        purpose: "MICROPHONE_INTERVIEW",
        consentVersion: "microphone-dev-v1",
        granted: true,
        expiresAt: "2026-08-11T00:00:00.000Z",
      },
      principal,
    );
    expect(granted).toMatchObject({ granted: true, effective: true });
    expect(
      consent.assertEffectiveConsent(
        interview.session.id,
        "MICROPHONE_INTERVIEW",
        principal,
      ).id,
    ).toBe(granted.id);
    expect(consent.list(interview.session.id, principal)).toMatchObject({
      microphoneEnabled: true,
      rawAudioStorageEnabled: false,
      cloudAiProcessingEnabled: false,
    });
    const revoked = consent.record(
      interview.session.id,
      {
        purpose: "MICROPHONE_INTERVIEW",
        consentVersion: "microphone-dev-v1",
        granted: false,
        expiresAt: null,
      },
      principal,
    );
    expect(revoked).toMatchObject({ granted: false, effective: false });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM consent_records").get()?.count,
    ).toBe(2);
    expect(() =>
      database.prepare("DELETE FROM consent_records WHERE id = ?").run(granted.id),
    ).toThrow(/immutable/i);
  });

  it("records a separate versioned cloud-AI processing decision", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const interview = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `cloud-consent-${++id}`,
    }).createInterview(principal);
    const consent = new ConsentService(
      database,
      () => new Date("2026-08-10T00:00:00.000Z"),
      () => `cloud-consent-decision-${++id}`,
    );

    const granted = consent.record(
      interview.session.id,
      {
        purpose: "CLOUD_AI_PROCESSING",
        consentVersion: "cloud-ai-processing-v1",
        granted: true,
        expiresAt: null,
      },
      principal,
    );

    expect(granted).toMatchObject({
      purpose: "CLOUD_AI_PROCESSING",
      consentVersion: "cloud-ai-processing-v1",
      effective: true,
    });
    expect(consent.list(interview.session.id, principal)).toMatchObject({
      microphoneEnabled: false,
      rawAudioStorageEnabled: false,
      cloudAiProcessingEnabled: true,
    });
  });

  it("does not expose decisions across tenant scope", () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    const interview = new InterviewService(
      new InterviewRepository(database),
    ).createInterview(principal);
    const consent = new ConsentService(database);

    expect(() =>
      consent.list(interview.session.id, { ...principal, tenantId: "other-tenant" }),
    ).toThrow(/찾을 수 없습니다/);
  });
});
