import { describe, expect, it } from "vitest";

import {
  hasMaterialAmountConflict,
  parseMonthlyAverageSales,
} from "../../src/domain/money-extraction";

describe("parseMonthlyAverageSales", () => {
  it.each([
    ["월 2,300만원 정도입니다", 23_000_000],
    ["2300만 원", 23_000_000],
    ["2억 3000만원", 230_000_000],
    ["3천5백만원", 35_000_000],
    ["1억 2천만원", 120_000_000],
    ["매출이 발생하지 않아서 0원입니다", 0],
    ["0원", 0],
  ])("%s를 실제 원 단위 금액으로 추출한다", (text, expectedAmount) => {
    const result = parseMonthlyAverageSales(text);

    expect(result.kind).toBe("PRESENT");
    if (result.kind === "PRESENT") {
      expect(result.valueState).toBe("PRESENT");
      expect(result.value.amount).toBe(expectedAmount);
    }
  });

  it.each(["잘 모르겠다", "월마다 다르다", "월마다 달라서 2,000만원인지 모르겠어요"])(
    "모호한 응답 %s에서 숫자를 만들어내지 않는다",
    (text) => {
      const result = parseMonthlyAverageSales(text);

      expect(result.kind).not.toBe("PRESENT");
      expect(result.value).toBeNull();
      expect(["NEEDS_FOLLOWUP", "UNAVAILABLE"]).toContain(result.targetStatus);
    },
  );

  it("화면의 변동성 예시를 추가 확인 상태로 분류한다", () => {
    const result = parseMonthlyAverageSales(
      "월마다 많이 달라서 최근 3개월 평균을 따로 계산해야 합니다.",
    );

    expect(result.kind).toBe("AMBIGUOUS");
    expect(result.targetStatus).toBe("NEEDS_FOLLOWUP");
    if (result.kind !== "PRESENT") {
      expect(result.followupQuestion).toContain("가장 낮은 달과 높은 달");
    }
  });

  it.each([
    "-2100만원",
    "100만원에서 300만원 사이",
    "현금 1000만원, 카드 2000만원, 합계 3000만원",
  ])("위험한 복합 금액 %s를 단일 확정값으로 만들지 않는다", (text) => {
    const result = parseMonthlyAverageSales(text);

    expect(result.kind).toBe("AMBIGUOUS");
    expect(result.value).toBeNull();
    expect(result.targetStatus).toBe("NEEDS_FOLLOWUP");
  });

  it("기존 관측값과 25% 이상의 큰 차이만 충돌로 분류한다", () => {
    expect(hasMaterialAmountConflict(21_000_000, 23_000_000)).toBe(false);
    expect(hasMaterialAmountConflict(21_000_000, 8_000_000)).toBe(true);
  });
});
