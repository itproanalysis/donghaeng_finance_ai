import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, authenticatedFetch, readApiEnvelope } from "@/components/api-adapter";
import { checkMicrophoneConsent, checkVoiceProcessingConsent, isMicrophoneConsentRequired, voiceConnectionFailure } from "@/components/voice-connection-preflight";

vi.mock("@/components/api-adapter", async (original) => ({
  ...await original<typeof import("@/components/api-adapter")>(),
  authenticatedFetch: vi.fn(),
  readApiEnvelope: vi.fn(),
}));

describe("voice connection consent and recovery", () => {
  beforeEach(() => vi.resetAllMocks());

  it("only checks current consent until the owner explicitly agrees", async () => {
    const denied = new ApiRequestError("동의 필요", [], "MICROPHONE_CONSENT_REQUIRED", 403);
    vi.mocked(readApiEnvelope).mockRejectedValue(denied);
    await expect(checkMicrophoneConsent("chat-first/id")).rejects.toBe(denied);
    expect(authenticatedFetch).toHaveBeenCalledExactlyOnceWith("/api/interviews/chat-first%2Fid/consents?require=MICROPHONE_INTERVIEW", { cache: "no-store" });
    expect(isMicrophoneConsentRequired(denied)).toBe(true);
    expect(voiceConnectionFailure(denied).canUseAlternative).toBe(false);
  });

  it("checks cloud processing separately and never regrants revoked consent implicitly", async () => {
    const denied = new ApiRequestError("AI 처리 동의 필요", [], "CLOUD_AI_PROCESSING_CONSENT_REQUIRED", 403);
    vi.mocked(readApiEnvelope).mockRejectedValue(denied);
    await expect(checkVoiceProcessingConsent("interview-1")).rejects.toBe(denied);
    expect(authenticatedFetch).toHaveBeenCalledExactlyOnceWith("/api/interviews/interview-1/consents?require=CLOUD_AI_PROCESSING", { cache: "no-store" });
    expect(voiceConnectionFailure(denied).canUseAlternative).toBe(false);
  });

  it("records only microphone consent after explicit agreement", async () => {
    await checkMicrophoneConsent("interview-1", true);
    const [path, init] = vi.mocked(authenticatedFetch).mock.calls[0]!;
    expect(path).toBe("/api/interviews/interview-1/consents");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ purpose: "MICROPHONE_INTERVIEW", consentVersion: "microphone-interview-v1", granted: true, expiresAt: null });
  });

  it("rechecks previously granted or subsequently revoked consent on each start", async () => {
    await checkMicrophoneConsent("interview-1");
    await checkMicrophoneConsent("interview-1");
    expect(authenticatedFetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(authenticatedFetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it.each([401, 403, 404])("does not route around an authorization error (%s)", (status) => {
    expect(voiceConnectionFailure(new ApiRequestError("거절", [], "ERROR", status)).canUseAlternative).toBe(false);
  });

  it.each(["NotAllowedError", "PermissionDeniedError", "NotFoundError", "DevicesNotFoundError"])("gives device-specific guidance without falling back: %s", (name) => {
    const error = new Error("provider message"); error.name = name;
    expect(voiceConnectionFailure(error).canUseAlternative).toBe(false);
    expect(voiceConnectionFailure(error).message).toContain("마이크");
  });

  it("allows an explicitly selected alternative for a service outage", () => {
    expect(voiceConnectionFailure(new ApiRequestError("연결 실패", [], "UNAVAILABLE", 503))).toEqual({ message: "연결 실패", canUseAlternative: true });
  });
});
