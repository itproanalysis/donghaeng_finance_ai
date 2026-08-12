import { describe, expect, it } from "vitest";

import {
  DEV_V1_FEATURE_REGISTRY,
  FeatureRegistryValidationError,
  assertValidFeatureRegistry,
  validateFeatureRegistry,
  type FeatureDefinition,
} from "../../src/domain/feature-registry";

function copyFeature(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...structuredClone(DEV_V1_FEATURE_REGISTRY[0]),
    ...overrides,
  };
}

function issuesFor(...features: Array<Record<string, unknown>>): string[] {
  return validateFeatureRegistry(features);
}

describe("dev-v1 feature registry runtime validation", () => {
  it("accepts the shipped registry and enforces it through the assertion boundary", () => {
    expect(validateFeatureRegistry()).toEqual([]);
    expect(() => assertValidFeatureRegistry(DEV_V1_FEATURE_REGISTRY)).not.toThrow();
  });

  it("rejects non-array, empty, non-object, duplicate-name, and blank-label registries", () => {
    expect(validateFeatureRegistry(null)).toEqual(["feature registry must be an array"]);
    expect(validateFeatureRegistry([])).toContain("feature registry must not be empty");

    const first = copyFeature({ label: " " });
    const duplicate = copyFeature();
    const issues = validateFeatureRegistry([first, duplicate, null]);

    expect(issues).toEqual(
      expect.arrayContaining([
        "empty feature label: monthly_average_sales",
        "duplicate feature name: monthly_average_sales",
        "feature[2] must be an object",
      ]),
    );
  });

  it("rejects blank, duplicate, unknown, and absent required source info codes", () => {
    const blank = copyFeature({
      name: "blank_source",
      sourceInfoCodes: [""],
    });
    const duplicate = copyFeature({
      name: "duplicate_source",
      sourceInfoCodes: ["monthly_average_sales", "monthly_average_sales"],
    });
    const unknown = copyFeature({
      name: "unknown_source",
      sourceInfoCodes: ["credit_score"],
    });
    const absent = copyFeature({
      name: "absent_source",
      sourceInfoCodes: [],
      requiredForCompletion: true,
    });

    expect(issuesFor(blank, duplicate, unknown, absent)).toEqual(
      expect.arrayContaining([
        "empty sourceInfoCodes[0]: blank_source",
        "duplicate source info code monthly_average_sales: duplicate_source",
        "unknown source info code credit_score: unknown_source",
        "required feature has no source info code: absent_source",
      ]),
    );
  });

  it("permits an optional future feature without a source but validates source types", () => {
    const optional = copyFeature({
      name: "optional_future_feature",
      sourceInfoCodes: [],
      requiredForCompletion: false,
    });
    expect(issuesFor(optional)).toEqual([]);

    const missingTypes = copyFeature({
      name: "missing_source_types",
      sourceTypes: [],
    });
    const invalidTypes = copyFeature({
      name: "invalid_source_types",
      sourceTypes: ["SELF_REPORTED", "SELF_REPORTED", "SOCIAL_MEDIA"],
    });
    expect(issuesFor(missingTypes, invalidTypes)).toEqual(
      expect.arrayContaining([
        "sourceTypes must be a non-empty array: missing_source_types",
        "duplicate source type SELF_REPORTED: invalid_source_types",
        "invalid source type SOCIAL_MEDIA: invalid_source_types",
      ]),
    );
  });

  it("rejects non-finite or inverted ranges and blank units", () => {
    const inverted = copyFeature({
      name: "inverted_range",
      range: { min: 2, max: 1, unit: "KRW" },
    });
    const nonFinite = copyFeature({
      name: "non_finite_range",
      range: { min: Number.NaN, max: null, unit: "KRW" },
    });
    const blankUnit = copyFeature({
      name: "blank_unit",
      range: { min: 0, max: null, unit: " " },
    });

    expect(issuesFor(inverted, nonFinite, blankUnit)).toEqual(
      expect.arrayContaining([
        "range min must be <= max: inverted_range",
        "range bounds must be finite numbers or null: non_finite_range",
        "range unit must be null or a non-empty string: blank_unit",
      ]),
    );
  });

  it("enforces normalizer and feature-type/range compatibility", () => {
    const booleanMismatch = copyFeature({
      name: "boolean_mismatch",
      normalizerId: "BOOLEAN_01",
    });
    const rubricMismatch = copyFeature({
      name: "rubric_mismatch",
      type: "RUBRIC",
      normalizerId: "RUBRIC_0_5",
      range: { min: 0, max: 1, unit: "LEVEL" },
    });
    const noneMismatch = copyFeature({
      name: "none_mismatch",
      type: "BOOLEAN",
      range: { min: 0, max: 1, unit: null },
    });

    expect(issuesFor(booleanMismatch, rubricMismatch, noneMismatch)).toEqual(
      expect.arrayContaining([
        "BOOLEAN_01 requires BOOLEAN with range 0..1: boolean_mismatch",
        "RUBRIC_0_5 requires RUBRIC with range 0..5: rubric_mismatch",
        "NONE_DEV_V1 is incompatible with BOOLEAN: none_mismatch",
      ]),
    );
  });

  it("requires the exact version, non-model status, and prohibited-proxy policy", () => {
    const invalid = copyFeature({
      name: "unsafe_feature",
      version: "dev-v2",
      modelCandidate: true,
      prohibitedProxyReview: {
        status: "FAILED",
        prohibitedInputs: ["sentiment", "credit_score"],
      },
    });
    const issues = issuesFor(invalid);

    expect(issues).toEqual(
      expect.arrayContaining([
        "invalid registry version: unsafe_feature",
        "dev-v1 modelCandidate must be false: unsafe_feature",
        "proxy review must be PASSED: unsafe_feature",
        "prohibited proxy inputs must match dev-v1 policy: unsafe_feature",
      ]),
    );
    expect(() => assertValidFeatureRegistry([invalid])).toThrow(
      FeatureRegistryValidationError,
    );
  });

  it("narrows a validated unknown registry to the runtime definition contract", () => {
    const registry: unknown = structuredClone(DEV_V1_FEATURE_REGISTRY);
    assertValidFeatureRegistry(registry);
    const typed: readonly FeatureDefinition[] = registry;
    expect(typed[0]?.version).toBe("dev-v1");
  });
});
