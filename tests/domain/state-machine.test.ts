import { describe, expect, it } from "vitest";

import {
  InvalidInformationTransitionError,
  assertInformationTransition,
  isInformationTransitionAllowed,
} from "../../src/domain/state-machine";

describe("information state machine", () => {
  it("정상 수집 경로를 허용한다", () => {
    expect(isInformationTransitionAllowed("NEEDED", "ASKING")).toBe(true);
    expect(isInformationTransitionAllowed("ASKING", "COLLECTED")).toBe(true);
    expect(isInformationTransitionAllowed("COLLECTED", "CONFIRMED")).toBe(true);
  });

  it("ASKING에서 CONFIRMED로 건너뛰는 전이를 차단한다", () => {
    expect(() => assertInformationTransition("ASKING", "CONFIRMED")).toThrow(
      InvalidInformationTransitionError,
    );
  });

  it("확정값 수정은 correction 컨텍스트로만 다시 질문할 수 있다", () => {
    expect(isInformationTransitionAllowed("CONFIRMED", "ASKING")).toBe(false);
    expect(
      isInformationTransitionAllowed("CONFIRMED", "ASKING", { correction: true }),
    ).toBe(true);
  });
});
