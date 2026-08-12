import { describe, expect, it } from "vitest";

import {
  NAMED_FEATURE_CATALOG,
  REQUIRED_NAMED_FEATURE_CODES,
  buildNamedFeatureCoverage,
  calculateLiveFeatures,
  getNamedFeatureCatalogEntry,
  validateNamedFeatureCatalog,
} from "../../src/domain";

describe("dev-v1 named feature catalog", () => {
  it("sections 19~22의 60개 이름을 4대 축별로 빠짐없이 versioning한다", () => {
    expect(REQUIRED_NAMED_FEATURE_CODES).toHaveLength(60);
    expect(new Set(REQUIRED_NAMED_FEATURE_CODES)).toHaveLength(60);
    expect(NAMED_FEATURE_CATALOG).toHaveLength(60);
    expect(validateNamedFeatureCatalog()).toEqual([]);

    const counts = Object.fromEntries(
      ["CURRENT_STATE", "IMPROVEMENT_INTENT", "FUTURE_OUTLOOK", "HOUSEHOLD_STATE"].map(
        (domain) => [domain, NAMED_FEATURE_CATALOG.filter((entry) => entry.domain === domain).length],
      ),
    );
    expect(counts).toEqual({
      CURRENT_STATE: 25,
      IMPROVEMENT_INTENT: 14,
      FUTURE_OUTLOOK: 12,
      HOUSEHOLD_STATE: 9,
    });
  });

  it("실제 계산 경로가 없는 이름은 MISSING/null이며 모델 후보나 0 기본값이 아니다", () => {
    const missing = NAMED_FEATURE_CATALOG.filter(
      (entry) => entry.implementationState === "MISSING",
    );
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((entry) =>
      entry.runtimeFeatureName === null &&
      entry.calculationRuleId === null &&
      entry.defaultValue === null &&
      entry.missingValue === null &&
      entry.modelCandidate === false &&
      entry.prohibitedFallback === "NEVER_COERCE_TO_ZERO"
    )).toBe(true);

    expect(getNamedFeatureCatalogEntry("business_tenure_months")).toMatchObject({
      implementationState: "MISSING",
      runtimeFeatureName: null,
      modelCandidate: false,
    });
    expect(getNamedFeatureCatalogEntry("booking_count")).toMatchObject({
      implementationState: "IMPLEMENTED",
      runtimeFeatureName: "booking_count",
    });
  });

  it("동일 canonical 의미의 명시적 alias만 구현하고 다른 이름은 MISSING으로 둔다", () => {
    expect(getNamedFeatureCatalogEntry("past_execution_example_count")).toMatchObject({
      implementationState: "IMPLEMENTED",
      runtimeFeatureName: "past_execution_example_count",
    });
    expect(getNamedFeatureCatalogEntry("household_income_stability")).toMatchObject({
      implementationState: "MISSING",
    });
    expect(getNamedFeatureCatalogEntry("pipeline_coverage_months")).toMatchObject({
      implementationState: "MISSING",
    });
    expect(getNamedFeatureCatalogEntry("past_execution_examples")).toBeNull();
    expect(getNamedFeatureCatalogEntry("income_stability")).toBeNull();
    expect(getNamedFeatureCatalogEntry("pipeline_coverage")).toBeNull();
  });

  it("runtime MISSING의 raw=0은 폐기하고 명시적 COMPUTED zero만 보존한다", () => {
    const coverage = buildNamedFeatureCoverage([
      { name: "fixed_cost_ratio", state: "MISSING", raw: 0 },
      { name: "confirmed_order_value", state: "COMPUTED", raw: 0 },
      { name: "booking_count", state: "COMPUTED", raw: 0 },
    ]);

    expect(coverage.find((entry) => entry.code === "fixed_cost_ratio")).toMatchObject({
      observationState: "MISSING",
      value: null,
    });
    expect(coverage.find((entry) => entry.code === "confirmed_order_value")).toMatchObject({
      observationState: "COMPUTED",
      value: 0,
    });
    expect(coverage.find((entry) => entry.code === "booking_count")).toMatchObject({
      implementationState: "IMPLEMENTED",
      observationState: "COMPUTED",
      value: 0,
    });
  });

  it("실제 PREVIEW registry가 60개 요구 이름을 모두 MISSING/null 또는 계산값으로 반환한다", () => {
    const live = calculateLiveFeatures({ records: [], stateVersion: 1 });
    const byName = new Map(live.features.map((feature) => [feature.name, feature]));
    expect(REQUIRED_NAMED_FEATURE_CODES.every((name) => byName.has(name))).toBe(true);
    expect(
      REQUIRED_NAMED_FEATURE_CODES.every((name) => {
        const feature = byName.get(name);
        return feature?.state !== "MISSING" ||
          (feature.raw === null && feature.normalized === null);
      }),
    ).toBe(true);
  });
});
