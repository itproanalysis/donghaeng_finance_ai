import { describe, expect, it } from "vitest";

import { GET as getIndex } from "@/app/api/demo/modeling/route";
import { GET as getCase } from "@/app/api/demo/modeling/[caseId]/route";

describe("public modeling demo routes", () => {
  it("serves a cacheable synthetic index without an auth session", async () => {
    const response = getIndex(new Request("https://review.example/api/demo/modeling"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    const body = await response.json();
    expect(body.data).toMatchObject({
      schemaVersion: "modeling_web_v1",
      defaultCaseId: "case_operating_drop",
      model: { featureCount: 94, trainedModel: false, prediction: false },
    });
    expect(body.data.cases).toHaveLength(10);
  });

  it("serves one exact case and fails closed for unknown identifiers", async () => {
    const valid = await getCase(
      new Request("https://review.example/api/demo/modeling/case_operating_drop"),
      { params: Promise.resolve({ caseId: "case_operating_drop" }) },
    );
    expect(valid.status).toBe(200);
    const validBody = await valid.json();
    expect(validBody.data).toMatchObject({
      caseId: "case_operating_drop",
      mock: true,
      featureSummary: { total: 94 },
      scorecard: { currentSituation: { score: 78 }, improvement: { score: 67.5 } },
      externalContext: { includedInFeatureVector: false, includedInScore: false },
    });
    expect(validBody.data.features).toHaveLength(94);

    const missing = await getCase(
      new Request("https://review.example/api/demo/modeling/..%2Fsecret"),
      { params: Promise.resolve({ caseId: "../secret" }) },
    );
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      data: null,
      error: { code: "MODELING_CASE_NOT_FOUND" },
    });
  });
});
