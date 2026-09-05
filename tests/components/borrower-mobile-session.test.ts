import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const roomSource = readFileSync(
  new URL("../../src/components/borrower-interview-room.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8",
);

describe("borrower long-session and mobile UX", () => {
  it("keeps the server-grounded phase journey visible and accessible", () => {
    expect(roomSource).toContain("buildBorrowerConversationGuide({");
    expect(roomSource).toContain('className="borrower-phase-guide"');
    expect(roomSource).toContain('aria-current={phase.state === "CURRENT" ? "step" : undefined}');
    expect(roomSource).toContain("conversationGuide.currentPhaseKey");
    expect(roomSource).toContain('track.scrollTo({ left:');
    expect(roomSource).toContain('timeline?.scrollTo({ top: timeline.scrollHeight, behavior })');
    expect(roomSource).not.toContain('timelineEndRef.current?.scrollIntoView');
  });

  it("bounds mobile transcript growth and keeps the chat composer reachable", () => {
    expect(styles).toMatch(
      /\.borrower-conversation__timeline \{ min-height: min\(320px, 45dvh\); max-height: 48dvh;/,
    );
    expect(styles).toMatch(
      /\.borrower-room--chat \.borrower-answer-box \{ position: sticky;[^}]*bottom: 0;/,
    );
    expect(styles).not.toContain(
      ".borrower-conversation__timeline { min-height: 320px; max-height: none;",
    );
  });

  it("announces review selection and brings the final confirmation into view", () => {
    expect(roomSource).toContain("aria-pressed={selectedHistory?.id === row.id}");
    expect(roomSource).toContain("completionReviewRef.current?.scrollIntoView");
    expect(roomSource).toContain('className="borrower-completion-review-shell"');
  });

  it("makes the one-follow-up boundary explicit in the borrower UI", () => {
    expect(roomSource).toContain("이번 확인 뒤에는 같은 내용을 반복해 묻지 않아요.");
    expect(roomSource).toContain("건너뛰어도 인터뷰는 다음 이야기로 계속됩니다.");
  });
});
