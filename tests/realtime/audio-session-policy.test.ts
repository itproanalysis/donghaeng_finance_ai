import { describe, expect, it } from "vitest";

import {
  assertAudioFinalizationActive,
  cancelAudioOperationImmediately,
  endTurnWithFailureCleanup,
  shouldCancelAudioOperationOnSocketClose,
} from "../../src/realtime/server/audio-session-lifecycle";
import {
  audioPrincipalOwnershipKey,
  assertAudioSessionStartAllowed,
  assertSafeAudioControlIdentifier,
  encodedAudioInterviewIdFromPath,
  MAX_AUDIO_CONNECTIONS_PER_CLIENT,
  MAX_RESUMABLE_AUDIO_SESSIONS,
  MAX_RESUMABLE_AUDIO_SESSIONS_PER_PRINCIPAL,
} from "../../src/realtime/server/audio-session-policy";
import {
  StreamingSttError,
  type StreamingSttSession,
} from "../../src/realtime/server/stt-adapter";

describe("audio session server policy", () => {
  it("routes only audio upgrade paths and leaves Next HMR upgrades untouched", () => {
    expect(encodedAudioInterviewIdFromPath("/_next/hmr")).toBeNull();
    expect(encodedAudioInterviewIdFromPath("/_next/webpack-hmr")).toBeNull();
    expect(encodedAudioInterviewIdFromPath(
      "/ws/interviews/interview%2D01/audio",
    )).toBe("interview%2D01");
  });

  it("keys ownership by the authenticated principal, not the raw Cookie header", () => {
    const principal = { tenantId: "tenant-1", userId: "user-1" };
    const samePrincipalWithUnrelatedCookieMaterial = {
      ...principal,
      cookie: "donghaeng_session=token; analytics=changed",
    };
    expect(audioPrincipalOwnershipKey(principal)).toBe(
      audioPrincipalOwnershipKey(samePrincipalWithUnrelatedCookieMaterial),
    );
    expect(audioPrincipalOwnershipKey(principal)).not.toBe(
      audioPrincipalOwnershipKey({ tenantId: "tenant-1", userId: "user-2" }),
    );
    expect(audioPrincipalOwnershipKey(principal)).not.toBe(
      audioPrincipalOwnershipKey({ tenantId: "tenant-2", userId: "user-1" }),
    );
  });

  it("accepts bounded ASCII identifiers and rejects unsafe identifiers", () => {
    expect(() => assertSafeAudioControlIdentifier(
      "audio_01-uuid.part:1",
      "audioSessionId",
    )).not.toThrow();
    expect(() => assertSafeAudioControlIdentifier(
      `a${"x".repeat(128)}`,
      "audioSessionId",
    )).toThrow("audioSessionId");
    expect(() => assertSafeAudioControlIdentifier(
      "audio\nforged",
      "audioSessionId",
    )).toThrow("audioSessionId");
    expect(() => assertSafeAudioControlIdentifier(
      "세션-1",
      "audioSessionId",
    )).toThrow("audioSessionId");
  });

  it("rejects a different start while the socket owns an active session", () => {
    expect(() => assertAudioSessionStartAllowed({
      currentAudioSessionId: "audio-a",
      hasActiveSession: true,
      requestedAudioSessionId: "audio-b",
      requestedSessionExists: false,
      resumableSessionCount: 1,
    })).toThrowError(expect.objectContaining({
      code: "AUDIO_SESSION_ALREADY_ACTIVE",
      retryable: false,
    }));
  });

  it("caps new resumable sessions while allowing an existing resume", () => {
    expect(() => assertAudioSessionStartAllowed({
      currentAudioSessionId: null,
      hasActiveSession: false,
      requestedAudioSessionId: "new-session",
      requestedSessionExists: false,
      resumableSessionCount: MAX_RESUMABLE_AUDIO_SESSIONS,
    })).toThrowError(expect.objectContaining({
      code: "AUDIO_SESSION_CAPACITY_EXCEEDED",
      retryable: true,
    }));
    expect(() => assertAudioSessionStartAllowed({
      currentAudioSessionId: null,
      hasActiveSession: false,
      requestedAudioSessionId: "existing-session",
      requestedSessionExists: true,
      resumableSessionCount: MAX_RESUMABLE_AUDIO_SESSIONS,
    })).not.toThrow();
  });

  it("rejects a duplicate start while that session ID is being reserved", () => {
    expect(() => assertAudioSessionStartAllowed({
      currentAudioSessionId: null,
      hasActiveSession: false,
      requestedAudioSessionId: "pending-session",
      requestedSessionExists: false,
      requestedSessionPending: true,
      resumableSessionCount: 1,
    })).toThrowError(expect.objectContaining({
      code: "AUDIO_SESSION_START_IN_PROGRESS",
      retryable: true,
    }));
  });

  it("allows five concurrent demo sessions and caps the sixth consistently", () => {
    expect(MAX_AUDIO_CONNECTIONS_PER_CLIENT).toBe(5);
    expect(MAX_RESUMABLE_AUDIO_SESSIONS_PER_PRINCIPAL).toBe(5);
    expect(() => assertAudioSessionStartAllowed({
      currentAudioSessionId: null,
      hasActiveSession: false,
      requestedAudioSessionId: "fifth-session",
      requestedSessionExists: false,
      resumableSessionCount: 4,
      principalSessionCount: 4,
    })).not.toThrow();
    expect(() => assertAudioSessionStartAllowed({
      currentAudioSessionId: null,
      hasActiveSession: false,
      requestedAudioSessionId: "sixth-session",
      requestedSessionExists: false,
      resumableSessionCount: 5,
      principalSessionCount: 5,
    })).toThrowError(expect.objectContaining({
      code: "AUDIO_CLIENT_SESSION_CAPACITY_EXCEEDED",
      retryable: true,
    }));
  });
});

