import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelingResults } from "@/components/modeling-results";
import { displayModelValue } from "@/domain/modeling-workflow";
import { getModelingCase } from "@/server/modeling-demo";

describe("selected-case score explanations", () => {
  it.each([
    ["case_operating_drop", "54 ÷ 80 × 100 = 67.5"],
    ["case_no_answer", "24 ÷ 80 × 100 = 30"],
    ["case_volatile", "28 ÷ 40 × 100 = 70"],
  ])("renders the actual denominator and formula for %s", (id, formula) => {
    const html = renderToStaticMarkup(createElement(ModelingResults, { selectedCase: getModelingCase(id)!, formatValue: displayModelValue }));
    expect(html).toContain(formula);
    expect(html).not.toContain("&#x27;매출 방향&#x27; 항목이 제외되어");
    if (id !== "case_operating_drop") expect(html).not.toContain("54 ÷ 80 × 100 = 67.5");
  });
});
