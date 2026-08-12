import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { Principal } from "./auth";
import { ApplicationError } from "./errors";
import { PlatformRepository } from "./platform-repository";

export const CONSENT_PURPOSES = [
  "MICROPHONE_INTERVIEW",
  "RAW_AUDIO_STORAGE",
  "CLOUD_AI_PROCESSING",
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export interface ConsentDecisionCommand {
  purpose: ConsentPurpose;
  consentVersion: string;
  granted: boolean;
  expiresAt: string | null;
}

export interface ConsentDecisionView extends ConsentDecisionCommand {
  id: string;
  interviewId: string;
  userId: string;
  grantedAt: string;
  revokedAt: string | null;
  effective: boolean;
}

function mapDecision(row: Record<string, unknown>, now: string): ConsentDecisionView {
  const expiresAt = row.expires_at === null ? null : String(row.expires_at);
  const revokedAt = row.revoked_at === null ? null : String(row.revoked_at);
  const granted = Number(row.granted) === 1;
  return {
    id: String(row.id),
    interviewId: String(row.interview_id),
    userId: String(row.user_id),
    purpose: String(row.purpose) as ConsentPurpose,
    consentVersion: String(row.consent_version),
    granted,
    grantedAt: String(row.granted_at),
    revokedAt,
    expiresAt,
    effective: granted && revokedAt === null && (expiresAt === null || expiresAt > now),
  };
}

export class ConsentService {
  private readonly platform: PlatformRepository;

  constructor(
    readonly database: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {
    this.platform = new PlatformRepository(database);
  }

  record(
    interviewId: string,
    command: ConsentDecisionCommand,
    principal: Principal,
  ): ConsentDecisionView {
    this.platform.getInterviewAggregate(principal.tenantId, interviewId);
    if (!CONSENT_PURPOSES.includes(command.purpose)) {
      throw new ApplicationError(400, "INVALID_CONSENT_PURPOSE", "동의 목적이 올바르지 않습니다.");
    }
    const consentVersion = command.consentVersion.trim();
    if (!consentVersion || consentVersion.length > 64) {
      throw new ApplicationError(400, "INVALID_CONSENT_VERSION", "동의 문서 버전이 올바르지 않습니다.");
    }
    if (typeof command.granted !== "boolean") {
      throw new ApplicationError(400, "INVALID_CONSENT_DECISION", "granted boolean 값이 필요합니다.");
    }
    const now = this.now().toISOString();
    let expiresAt: string | null = null;
    if (command.expiresAt !== null) {
      const parsed = new Date(command.expiresAt);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() <= now) {
        throw new ApplicationError(400, "INVALID_CONSENT_EXPIRY", "expiresAt은 미래의 ISO 시각이어야 합니다.");
      }
      expiresAt = parsed.toISOString();
    }
    const id = this.idFactory();
    this.database
      .prepare(
        `INSERT INTO consent_records(
          id, tenant_id, user_id, interview_id, purpose, consent_version,
          granted, granted_at, revoked_at, expires_at, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        principal.tenantId,
        principal.userId,
        interviewId,
        command.purpose,
        consentVersion,
        command.granted ? 1 : 0,
        now,
        command.granted ? null : now,
        expiresAt,
        JSON.stringify({ collectionMode: "LOCAL_WORKSPACE", rawAudioDefault: false }),
      );
    return this.getLatest(interviewId, command.purpose, principal) as ConsentDecisionView;
  }

  list(interviewId: string, principal: Principal): {
    interviewId: string;
    decisions: Record<ConsentPurpose, ConsentDecisionView | null>;
    microphoneEnabled: boolean;
    rawAudioStorageEnabled: boolean;
    cloudAiProcessingEnabled: boolean;
  } {
    this.platform.getInterviewAggregate(principal.tenantId, interviewId);
    const microphone = this.getLatest(interviewId, "MICROPHONE_INTERVIEW", principal);
    const rawAudio = this.getLatest(interviewId, "RAW_AUDIO_STORAGE", principal);
    const cloudAi = this.getLatest(interviewId, "CLOUD_AI_PROCESSING", principal);
    return {
      interviewId,
      decisions: {
        MICROPHONE_INTERVIEW: microphone,
        RAW_AUDIO_STORAGE: rawAudio,
        CLOUD_AI_PROCESSING: cloudAi,
      },
      microphoneEnabled: microphone?.effective ?? false,
      rawAudioStorageEnabled: rawAudio?.effective ?? false,
      cloudAiProcessingEnabled: cloudAi?.effective ?? false,
    };
  }

  hasEffectiveConsent(
    interviewId: string,
    purpose: ConsentPurpose,
    principal: Principal,
  ): boolean {
    return this.getLatest(interviewId, purpose, principal)?.effective ?? false;
  }

  assertEffectiveConsent(
    interviewId: string,
    purpose: ConsentPurpose,
    principal: Principal,
  ): ConsentDecisionView {
    this.platform.getInterviewAggregate(principal.tenantId, interviewId);
    const decision = this.getLatest(interviewId, purpose, principal);
    if (!decision?.effective) {
      const code = purpose === "MICROPHONE_INTERVIEW"
        ? "MICROPHONE_CONSENT_REQUIRED"
        : purpose === "RAW_AUDIO_STORAGE"
          ? "RAW_AUDIO_STORAGE_CONSENT_REQUIRED"
          : "CLOUD_AI_PROCESSING_CONSENT_REQUIRED";
      throw new ApplicationError(
        403,
        code,
        purpose === "MICROPHONE_INTERVIEW"
          ? "마이크 인터뷰 목적과 처리방식에 대한 현재 동의가 필요합니다."
          : purpose === "RAW_AUDIO_STORAGE"
            ? "원음 저장은 별도의 명시적 동의가 필요합니다."
            : "확정 전사와 현재 인터뷰 정보를 외부 Claude API에서 처리하기 위한 명시적 동의가 필요합니다.",
        { interviewId, purpose },
      );
    }
    return decision;
  }

  private getLatest(
    interviewId: string,
    purpose: ConsentPurpose,
    principal: Principal,
  ): ConsentDecisionView | null {
    const row = this.database
      .prepare(
        `SELECT id, user_id, interview_id, purpose, consent_version, granted,
                granted_at, revoked_at, expires_at
         FROM consent_records
         WHERE tenant_id = ? AND user_id = ? AND interview_id = ? AND purpose = ?
         ORDER BY granted_at DESC, rowid DESC
         LIMIT 1`,
      )
      .get(principal.tenantId, principal.userId, interviewId, purpose);
    return row ? mapDecision(row, this.now().toISOString()) : null;
  }
}
