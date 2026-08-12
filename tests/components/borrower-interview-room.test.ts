import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/borrower-interview-room.tsx", import.meta.url),
  "utf8",
);

describe("borrower question speech", () => {
  it("uses a same-origin authenticated TTS proxy, unlocks audio on an explicit start, and continues after each answer", () => {
    expect(source).toContain('const QUESTION_SPEECH_ENDPOINT = "/api/voice/speech"');
    expect(source).toContain("authenticatedFetch(QUESTION_SPEECH_ENDPOINT");
    expect(source).toContain("unlockQuestionVoice();");
    expect(source).toContain("setVoiceAutoplayEnabled(true);");
    expect(source).toContain("lastSpokenQuestionRef.current = promptToSpeak");
    expect(source).toContain("currentQuestionVoicePlayback()");
    expect(source).toContain("unlockQuestionVoicePlayback()");
    expect(source).toContain('AI 질문을 듣고 음성 인터뷰 시작');
    expect(source).toContain("context.decodeAudioData(bytes.slice(0))");
    expect(source).toContain("const audio = new Audio(objectUrl)");
    expect(source).toContain("await audio.play()");
    expect(source).toContain("speakWithDeviceVoice(questionToSpeak)");
    expect(source).toContain("URL.revokeObjectURL(objectUrl)");
    expect(source).toContain("AI 음성을 준비하고 있어요");
    expect(source).toContain("음성 준비 취소");
  });
});
