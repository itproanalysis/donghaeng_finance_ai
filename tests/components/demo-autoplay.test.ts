import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { readDemoSelection } from "@/components/demo-autoplay";
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";

const roomSource = readFileSync(
  new URL("../../src/components/borrower-interview-room.tsx", import.meta.url),
  "utf8",
);

describe("시연 자동 재생", () => {
  it("주소에 demo가 없으면 자동 재생을 켜지 않는다", () => {
    expect(readDemoSelection("")).toBeNull();
    expect(readDemoSelection("?mode=chat")).toBeNull();
  });

  it("시나리오 id와 답변 묶음을 주소에서 읽는다", () => {
    expect(readDemoSelection("?demo=operating-day")).toEqual({
      scenarioId: "operating-day",
      answerSetId: "primary",
    });
    expect(readDemoSelection("?demo=operating-day&demoSet=control")).toEqual({
      scenarioId: "operating-day",
      answerSetId: "control",
    });
    expect(readDemoSelection("?demo=operating-day&demoSet=엉뚱한값")).toMatchObject({
      answerSetId: "primary",
    });
  });

  it("등록된 시나리오 id를 그대로 쓴다", () => {
    expect(readDemoSelection(`?demo=${OPERATING_DAY_DEMO_SCENARIO.id}`)?.scenarioId).toBe(
      OPERATING_DAY_DEMO_SCENARIO.id,
    );
  });

  it("인터뷰 화면이 자동 재생 훅을 지금 질문과 전송 가능 상태에 연결한다", () => {
    expect(roomSource).toContain('import { useDemoAutoplay } from "@/components/demo-autoplay"');
    expect(roomSource).toContain("useDemoAutoplay({");
    expect(roomSource).toContain("currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null");
    expect(roomSource).toContain("ready: !responseDisabled");
  });
});
