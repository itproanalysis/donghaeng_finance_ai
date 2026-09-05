import { ApiRequestError, authenticatedFetch, readApiEnvelope } from "./api-adapter";

export async function checkVoiceProcessingConsent(interviewId: string): Promise<void> {
  const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consents?require=CLOUD_AI_PROCESSING`, { cache: "no-store" });
  await readApiEnvelope(response);
}

/** Check on every start; a previous visit must not override revoked consent. */
export async function checkMicrophoneConsent(interviewId: string, grant = false): Promise<void> {
  const path = `/api/interviews/${encodeURIComponent(interviewId)}/consents`;
  const response = await authenticatedFetch(grant ? path : `${path}?require=MICROPHONE_INTERVIEW`, grant ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ purpose: "MICROPHONE_INTERVIEW", consentVersion: "microphone-interview-v1", granted: true, expiresAt: null }),
  } : { cache: "no-store" });
  await readApiEnvelope(response);
}

export function isMicrophoneConsentRequired(error: unknown): boolean {
  return error instanceof ApiRequestError && error.code === "MICROPHONE_CONSENT_REQUIRED";
}

export function voiceConnectionFailure(error: unknown): { message: string; canUseAlternative: boolean } {
  if (error instanceof Error && ["NotAllowedError", "PermissionDeniedError"].includes(error.name)) {
    return { message: "마이크 사용이 허용되지 않았어요. 브라우저 주소창의 마이크 권한을 확인한 뒤 다시 연결하거나 채팅으로 답해 주세요.", canUseAlternative: false };
  }
  if (error instanceof Error && ["NotFoundError", "DevicesNotFoundError"].includes(error.name)) {
    return { message: "연결된 마이크를 찾지 못했어요. 마이크를 연결한 뒤 다시 시도하거나 채팅으로 답해 주세요.", canUseAlternative: false };
  }
  if (error instanceof ApiRequestError) {
    return { message: error.message, canUseAlternative: ![401, 403, 404].includes(error.status ?? 0) };
  }
  return { message: error instanceof Error ? error.message : "음성 연결을 시작하지 못했어요. 다시 시도해 주세요.", canUseAlternative: true };
}