describe("audio session failure cleanup", () => {
  it("cancels a transcribing session on socket close instead of retaining it", () => {
    expect(shouldCancelAudioOperationOnSocketClose({
      endTurnRequested: true,
      finalized: false,
      receivedAudioFrame: true,
    })).toBe(true);
    expect(shouldCancelAudioOperationOnSocketClose({
      endTurnRequested: false,
      finalized: false,
      receivedAudioFrame: true,
    })).toBe(false);
    expect(shouldCancelAudioOperationOnSocketClose({
      endTurnRequested: true,
      finalized: true,
      receivedAudioFrame: true,
    })).toBe(false);
  });

  it("aborts an in-flight end turn immediately and rejects a late final callback", async () => {
    const operationController = new AbortController();
    let currentController: AbortController | null = operationController;
    let releaseProvider: (() => void) | undefined;
    let notifyEndTurnStarted: (() => void) | undefined;
    let persisted = false;
    let stopped = false;
    const providerResult = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const endTurnStarted = new Promise<void>((resolve) => {
      notifyEndTurnStarted = resolve;
    });
    const session = {
      providerLabel: "test",
      start: async () => undefined,
      pushAudio: async () => undefined,
      pause: async () => undefined,
      resume: async () => undefined,
      endTurn: async () => {
        notifyEndTurnStarted?.();
        await providerResult;
        assertAudioFinalizationActive({
          expectedController: operationController,
          currentController,
          signal: operationController.signal,
        });
        persisted = true;
      },
      stop: async () => {
        stopped = true;
      },
    } satisfies StreamingSttSession;

    const ending = endTurnWithFailureCleanup(session, () => {
      currentController = null;
    });
    const rejected = expect(ending).rejects.toMatchObject({
      code: "STT_SESSION_STOPPED",
      retryable: false,
    });
    await endTurnStarted;
    currentController = null;
    const stopping = cancelAudioOperationImmediately(
      operationController,
      session,
    );
    expect(operationController.signal.aborted).toBe(true);
    releaseProvider?.();
    await stopping;
    await rejected;
    expect(stopped).toBe(true);
    expect(persisted).toBe(false);
  });

  it("runs cleanup and preserves the provider failure", async () => {
    const providerFailure = new StreamingSttError(
      "STT_PROVIDER_TIMEOUT",
      "provider timeout",
      true,
    );
    let cleaned = false;
    const session = {
      providerLabel: "test",
      start: async () => undefined,
      pushAudio: async () => undefined,
      pause: async () => undefined,
      resume: async () => undefined,
      endTurn: async () => {
        throw providerFailure;
      },
      stop: async () => undefined,
    } satisfies StreamingSttSession;

    await expect(endTurnWithFailureCleanup(session, async () => {
      cleaned = true;
    })).rejects.toBe(providerFailure);
    expect(cleaned).toBe(true);
  });

  it("preserves the provider failure even when cleanup also fails", async () => {
    const providerFailure = new Error("provider failed");
    const session = {
      providerLabel: "test",
      start: async () => undefined,
      pushAudio: async () => undefined,
      pause: async () => undefined,
      resume: async () => undefined,
      endTurn: async () => {
        throw providerFailure;
      },
      stop: async () => undefined,
    } satisfies StreamingSttSession;

    await expect(endTurnWithFailureCleanup(session, async () => {
      throw new Error("cleanup failed");
    })).rejects.toBe(providerFailure);
  });
});
