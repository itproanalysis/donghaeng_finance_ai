import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  BORROWER_CONFIRMED_INCOMPLETE_REASON,
  borrowerCompletionCommand,
  borrowerCompletionDisposition,
  canOfferBorrowerCompletion,
  type BorrowerCompletionAvailability,
} from "@/components/borrower-completion";

const ready: BorrowerCompletionAvailability = {
  hasLiveSnapshot: true,
  currentQuestion: null,
  hasPendingCommand: false,
  hasBlockingError: false,
  isTurnProcessing: false,
  isVoiceBusy: false,
  isSending: false,
};

const reviewSource = readFileSync(
  new URL("../../src/components/borrower-completion-review.tsx", import.meta.url),
  "utf8",
);
const roomSource = readFileSync(
  new URL("../../src/components/borrower-interview-room.tsx", import.meta.url),
  "utf8",
);

describe("borrower interview completion", () => {
  it("offers confirmation only for a settled live interview with no next question", () => {
    expect(canOfferBorrowerCompletion(ready)).toBe(true);
    expect(canOfferBorrowerCompletion({ ...ready, currentQuestion: "다음 질문" })).toBe(false);
    expect(canOfferBorrowerCompletion({ ...ready, hasPendingCommand: true })).toBe(false);
    expect(canOfferBorrowerCompletion({ ...ready, hasBlockingError: true })).toBe(false);
    expect(canOfferBorrowerCompletion({ ...ready, isTurnProcessing: true })).toBe(false);
    expect(canOfferBorrowerCompletion({ ...ready, isVoiceBusy: true })).toBe(false);
    expect(canOfferBorrowerCompletion({ ...ready, isSending: true })).toBe(false);
    expect(canOfferBorrowerCompletion({ ...ready, hasLiveSnapshot: false })).toBe(false);
  });

  it("creates a borrower-confirmed strict completion command when every required value is evaluable", () => {
    expect(borrowerCompletionDisposition([
      { infoCode: "sales", label: "매출", required: true, status: "CONFIRMED" },
      { infoCode: "optional", label: "선택", required: false, status: "REFUSED" },
    ])).toEqual({ mode: "COMPLETE", terminalRequiredItems: [] });
    expect(borrowerCompletionCommand(12, "borrower-complete-1", "COMPLETE")).toEqual({
      clientCommandId: "borrower-complete-1",
      expectedVersion: 12,
      mode: "COMPLETE",
      borrowerConfirmed: true,
      reason: null,
    });
  });

  it("uses an explicit evaluation-ineligible finalization when a required answer is terminal", () => {
    const refused = { infoCode: "costs", label: "고정비", required: true, status: "REFUSED" };
    const unavailable = { infoCode: "sales", label: "매출", required: true, status: "UNAVAILABLE" };
    expect(borrowerCompletionDisposition([refused, unavailable])).toEqual({
      mode: "FORCE_INCOMPLETE",
      terminalRequiredItems: [refused, unavailable],
    });
    expect(borrowerCompletionCommand(13, "borrower-complete-2", "FORCE_INCOMPLETE")).toEqual({
      clientCommandId: "borrower-complete-2",
      expectedVersion: 13,
      mode: "FORCE_INCOMPLETE",
      borrowerConfirmed: true,
      reason: BORROWER_CONFIRMED_INCOMPLETE_REASON,
    });
  });

  it("posts the selected completion mode, adapts the final snapshot, and exposes recovery actions", () => {
    expect(reviewSource).toContain("/complete`");
    expect(reviewSource).toContain('createClientCommandId("borrower-complete")');
    expect(reviewSource).toContain("adaptInterviewSnapshot(data)");
    expect(reviewSource).toContain('finalSnapshot.snapshotType !== "FINAL"');
    expect(reviewSource).toContain("setCompletionBlockers(caught.blockers)");
    expect(reviewSource).toContain("답변 다시 보기");
    expect(reviewSource).toContain("최신 상태 확인");
    expect(reviewSource).toContain('completionDisposition.mode === "FORCE_INCOMPLETE"');
    expect(reviewSource).toContain("이 종료 기록으로는 인터뷰 데이터 평가를 만들지 않습니다.");
    expect(reviewSource).toContain("확인 가능한 범위로 인터뷰 마치기");
  });

  it("places completion behind the settled-state gate in the borrower room", () => {
    expect(roomSource).toContain("const completionReviewAvailable = canOfferBorrowerCompletion({");
    expect(roomSource).toContain("hasPendingCommand: live?.pendingCommand !== null");
    expect(roomSource).toContain("hasBlockingError: error !== null");
    expect(roomSource).toContain("completionReviewAvailable && live ? (");
    expect(roomSource).toContain("<BorrowerCompletionReview");
    expect(roomSource).toContain("처리가 끝나기 전에는 인터뷰 완료 버튼을 보여드리지 않습니다.");
  });
});
