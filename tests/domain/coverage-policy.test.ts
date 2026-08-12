import { describe, expect, it } from "vitest";

import {
  buildDeterministicEvaluation,
  calculateCoverage,
  createDefaultRequiredInformationItems,
  type FinalInterviewSnapshot,
  type InformationItem,
} from "../../src/domain";

function items(): InformationItem[] {
  return createDefaultRequiredInformationItems().map((item, index) => ({
    ...item,
    valueState: "MISSING",
    value: null,
    quality: null,
    extractionConfidence: null,
    verification: null,
    evidenceIds: [],
    prefill: null,
    updatedAt: `2026-08-10T00:00:0${index}.000Z`,
  }));
}

describe("coverage는 종료상태와 평가가능값을 분리한다", () => {
  it("모든 항목 REFUSED여도 상태확정률만 100%이고 데이터 충분도는 0%다", () => {
    const refused = items().map((item) => ({
      ...item,
      status: "REFUSED" as const,
      valueState: "REFUSED" as const,
    }));
    const coverage = calculateCoverage(refused);
    expect(coverage.statusConfirmationRate).toBe(1);
    expect(coverage.evaluableValueRate).toBe(0);
    expect(coverage.overallRate).toBe(0);
  });

  it("CONFIRMED라도 값·최소품질·evidence가 없으면 평가가능으로 세지 않는다", () => {
    const candidate = items();
    candidate[0] = {
      ...candidate[0],
      status: "CONFIRMED",
      valueState: "PRESENT",
      value: { amount: 10_000_000, currency: "KRW", period: "MONTH" },
      quality: "LOW",
      evidenceIds: [],
    };
    expect(calculateCoverage(candidate).evaluableRequired).toBe(0);
    candidate[0] = { ...candidate[0], quality: "MEDIUM", evidenceIds: ["e1"] };
    expect(calculateCoverage(candidate).evaluableRequired).toBe(1);
  });

  it("legacy data-sufficiency 평가도 REFUSED를 50점으로 올리지 않는다", () => {
    const refused = items().map((item) => ({
      ...item,
      status: "REFUSED" as const,
      valueState: "REFUSED" as const,
    }));
    const coverage = { ...calculateCoverage(refused, "FINAL"), snapshotType: "FINAL" as const };
    const snapshot: FinalInterviewSnapshot = {
      id: "s1",
      interviewId: "i1",
      snapshotType: "FINAL",
      version: 1,
      finalizedAt: "2026-08-10T00:00:00.000Z",
      completionStatus: "INCOMPLETE",
      borrower: { id: "b1", name: "김동행" },
      business: { id: "biz1", borrowerId: "b1", businessName: "동행 카페", industry: "카페" },
      informationItems: refused,
      transcript: [],
      evidenceManifest: [],
      coverage,
      transcriptSummary: "데이터 없음",
    };
    const evaluation = buildDeterministicEvaluation(snapshot, "ev1");
    expect(evaluation.overall.dataSufficiencyScore).toBe(0);
    expect(evaluation.pillars.every((pillar) => pillar.dataSufficiencyScore === 0)).toBe(true);
    expect(evaluation.unresolvedItems).toHaveLength(8);
  });
});
