import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/audio-interview-controls.tsx", import.meta.url),
  "utf8",
);

describe("borrower external question voice coordination", () => {
  it("gates capture for parent-owned TTS and releases it only after playback", () => {
    expect(source).toContain("externalQuestionVoiceActive?: boolean");
    expect(source).toContain("externalQuestionVoiceLatched");
    expect(source).toContain("beginAiSpeaking()");
    expect(source).toContain("endAiSpeaking()");
    expect(source).toContain("externalQuestionVoiceActive ||");
    expect(source).toContain('audio.uxState !== "IDLE"');
  });

  it("offers an explicit barge-in instead of opening the microphone underneath TTS", () => {
    expect(source).toContain("onQuestionVoiceInterrupt?: () => void");
    expect(source).toContain("onQuestionVoiceInterrupt();");
    expect(source).toContain("AI 멈추고 답변");
  });
});
