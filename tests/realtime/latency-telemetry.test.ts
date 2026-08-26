import { describe, expect, it, vi } from "vitest";

import { RealtimeLatencyTelemetry } from "../../src/realtime/latency-telemetry";

describe("privacy-safe realtime latency telemetry", () => {
  it("measures the live audio and playback boundaries with an injected clock", () => {
    let now = 0;
    const telemetry = new RealtimeLatencyTelemetry({ now: () => now });
    const listener = vi.fn();
    telemetry.subscribe(listener);

    telemetry.beginAudioTurn("private-audio-session-id");
    now = 100;
    telemetry.markSpeechEnded("private-audio-session-id");
    now = 340;
    telemetry.markRecognized("private-audio-session-id", "large-v3-turbo @ 127.0.0.1");
    now = 500;
    telemetry.markProcessingResult("private-audio-session-id", {
      status: "APPLIED",
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      fallback: false,
    });
    now = 570;
    telemetry.markNextQuestionReady();

    now = 600;
    const ttsToken = telemetry.beginTtsRequest("qwen");
    now = 630;
    telemetry.markTtsFirstByte(ttsToken, "qwen");
    now = 680;
    telemetry.markTtsPlaybackStarted(ttsToken, {
      provider: "qwen",
      fallback: false,
    });

    const snapshot = telemetry.getSnapshot();
    expect(snapshot.health).toBe("FAST");
    expect(snapshot.slo).toEqual({ status: "MEETING", breachedPhases: [] });
    expect(snapshot.phases.speechToRecognized).toEqual({
      latestMs: 240,
      p50Ms: 240,
      p95Ms: 240,
      samples: 1,
    });
    expect(snapshot.phases.recognizedToAccepted.latestMs).toBe(160);
    expect(snapshot.phases.acceptedToQuestionReady.latestMs).toBe(70);
    expect(snapshot.phases.speechToQuestionReady.latestMs).toBe(470);
    expect(snapshot.phases.ttsRequestToFirstByte.latestMs).toBe(30);
    expect(snapshot.phases.ttsFirstByteToPlayback.latestMs).toBe(50);
    expect(snapshot.phases.ttsRequestToPlayback.latestMs).toBe(80);
    expect(snapshot.providers).toEqual({
      stt: "로컬 Whisper",
      ai: "Claude",
      model: "Haiku 4.5",
      tts: "Qwen3-TTS",
    });
    expect(snapshot.fallback).toEqual({ ai: false, tts: false });
    expect(listener).toHaveBeenCalled();
  });

  it("uses nearest-rank p50/p95 and keeps only the bounded newest turns", () => {
    let now = 0;
    const telemetry = new RealtimeLatencyTelemetry({
      now: () => now,
      maxSamples: 3,
    });

    for (const [index, latency] of [100, 200, 300, 400, 500].entries()) {
      const key = `turn-${index}`;
      now = index * 1_000;
      telemetry.beginAudioTurn(key);
      telemetry.markSpeechEnded(key);
      now += latency;
      telemetry.markRecognized(key, "whisper");
    }

    const snapshot = telemetry.getSnapshot();
    expect(snapshot.turnSamples).toBe(3);
    expect(snapshot.phases.speechToRecognized).toEqual({
      latestMs: 500,
      p50Ms: 400,
      p95Ms: 500,
      samples: 3,
    });
  });

  it("never exposes correlation ids, raw labels, request ids, text, or audio", () => {
    let now = 10;
    const telemetry = new RealtimeLatencyTelemetry({ now: () => now });
    const secretSession = "audio-session-secret-123";
    telemetry.beginAudioTurn(secretSession);
    telemetry.markSpeechEnded(secretSession);
    now = 20;
    telemetry.markRecognized(secretSession, "private-stt-endpoint-with-tenant-name");
    now = 30;
    telemetry.markProcessingResult(secretSession, {
      status: "RETRYABLE_FAILURE",
      provider: "tenant-provider-secret",
      model: "model-with-user-or-request-id",
      fallback: true,
    });
    const ttsToken = telemetry.beginTtsRequest("private-voice-name");
    telemetry.markTtsFirstByte(ttsToken, "private-voice-name");
    telemetry.markTtsPlaybackStarted(ttsToken, {
      provider: "private-voice-name",
      fallback: true,
    });

    const serialized = JSON.stringify(telemetry.getSnapshot());
    expect(serialized).not.toContain(secretSession);
    expect(serialized).not.toContain("tenant");
    expect(serialized).not.toContain("request");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("text");
    expect(serialized).not.toContain("audio");
    expect(telemetry.getSnapshot().providers).toEqual({
      stt: "STT 연결",
      ai: "AI 연결",
      model: null,
      tts: "TTS 연결",
    });
  });

  it("flags latest user-visible latency when a phase crosses the delay budget", () => {
    let now = 0;
    const telemetry = new RealtimeLatencyTelemetry({ now: () => now });
    telemetry.beginAudioTurn("slow-turn");
    telemetry.markSpeechEnded("slow-turn");
    now = 2_001;
    telemetry.markRecognized("slow-turn", "whisper");

    expect(telemetry.getSnapshot().health).toBe("DELAYED");
    expect(telemetry.getSnapshot().slo).toEqual({
      status: "BREACHED",
      breachedPhases: ["speechToRecognized"],
    });
  });

  it("evaluates the bounded window at p95 once five samples exist", () => {
    let now = 0;
    const telemetry = new RealtimeLatencyTelemetry({ now: () => now });
    for (const [index, latency] of [100, 200, 300, 400, 2_001].entries()) {
      const key = `slo-${index}`;
      now = index * 10_000;
      telemetry.beginAudioTurn(key);
      telemetry.markSpeechEnded(key);
      now += latency;
      telemetry.markRecognized(key, "whisper");
    }
    expect(telemetry.getSnapshot().phases.speechToRecognized.p95Ms).toBe(2_001);
    expect(telemetry.getSnapshot().slo).toEqual({
      status: "BREACHED",
      breachedPhases: ["speechToRecognized"],
    });
  });
});
