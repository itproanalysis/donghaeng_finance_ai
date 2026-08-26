import { createHash } from "node:crypto";

import { StreamingSttError } from "./stt-adapter";

export const MAX_RESUMABLE_AUDIO_SESSIONS = 64;
// A single operator may run up to five side-by-side borrower demonstrations.
// Keep the WebSocket and retained-session limits aligned so the fifth session
// is not accepted at upgrade time only to be rejected at audio.start.
export const MAX_AUDIO_CONNECTIONS_PER_CLIENT = 5;
export const MAX_RESUMABLE_AUDIO_SESSIONS_PER_PRINCIPAL = 5;

const SAFE_CONTROL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function encodedAudioInterviewIdFromPath(pathname: string): string | null {
  return pathname.match(/^\/ws\/interviews\/([^/]+)\/audio$/)?.[1] ?? null;
}

export function audioPrincipalOwnershipKey(principal: {
  tenantId: string;
  userId: string;
}): string {
  const tenantId = principal.tenantId.trim();
  const userId = principal.userId.trim();
  if (
    !tenantId ||
    !userId ||
    tenantId.length > 512 ||
    userId.length > 512 ||
    /[\r\n\0]/.test(tenantId) ||
    /[\r\n\0]/.test(userId)
  ) {
    throw new StreamingSttError(
      "AUDIO_PRINCIPAL_INVALID",
      "The authenticated audio principal is invalid.",
      false,
    );
  }
  return createHash("sha256")
    .update(`${tenantId.length}:${tenantId}${userId.length}:${userId}`, "utf8")
    .digest("hex");
}

export function assertSafeAudioControlIdentifier(
  value: string,
  fieldName: "audioSessionId" | "correlationId" | "interviewId",
): void {
  if (!SAFE_CONTROL_IDENTIFIER.test(value)) {
    throw new StreamingSttError(
      "AUDIO_CONTROL_INVALID",
      `${fieldName} 형식이 올바르지 않습니다.`,
      false,
    );
  }
}

export function assertAudioSessionStartAllowed(options: {
  currentAudioSessionId: string | null;
  hasActiveSession: boolean;
  requestedAudioSessionId: string;
  requestedSessionExists: boolean;
  requestedSessionPending?: boolean;
  resumableSessionCount: number;
  principalSessionCount?: number;
}): void {
  if (
    options.hasActiveSession &&
    options.currentAudioSessionId !== options.requestedAudioSessionId
  ) {
    throw new StreamingSttError(
      "AUDIO_SESSION_ALREADY_ACTIVE",
      "현재 오디오 세션을 중지한 뒤 새 세션을 시작해 주세요.",
      false,
    );
  }
  if (options.requestedSessionPending) {
    throw new StreamingSttError(
      "AUDIO_SESSION_START_IN_PROGRESS",
      "같은 오디오 세션의 시작 요청이 이미 처리 중입니다.",
      true,
    );
  }
  if (
    !options.requestedSessionExists &&
    (options.principalSessionCount ?? 0) >=
      MAX_RESUMABLE_AUDIO_SESSIONS_PER_PRINCIPAL
  ) {
    throw new StreamingSttError(
      "AUDIO_CLIENT_SESSION_CAPACITY_EXCEEDED",
      "사용자별 동시 오디오 세션 한도를 초과했습니다.",
      true,
    );
  }
  if (
    !options.requestedSessionExists &&
    options.resumableSessionCount >= MAX_RESUMABLE_AUDIO_SESSIONS
  ) {
    throw new StreamingSttError(
      "AUDIO_SESSION_CAPACITY_EXCEEDED",
      "서버의 동시 오디오 세션 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
      true,
    );
  }
}
