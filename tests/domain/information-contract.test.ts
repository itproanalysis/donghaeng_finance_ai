import { describe, expect, it } from "vitest";

import {
  CANONICAL_VALUE_SCHEMA_VERSION,
  DEV_V1_REQUIRED_INFORMATION_JSON_SCHEMA,
  DEV_V1_INFORMATION_CATALOG,
  assertCanonicalInformationValue,
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
  exact,
  range,
  selectNextQuestion,
  validateRequiredInformationCatalog,
  type ImprovementPlanValue,
  type PeriodicMoneyValue,
} from "../../src/domain";

describe("dev-v1 required information contract", () => {
  it("versioned 8개 catalog와 의존성을 runtime에서 검증한다", () => {
    const items = createDevV1RequiredInformationItems();

    expect(items).toHaveLength(8);
    expect(validateRequiredInformationCatalog(items, { requireDevV1Codes: true })).toEqual([]);
    expect(new Set(items.map((item) => item.infoCode)).size).toBe(8);
    expect(new Set(items.map((item) => item.category)).size).toBe(4);
    expect(DEV_V1_INFORMATION_CATALOG.every((item) => item.catalogVersion === "dev-v1")).toBe(true);
    expect(items.find((item) => item.infoCode === "monthly_average_sales")).toMatchObject({
      priority: "P0",
      status: "ASKING",
    });
  });

  it("핵심 8개는 강제하고 등록된 보조 3개만 선택적으로 허용한다", () => {
    const acceptance = createDevV1AcceptanceRequiredInformationItems();
    expect(acceptance).toHaveLength(11);
    expect(validateRequiredInformationCatalog(acceptance, { requireDevV1Codes: true })).toEqual([]);
    expect(DEV_V1_REQUIRED_INFORMATION_JSON_SCHEMA).toMatchObject({
      minItems: 8,
      maxItems: 12,
    });
    expect(DEV_V1_REQUIRED_INFORMATION_JSON_SCHEMA.allOf).toHaveLength(12);
    expect(
      DEV_V1_REQUIRED_INFORMATION_JSON_SCHEMA.allOf.slice(8).every(
        (rule) => rule.minContains === 0 && rule.maxContains === 1,
      ),
    ).toBe(true);
    expect(acceptance.filter((item) => item.status === "ASKING").map((item) => item.infoCode)).toEqual([
      "monthly_average_sales",
    ]);
    expect(
      acceptance.find((item) => item.infoCode === "platform_fee_pressure")?.question,
    ).toBe("배달이나 온라인 플랫폼을 이용하고 계신다면, 최근 수수료나 광고비가 운영에 부담된 부분이 있었나요? 이용하지 않으시면 그렇지 않다고 말씀해 주세요.");
    const acceptanceState = acceptance.map((item) => ({
      ...item,
      valueState: "MISSING" as const,
      value: null,
      quality: null,
      extractionConfidence: null,
      verification: null,
      evidenceIds: [],
      prefill: null,
      updatedAt: "2026-08-10T00:00:00.000Z",
    }));
    expect(selectNextQuestion(acceptanceState, "monthly_average_sales")).toMatchObject({
      infoCode: "monthly_average_sales",
      reason: "PRIORITY",
    });

    const withoutCore = acceptance.filter((item) => item.infoCode !== "monthly_average_sales");
    expect(
      validateRequiredInformationCatalog(withoutCore, { requireDevV1Codes: true }).map(
        (issue) => issue.code,
      ),
    ).toContain("DEV_V1_CATALOG_MISMATCH");

    const unknownExtra = [
      ...createDevV1RequiredInformationItems(),
      { ...acceptance.at(-1)!, infoCode: "unregistered_optional_signal" },
    ];
    expect(
      validateRequiredInformationCatalog(unknownExtra, { requireDevV1Codes: true }).map(
        (issue) => issue.code,
      ),
    ).toContain("DEV_V1_CATALOG_MISMATCH");
  });

  it("빈 목록·중복·존재하지 않는 dependency·cycle을 fail-closed한다", () => {
    expect(validateRequiredInformationCatalog([]).map((issue) => issue.code)).toContain(
      "EMPTY_REQUIRED_INFORMATION",
    );
    const items = createDevV1RequiredInformationItems();
    items[1] = {
      ...items[1],
      infoCode: items[0].infoCode,
      dependencies: ["does_not_exist"],
    };
    expect(validateRequiredInformationCatalog(items).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["DUPLICATE_INFO_CODE", "UNKNOWN_DEPENDENCY"]),
    );

    const cyclic = createDevV1RequiredInformationItems();
    cyclic[0] = { ...cyclic[0], dependencies: [cyclic[1].infoCode] };
    cyclic[1] = { ...cyclic[1], dependencies: [cyclic[0].infoCode] };
    expect(validateRequiredInformationCatalog(cyclic).map((issue) => issue.code)).toContain(
      "DEPENDENCY_CYCLE",
    );
  });
});

describe("tagged canonical value validation", () => {
  it("실제 0과 range를 PRESENT canonical numeric으로 보존한다", () => {
    const zero: PeriodicMoneyValue = {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "PERIODIC_MONEY",
      amount: exact(0),
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
    };
    const bounded: PeriodicMoneyValue = { ...zero, amount: range(1_000_000, 2_000_000) };

    expect(() => assertCanonicalInformationValue(zero)).not.toThrow();
    expect(() => assertCanonicalInformationValue(bounded)).not.toThrow();
    expect(bounded.amount).toEqual({ kind: "RANGE", min: 1_000_000, max: 2_000_000 });
  });

  it("tag 내부 모순과 역전 range를 거부한다", () => {
    expect(() => range(2, 1)).toThrow(RangeError);
    const contradictory: ImprovementPlanValue = {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "IMPROVEMENT_PLAN",
      planExists: false,
      problem: null,
      actions: [
        { text: "행동", evidenceSpan: { start: 0, end: 2, text: "행동" } },
      ],
      owner: "BORROWER",
      schedule: null,
      baseline: null,
      target: null,
      measurementSources: [],
      origin: "BORROWER_DIRECT",
    };
    expect(() => assertCanonicalInformationValue(contradictory)).toThrow(
      /planExists=false/,
    );
  });
});
