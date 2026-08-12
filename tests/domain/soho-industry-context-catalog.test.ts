import { describe, expect, it } from "vitest";

import {
  DEV_V1_INFO_CODES,
  INTERVIEW_CONTEXT_CATALOG,
  REQUIRED_SEASONALITY_LABELS,
  REQUIRED_SITUATION_LABELS,
  REQUIRED_SOHO_INDUSTRY_LABELS,
  SOHO_INDUSTRY_CATALOG,
  buildIndustryRequiredInformationCodes,
  createIndustryInterviewProfile,
  findInterviewContext,
  findSohoIndustryProfile,
  getInterviewContextsByKind,
  validateInterviewContextCatalog,
  validateSohoIndustryCatalog,
} from "../../src/domain";
import {
  CONTEXT_CATALOG_FIXTURES,
  SOHO_INDUSTRY_CATALOG_FIXTURES,
} from "../fixtures/industry-context-catalog";

describe("dev-v1 SOHO industry catalog", () => {
  it("요구된 11개 업종을 exact label과 allow-listed code로 지원한다", () => {
    expect(SOHO_INDUSTRY_CATALOG).toHaveLength(11);
    expect(SOHO_INDUSTRY_CATALOG.map((profile) => profile.label)).toEqual(
      REQUIRED_SOHO_INDUSTRY_LABELS,
    );
    expect(new Set(SOHO_INDUSTRY_CATALOG.map((profile) => profile.code))).toHaveLength(11);
    expect(validateSohoIndustryCatalog()).toEqual([]);
  });

  it.each(SOHO_INDUSTRY_CATALOG_FIXTURES)(
    "$input을 $expectedCode 업종 profile로 선택한다",
    ({ input, expectedCode, expectedLabel, expectedIndustryInfoCode, expectedGoalMetric }) => {
      const profile = findSohoIndustryProfile(input);
      expect(profile).toMatchObject({ code: expectedCode, label: expectedLabel });
      expect(profile?.industryInformationItems.map((item) => item.infoCode)).toContain(
        expectedIndustryInfoCode,
      );
      expect(profile?.goalCandidates.map((goal) => goal.metric)).toContain(expectedGoalMetric);
    },
  );

  it("strict dev-v1 8개와 catalog-only 업종 후보를 분리한다", () => {
    const profile = createIndustryInterviewProfile("ONLINE_SHOPPING");
    expect(profile).not.toBeNull();
    expect(profile?.strictRequiredInformationCodes).toEqual(DEV_V1_INFO_CODES);
    expect(profile?.industryInformationCandidates.every((item) =>
      item.runtimeState === "CATALOG_ONLY" && item.missingValue === null
    )).toBe(true);
    expect(profile?.industryInformationCandidates.map((item) => item.infoCode)).not.toContain(
      "monthly_average_sales",
    );
    expect(buildIndustryRequiredInformationCodes("ONLINE_SHOPPING")).toEqual([
      ...DEV_V1_INFO_CODES,
      ...profile!.industryInformationCandidates.map((item) => item.infoCode),
    ]);
  });

  it("업종마다 정보수집 항목과 목표 후보가 다르고 숫자 목표를 만들지 않는다", () => {
    const informationSignatures = SOHO_INDUSTRY_CATALOG.map((profile) =>
      profile.industryInformationItems.map((item) => item.infoCode).sort().join("|"),
    );
    const goalSignatures = SOHO_INDUSTRY_CATALOG.map((profile) =>
      profile.goalCandidates.map((goal) => goal.metric).sort().join("|"),
    );
    expect(new Set(informationSignatures)).toHaveLength(11);
    expect(new Set(goalSignatures)).toHaveLength(11);
    expect(SOHO_INDUSTRY_CATALOG.every((profile) =>
      profile.numericDefaultsAllowed === false &&
      profile.goalCandidates.every((goal) =>
        goal.state === "SUGGESTED" &&
        goal.defaultTarget === null &&
        goal.requiresBorrowerConfirmation
      )
    )).toBe(true);
    expect(findSohoIndustryProfile("지원하지 않는 업종")).toBeNull();
  });
});

describe("dev-v1 seasonality/situation context catalog", () => {
  it("10개 계절성과 9개 상황을 빠짐없이 제공한다", () => {
    expect(getInterviewContextsByKind("SEASONALITY").map((entry) => entry.label)).toEqual(
      REQUIRED_SEASONALITY_LABELS,
    );
    expect(getInterviewContextsByKind("SITUATION").map((entry) => entry.label)).toEqual(
      REQUIRED_SITUATION_LABELS,
    );
    expect(INTERVIEW_CONTEXT_CATALOG).toHaveLength(19);
    expect(validateInterviewContextCatalog()).toEqual([]);
  });

  it.each(CONTEXT_CATALOG_FIXTURES)(
    "$input context를 $expectedLabel/$expectedKind로 정규화한다",
    ({ input, expectedLabel, expectedKind }) => {
      expect(findInterviewContext(input)).toMatchObject({
        label: expectedLabel,
        kind: expectedKind,
      });
    },
  );

  it("본인 과거 seasonality를 우선하고 context 자체로 점수를 조정하지 않는다", () => {
    expect(INTERVIEW_CONTEXT_CATALOG.every((definition) =>
      definition.comparisonPolicy === "BORROWER_HISTORY_FIRST" &&
      definition.externalBaselinePolicy === "ONLY_IF_BORROWER_HISTORY_UNAVAILABLE" &&
      definition.scoreEffect === "CONTEXT_ONLY" &&
      definition.modelCandidate === false &&
      definition.defaultAdjustment === null &&
      definition.evidencePrompts.length > 0
    )).toBe(true);
    expect(findInterviewContext("알 수 없는 상황")).toBeNull();
  });
});
