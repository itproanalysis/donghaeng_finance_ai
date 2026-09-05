import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/modeling-review.tsx", import.meta.url),
  "utf8",
);
const css = readFileSync(
  new URL("../../src/app/modeling/modeling.module.css", import.meta.url),
  "utf8",
);

describe("modeling review experience", () => {
  it("exposes variable-to-metric navigation and honest boundaries", () => {
    for (const label of ["요약", "원천자료", "변수", "평가 반영", "평가기준", "신용정보", "재평가"]) {
      expect(source).toContain(`label: "${label}"`);
    }
    expect(source).toContain("단일 종합점수는 만들지 않습니다");
    expect(source).toContain("평가 점수에 포함하지 않는 참고자료");
    expect(source).toContain("미확인 값은 0과 구분합니다");
    expect(source).toContain("role=\"dialog\"");
    expect(source).toContain('event.key === "Escape"');
  });

  it("keeps the responsive layout and reduced-motion support", () => {
    expect(css).toContain("@media (max-width: 560px)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
