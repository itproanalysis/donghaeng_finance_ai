import { describe, expect, it } from "vitest";
import { judgeDemoProgress } from "@/components/judge-demo-progress";
import { JUDGE_DEMO } from "@/domain/judge-demo";
import type { LiveInterviewView, TranscriptView } from "@/components/api-adapter";

const turn = (text: string): TranscriptView => ({ id: "test-turn", speaker: "BORROWER", text, rawText: text, correctedText: null, revision: 1, startMs: null, endMs: null, sttConfidence: null, sttProvider: null, createdAt: "2026-09-06T00:00:00Z" });
const pending: LiveInterviewView["pendingCommand"] = { text: JUDGE_DEMO.answers[0], clientMessageId: "persisted-command", expectedVersion: 1, currentQuestionInfoCode: "monthly_average_sales", transcriptMetadata: null, processingState: "READY" };
describe("judge demo resume after a staged transcript", () => {
  it("retries the persisted first turn instead of advancing when raw transcript exists but domain commit is pending", () => {
    expect(judgeDemoProgress({ transcript: [turn(JUDGE_DEMO.answers[0])], pendingCommand: pending })).toEqual({ answerCount: 0, matchesScript: true, nextAnswer: JUDGE_DEMO.answers[0] });
  });
  it("advances only after the authoritative pending command clears", () => {
    expect(judgeDemoProgress({ transcript: [turn(JUDGE_DEMO.answers[0])], pendingCommand: null })).toEqual({ answerCount: 1, matchesScript: true, nextAnswer: JUDGE_DEMO.answers[1] });
  });
  it("does not inject the judge script into a customized full interview", () => {
    expect(judgeDemoProgress({ transcript: [turn("사용자가 전체 인터뷰에서 직접 입력한 다른 합성 답변")], pendingCommand: null }).matchesScript).toBe(false);
  });
});
