import { describe, expect, it } from "vitest";
import { recoveryCommand } from "@/components/recovery-command";

describe("recovery retry after a lost save response", () => {
  it("replays the exact original request even after a refresh observes a later server revision", () => {
    const values = { missionId: 1, title: "합성 자료 준비", note: "합성 매출표 항목과 기간을 확인했습니다.", observedOn: "2026-09-06", expectedRevision: 0 };
    const first = recoveryCommand(null, "ADD_EVIDENCE", values);
    const retried = recoveryCommand(first, "ADD_EVIDENCE", { ...values, expectedRevision: 1 });
    expect(retried.body).toEqual(first.body);
    expect(retried.body.expectedRevision).toBe(0);
  });
  it("creates a different request when the user supplies a different review decision", () => {
    const first = recoveryCommand(null, "REVIEW", { status: "NEEDS_INFORMATION", note: "기간 추가 확인", expectedRevision: 0 });
    const next = recoveryCommand(first, "REVIEW", { status: "REVIEWED", note: "기간 확인 완료", expectedRevision: 1 });
    expect(next.body.clientCommandId).not.toBe(first.body.clientCommandId);
    expect(next.body.status).toBe("REVIEWED");
    expect(next.body.expectedRevision).toBe(1);
  });
});
