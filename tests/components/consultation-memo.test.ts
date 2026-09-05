import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { adaptFinalSnapshot, type InformationItemView } from "@/components/api-adapter";
import { buildConsultationMemo, groupConsultationInformation, linkedConsultationEvidence } from "@/components/consultation-memo";
import { ConsultationMemoExport } from "@/components/consultation-memo-export";

function fixture(completionStatus = "COMPLETE") {
  return adaptFinalSnapshot({
    snapshotType: "FINAL", completionStatus, id: "final-qa", interviewId: "interview-qa", version: 4,
    finalizedAt: "2026-09-04T08:00:00.000Z", borrower: { name: "검증 호칭" }, business: { businessName: "검증 문구점", industry: "소매업" },
    informationItems: [
      { infoCode: "zero", label: "0원 항목", category: "CURRENT_STATE", status: "CONFIRMED", valueState: "ZERO", value: "0원", evidenceIds: ["e-zero", "missing", "mismatch"], verification: "SELF_REPORTED" },
      { infoCode: "range", label: "범위 항목", category: "CURRENT_STATE", status: "CONFIRMED", valueState: "KNOWN", value: "1,000만~1,500만원", evidenceIds: [] },
      { infoCode: "unknown", label: "모르는 항목", category: "CURRENT_STATE", status: "UNAVAILABLE", valueState: "UNKNOWN", value: null },
      { infoCode: "refused", label: "거절한 항목", category: "CURRENT_STATE", status: "REFUSED", valueState: "REFUSED", value: null },
      { infoCode: "na", label: "해당 없는 항목", category: "CURRENT_STATE", status: "NOT_APPLICABLE", valueState: "NOT_APPLICABLE", value: null },
      { infoCode: "pending", label: "미확인 항목", category: "CURRENT_STATE", status: "NEEDED", valueState: "MISSING", value: null },
    ],
    transcript: [{ id: "t-zero", speaker: "BORROWER", text: "이번 달은 0원입니다." }],
    evidenceManifest: [
      { id: "e-zero", infoCode: "zero", kind: "SELF_REPORTED", source: "인터뷰", transcriptSegmentId: "t-zero" },
      { id: "unlinked", infoCode: "zero", kind: "SELF_REPORTED", source: "이전 기록", excerpt: "포함하면 안 되는 이전 답변" },
      { id: "mismatch", infoCode: "another", kind: "SELF_REPORTED", source: "다른 항목", excerpt: "다른 항목의 원문" },
    ],
  });
}

describe("portable, evidence-linked consultation memo", () => {
  it.each(["COMPLETE", "INCOMPLETE"])("exports %s without needing an evaluation", (status) => {
    const snapshot = fixture(status);
    const text = buildConsultationMemo(snapshot);
    expect(text).toContain("기록된 값: 0원");
    expect(text).toContain("1,000만~1,500만원");
    expect(text).toContain("버전 4");
    expect(text).toContain("원본 기록: final-qa");
    expect(text).toContain(status === "COMPLETE" ? "종료 상태: 완료" : "미확인 항목을 남기고 종료");
    expect(text).toContain("공식 증빙을 대체하지 않습니다");
    expect(text).toContain("금융기관에 자동 전송하지 않습니다");
    expect(text).not.toContain("승인 가능성");
  });
  it("separates terminal unknown/refused from follow-up without modifying the original", () => {
    const snapshot = fixture();
    const before = JSON.stringify(snapshot);
    const groups = groupConsultationInformation(snapshot.informationItems);
    expect(groups.deferred.map((item) => item.infoCode)).toEqual(["unknown", "refused"]);
    expect(groups.followUp.map((item) => item.infoCode)).toEqual(["pending"]);
    expect(groups.notApplicable.map((item) => item.infoCode)).toEqual(["na"]);
    buildConsultationMemo(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it("includes only exactly linked evidence for the same information item", () => {
    const snapshot = fixture();
    const first = snapshot.informationItems[0] as InformationItemView;
    expect(linkedConsultationEvidence(first, snapshot.evidence).map((entry) => entry.id)).toEqual(["e-zero"]);
    const text = buildConsultationMemo(snapshot);
    expect(text).toContain("이번 달은 0원입니다.");
    expect(text).not.toContain("포함하면 안 되는 이전 답변");
    expect(text).not.toContain("다른 항목의 원문");
    expect(text).toContain("원문을 확인할 수 없는 근거: missing, mismatch");
  });
  it("keeps a missing amount missing rather than substituting zero", () => {
    const snapshot = fixture();
    const text = buildConsultationMemo(snapshot);
    const deferred = text.split("3. 답변을 보류한 내용")[1]!.split("4. 해당하지 않는 내용")[0]!;
    expect(deferred).not.toContain("기록된 값: 0");
    expect(deferred).toContain("원하지 않으면 다시 답하지 않아도 됩니다");
  });
  it("offers both export routes for an incomplete record and escapes user text", () => {
    const snapshot = fixture("INCOMPLETE");
    snapshot.businessName = "<script>unsafe()</script>";
    const html = renderToStaticMarkup(createElement(ConsultationMemoExport, { snapshot }));
    expect(html).toContain("상담 메모 받기 · TXT");
    expect(html).toContain("인쇄 / PDF 저장");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>unsafe()");
  });
});
