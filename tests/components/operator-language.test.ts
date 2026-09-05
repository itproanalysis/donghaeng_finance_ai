import { describe, expect, it } from "vitest";
import { goalStatusLabel, questionReasonLabel, readableInformationText } from "@/components/operator-language";

describe("operator-facing vocabulary", () => {
  it("explains question and goal states without exposing enums", () => {
    expect(questionReasonLabel("PRIORITY")).toBe("기본 정보 확인");
    expect(questionReasonLabel("CONFLICT")).toBe("상충 답변 확인");
    expect(goalStatusLabel("UNRESOLVED")).toBe("아직 확인 전");
    expect(goalStatusLabel("NO_GOAL_STATED")).toBe("목표 없음");
    expect(goalStatusLabel("new_status")).toBe("상태 확인 필요");
  });
  it("substitutes whole known information codes without changing evidence or figures", () => {
    const items = [{ infoCode: "monthly_average_sales", label: "월평균 매출" }, { infoCode: "fixed_operating_costs", label: "월 고정 운영비" }];
    expect(readableInformationText("매출은 15,000,000원입니다. fixed_operating_costs, unknown_code 확인 필요.", items)).toBe("매출은 15,000,000원입니다. 월 고정 운영비, unknown_code 확인 필요.");
    expect(readableInformationText("not_monthly_average_sales", items)).toBe("not_monthly_average_sales");
  });
});
