import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelingInstitutionReport } from "@/components/modeling-institution-report";
import { EMPTY_REVIEW } from "@/domain/modeling-workflow";
import { getModelingBundle, getModelingCase } from "@/server/modeling-demo";

function report(caseId: string, note = "") {
  const bundle = getModelingBundle();
  const selectedCase = getModelingCase(caseId)!;
  const initialCase = getModelingCase(caseId === bundle.reevaluation.afterCase ? bundle.reevaluation.beforeCase : caseId)!;
  return renderToStaticMarkup(createElement(ModelingInstitutionReport, { selectedCase, initialCase, reevaluation: bundle.reevaluation, modelVersion: bundle.model.version, draft: { ...EMPTY_REVIEW, note } }));
}

describe("restored financial institution review dossier", () => {
  it("shows original review sections with authoritative values and traceable inputs", () => {
    const html = report("case_operating_drop", "영업일 자료의 기간을 추가 확인합니다.");
    expect(html).toContain('id="modeling-review-report"');
    for (const label of ["사업 현황", "주요 변수", "검토자료 구성", "평가 결과와 산출 근거", "인터뷰에서 추가된 정보", "목표와 수행자료", "담당자 검토 의견"]) expect(html).toContain(label);
    expect(html).toContain("24,000,000원");
    expect(html).toContain("42.66일");
    expect(html).toContain("54 ÷ 80 × 100");
    expect(html).toContain("own_operating_day_drop_reason");
    expect(html).toContain("영업일 자료의 기간을 추가 확인합니다.");
    expect(html).not.toMatch(/470만|상환 안정성이 양호|필수 증빙이 사전에|구비 완료/);
  });

  it("keeps missing information and the changed follow-up denominator visible", () => {
    const empty = report("case_no_answer");
    expect(empty).toContain("MISSING");
    expect(empty).toContain("이 자료에 포함된 새 인터뷰 원문이 없습니다");
    expect(empty).not.toContain("54 ÷ 80 × 100");
    const after = report("case_operating_drop_after");
    expect(after).toContain("60 ÷ 60 × 100");
    expect(after).toContain("후속 자료 반영본");
    expect(after).toContain("목표 충족");
    expect(after).toContain("2027-01");
    expect(after).toContain("신용 개선률을 뜻하지 않으며");
  });

  it("prints human notes as text without treating them as HTML or score inputs", () => {
    const html = report("case_operating_drop", '<script>alert("test")</script>');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("54 ÷ 80 × 100");
  });
});
