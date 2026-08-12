import { describe, expect, it } from "vitest";

import {
  CANONICAL_VALUE_SCHEMA_VERSION,
  createCanonicalValueRevision,
  createDefaultRequiredInformationItems,
  detectCanonicalValueConflict,
  exact,
  isInformationTransitionAllowed,
  markConflictRevisions,
  resolveCanonicalConflict,
  selectNextQuestion,
  type InformationItem,
  type PeriodicMoneyValue,
} from "../../src/domain";

function money(amount: number, channels: string[] = []): PeriodicMoneyValue {
  return {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "PERIODIC_MONEY",
    amount: exact(amount),
    currency: "KRW",
    cadence: "MONTH",
    aggregation: "AVERAGE",
    basis: "GROSS_SALES",
    referenceWindow: {
      unit: "MONTH",
      count: 3,
      relation: "TRAILING",
      source: "QUESTION_CONTEXT",
    },
    channels,
    grossNetBasis: "GROSS",
  };
}

describe("append-only value revision과 conflict resolution", () => {
  it("같은 basis의 material mismatch 양쪽을 보존하고 새 resolution revision만 선택한다", () => {
    const first = createCanonicalValueRevision({
      id: "prefill",
      infoCode: "monthly_average_sales",
      valueState: "PRESENT",
      value: money(21_000_000, ["ALL"]),
      quality: "HIGH",
      parserConfidence: null,
      verification: "TRANSACTION_SUPPORTED",
      evidenceIds: ["e-prefill"],
      observedAt: "2026-08-01T00:00:00.000Z",
    });
    const second = createCanonicalValueRevision(
      {
        id: "reported",
        infoCode: "monthly_average_sales",
        valueState: "PRESENT",
        value: money(8_000_000, ["ALL"]),
        quality: "MEDIUM",
        parserConfidence: 1,
        verification: "SELF_REPORTED",
        evidenceIds: ["e-reported"],
        observedAt: "2026-08-10T00:00:00.000Z",
      },
      [first],
    );
    const conflict = detectCanonicalValueConflict("c1", first, second);
    expect(conflict).toMatchObject({ reason: "MATERIAL_VALUE_DIFFERENCE", status: "OPEN" });
    const marked = markConflictRevisions([first, second], conflict!);
    expect(marked.map((revision) => revision.status)).toEqual(["CONFLICTING", "CONFLICTING"]);

    const resolutionRevision = createCanonicalValueRevision(
      {
        id: "resolved",
        infoCode: "monthly_average_sales",
        valueState: "PRESENT",
        value: money(8_000_000, ["ALL"]),
        quality: "HIGH",
        parserConfidence: 1,
        verification: "DOCUMENT_SUPPORTED",
        evidenceIds: ["e-resolution"],
        observedAt: "2026-08-10T00:01:00.000Z",
        supersedesRevisionId: second.id,
      },
      marked,
    );
    const result = resolveCanonicalConflict(
      conflict!,
      {
        type: "ACCEPT_REPORTED",
        selectedRevisionId: second.id,
        resolutionRevisionId: resolutionRevision.id,
        evidenceIds: ["e-resolution"],
        reason: "동일 기준 자료로 차주 진술을 확인",
        resolvedAt: "2026-08-10T00:01:00.000Z",
      },
      [...marked, resolutionRevision],
    );
    expect(result.conflict.status).toBe("RESOLVED");
    expect(result.revisions).toHaveLength(3);
    expect(result.revisions.find((revision) => revision.id === "resolved")?.status).toBe("SELECTED");
    expect(result.revisions.find((revision) => revision.id === "prefill")?.value).toEqual(
      first.value,
    );
  });

  it("카드채널과 총매출처럼 basis channel이 다르면 수치 임계값 전에 INCOMPARABLE로 분류한다", () => {
    const card = createCanonicalValueRevision({
      id: "card",
      infoCode: "monthly_average_sales",
      valueState: "PRESENT",
      value: money(21_000_000, ["CARD"]),
      quality: "HIGH",
      parserConfidence: null,
      verification: "TRANSACTION_SUPPORTED",
      evidenceIds: ["e-card"],
      observedAt: "2026-08-01T00:00:00.000Z",
    });
    const total = createCanonicalValueRevision(
      {
        id: "total",
        infoCode: "monthly_average_sales",
        valueState: "PRESENT",
        value: money(21_000_000, ["CARD", "CASH", "DELIVERY"]),
        quality: "MEDIUM",
        parserConfidence: 1,
        verification: "SELF_REPORTED",
        evidenceIds: ["e-total"],
        observedAt: "2026-08-10T00:00:00.000Z",
      },
      [card],
    );
    expect(detectCanonicalValueConflict("c", card, total)?.reason).toBe(
      "INCOMPARABLE_BASIS",
    );
  });
});

describe("state transition과 deterministic selector", () => {
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

  it("incidental extraction만 NEEDED→COLLECTED direct path를 허용한다", () => {
    expect(isInformationTransitionAllowed("NEEDED", "COLLECTED")).toBe(false);
    expect(
      isInformationTransitionAllowed("NEEDED", "COLLECTED", {
        incidentalExtraction: true,
      }),
    ).toBe(true);
  });

  it("P0·conflict/followup·dependency·질문부담·topic continuity를 안정적으로 반영한다", () => {
    const candidates = items().map((item) =>
      item.infoCode === "monthly_average_sales"
        ? { ...item, status: "CONFIRMED" as const }
        : item.infoCode === "improvement_plan"
          ? { ...item, status: "NEEDS_FOLLOWUP" as const }
          : item,
    );
    expect(
      selectNextQuestion(candidates, null, {
        lastCategory: "IMPROVEMENT_INTENT",
        askedCounts: { improvement_plan: 0, confirmed_reservations: 2 },
      })?.infoCode,
    ).toBe("improvement_plan");
    expect(
      selectNextQuestion(candidates, null, {
        askedCounts: { improvement_plan: 5, confirmed_reservations: 0 },
      })?.infoCode,
    ).toBe("improvement_plan");
    expect(
      selectNextQuestion(candidates, null)?.infoCode,
    ).not.toBe("execution_readiness");
  });
});
