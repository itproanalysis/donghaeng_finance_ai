import { describe, expect, it } from "vitest";

import {
  beginAiSpeakingTransition,
  endAiSpeakingTransition,
  shouldScheduleAudioReconnect,
} from "../../src/realtime/use-audio-interview";

describe("AI question playback UX state", () => {
  it("gates microphone capture during playback and resumes the previous listening turn", () => {
    const started = beginAiSpeakingTransition("LISTENING");
    expect(started).toEqual({
      nextState: "AI_SPEAKING",
      restoreState: "LISTENING",
      pauseCapture: true,
    });
    expect(endAiSpeakingTransition(started!.restoreState)).toEqual({
      nextState: "LISTENING",
      resumeCapture: true,
    });
  });

  it("returns idle playback to IDLE and preserves an explicitly paused session", () => {
    expect(endAiSpeakingTransition("IDLE")).toEqual({
      nextState: "IDLE",
      resumeCapture: false,
    });
    expect(endAiSpeakingTransition("PAUSED")).toEqual({
      nextState: "PAUSED",
      resumeCapture: false,
    });
  });

  it("does not start playback while transcript or server processing is authoritative", () => {
    expect(beginAiSpeakingTransition("TRANSCRIBING")).toBeNull();
    expect(beginAiSpeakingTransition("AI_THINKING")).toBeNull();
    expect(beginAiSpeakingTransition("AI_SPEAKING")).toBeNull();
  });

  it("deduplicates error and close reconnect signals for the same session", () => {
    expect(shouldScheduleAudioReconnect({
      intentionalClose: false,
      currentAudioSessionId: "audio-1",
      requestedAudioSessionId: "audio-1",
      reconnectAlreadyScheduled: false,
    })).toBe(true);
    expect(shouldScheduleAudioReconnect({
      intentionalClose: false,
      currentAudioSessionId: "audio-1",
      requestedAudioSessionId: "audio-1",
      reconnectAlreadyScheduled: true,
    })).toBe(false);
    expect(shouldScheduleAudioReconnect({
      intentionalClose: true,
      currentAudioSessionId: "audio-1",
      requestedAudioSessionId: "audio-1",
      reconnectAlreadyScheduled: false,
    })).toBe(false);
    expect(shouldScheduleAudioReconnect({
      intentionalClose: false,
      currentAudioSessionId: "audio-2",
      requestedAudioSessionId: "audio-1",
      reconnectAlreadyScheduled: false,
    })).toBe(false);
  });
});
