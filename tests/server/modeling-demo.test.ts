import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODELING_CASE_ID,
  getModelingBundle,
  getModelingCase,
  getModelingIndex,
  isModelingCaseId,
  type ModelingBundle,
} from "@/server/modeling-demo";

function pythonBundle(): ModelingBundle {
  const commands = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const command of commands) {
    const result = spawnSync(
      command,
      ["-m", "modeling.web_payload", "--skip-existing-validation", "--stdout"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    if (result.error && "code" in result.error && result.error.code === "ENOENT") continue;
    if (result.status !== 0) {
      throw new Error(`${command} modeling parity failed: ${result.stderr || result.error?.message}`);
    }
    return JSON.parse(result.stdout) as ModelingBundle;
  }
  throw new Error("Python 3 is required for modeling parity tests");
}

describe("generated modeling web artifact", () => {
  it("keeps the 94-vector, seven source counts, and missing-state boundary exact", () => {
    const bundle = getModelingBundle();
    expect(bundle.schemaVersion).toBe("modeling_web_v1");
    expect(bundle.model.featureCount).toBe(94);
    expect(bundle.model.sourceCounts.map((item) => item.featureCount)).toEqual([18, 18, 5, 6, 1, 30, 16]);
    expect(bundle.cases).toHaveLength(10);

    for (const item of bundle.cases) {
      expect(item.features).toHaveLength(94);
      expect(item.sourceSummary.map((source) => source.featureCount)).toEqual([18, 18, 5, 6, 1, 30, 16]);
      expect(item.featureSummary.total).toBe(94);
      expect(item.featureSummary.valueCount + Object.entries(item.featureSummary.statusCounts)
        .filter(([status]) => status !== "VALUE")
        .reduce((sum, [, count]) => sum + count, 0)).toBe(94);
      expect(item.features.some((feature) => feature.code.startsWith("ext_"))).toBe(false);
      expect(item.externalContext).toMatchObject({
        role: "CONTEXT_ONLY",
        includedInFeatureVector: false,
        includedInScore: false,
      });
      for (const axis of [item.scorecard.currentSituation, item.scorecard.improvement]) {
        expect(axis.items).toHaveLength(5);
        for (const scoreItem of axis.items) {
          expect(scoreItem.lineage.length).toBeGreaterThan(0);
          expect(scoreItem.lineage.some((lineage) => lineage.feature.startsWith("ext_") || lineage.source === "EXTERNAL_BENCHMARK")).toBe(false);
        }
      }
    }
  });

  it("preserves the verified scores, interview comparison caveat, and reevaluation behavior", () => {
    expect(DEFAULT_MODELING_CASE_ID).toBe("case_operating_drop");
    expect(getModelingCase("case_customer_drop")?.scorecard).toMatchObject({ currentSituation: { score: 78 }, improvement: { score: 60 } });
    expect(getModelingCase("case_ticket_drop")?.scorecard).toMatchObject({ currentSituation: { score: 78 }, improvement: { score: 60 } });
    expect(getModelingCase("case_operating_drop")?.scorecard).toMatchObject({ currentSituation: { score: 78 }, improvement: { score: 67.5 } });
    expect(getModelingCase("case_no_answer")?.scorecard.improvement.score).toBe(30);
    expect(getModelingCase("case_new_low")?.scorecard).toMatchObject({ currentSituation: { score: 0 }, improvement: { score: 40 } });

    const index = getModelingIndex();
    expect(index.comparisons.interviewEffect).toMatchObject({
      improvementScoreDelta: 27.5,
      basisComparable: false,
      before: { scorecard: { improvement: { itemsUsed: 3 } } },
      after: { scorecard: { improvement: { itemsUsed: 4 } } },
    });
    expect(index.reevaluation).toMatchObject({
      goalFeature: "biz_operating_day_count_avg_3m",
      direction: "INCREASE",
      reached: true,
      afterInterviewReused: false,
      afterInterviewFeatureStatusCounts: { MISSING: 30 },
    });
    expect(index.comparisons.sameSalesDecline.invariants).toMatchObject({
      salesGrowthEqual: true,
      currentSituationEqual: true,
    });
  });

  it("rejects unknown and traversal-shaped case identifiers", () => {
    for (const value of ["", "case_unknown", "../case_operating_drop", "case_operating_drop/../../x"]) {
      expect(isModelingCaseId(value)).toBe(false);
      expect(getModelingCase(value)).toBeNull();
    }
  });

  it("uses each selected case's own recalculation and preserves all structured inputs", () => {
    for (const item of getModelingBundle().cases) {
      const effect = item.modelingEffect;
      expect(effect.caseId).toBe(item.caseId);
      expect(effect.structuredInputsUnchanged).toBe(true);
      expect(effect.after.scorecard).toEqual(item.scorecard);
      expect(effect.before.interviewPresent).toBe(false);
      expect(effect.after.interviewPresent).toBe(item.interviewConversion.interviewPresent);
      expect(effect.changedFeatures.every((row) => row.source === "INTERVIEW" || row.source === "COMBINED")).toBe(true);
      for (const row of effect.changedFeatures) {
        expect(row.after).toEqual(item.features.find((feature) => feature.code === row.feature)?.value);
        for (const link of row.metricLinks) {
          expect(effect.after.scorecard[link.axis].items.find((metric) => metric.name === link.item)?.lineage.some((lineage) => lineage.feature === row.feature)).toBe(true);
        }
      }
      if (!effect.after.interviewPresent) {
        expect(effect.changedFeatures).toEqual([]);
        expect(effect.changedScoreItems).toEqual([]);
        expect(effect.before.scorecard).toEqual(effect.after.scorecard);
      }
    }
    expect(getModelingCase("case_no_answer")?.modelingEffect.after.scorecard.improvement.score).toBe(30);
  });

  it("reconciles visible scores to included points in both modes without counting excluded items as zero", () => {
    for (const item of getModelingBundle().cases) {
      for (const mode of ["before", "after"] as const) {
        for (const key of ["currentSituation", "improvement"] as const) {
          const axis = item.modelingEffect[mode].scorecard[key];
          const included = axis.items.filter((metric) => !metric.excluded);
          const earned = included.reduce((sum, metric) => sum + Number(metric.points), 0);
          const available = included.reduce((sum, metric) => sum + metric.maxPoints, 0);
          expect(axis.accounting).toMatchObject({ earnedPoints: earned, availablePoints: available, coverageRatio: included.length / 5, isConfidence: false });
          expect(axis.accounting.excludedItems).toEqual(axis.items.filter((metric) => metric.excluded).map((metric) => metric.name));
          if (available) {
            expect(axis.score).toBeCloseTo(earned / available * 100);
            expect(included.reduce((sum, metric) => sum + Number(metric.normalizedContribution), 0)).toBeCloseTo(Number(axis.score));
          } else expect(axis.score).toBe("MISSING");
          for (const metric of axis.items.filter((metric) => metric.excluded)) {
            expect(metric.points).toBeNull();
            expect(metric.normalizedContribution).toBeNull();
          }
        }
      }
    }
    const comparison = getModelingCase("case_operating_drop")!.modelingEffect;
    expect(comparison.before.scorecard.improvement.accounting.availablePoints).toBe(60);
    expect(comparison.after.scorecard.improvement.accounting.availablePoints).toBe(80);
    expect(comparison.basisComparable).toBe(false);
  });

  it("verifies the deterministic artifact checksum", () => {
    const commands = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
    for (const command of commands) {
      const result = spawnSync(command, [
        "-c",
        "import json; from modeling.web_payload import verify_checksum; print(verify_checksum(json.load(open('src/generated/modeling-demo.json', encoding='utf-8'))))",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
      });
      if (result.error && "code" in result.error && result.error.code === "ENOENT") continue;
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("True");
      return;
    }
    throw new Error("Python 3 is required for modeling checksum tests");
  });

  it("matches fresh Python output for all ten cases, their score accounting and comparisons", () => {
    const generated = getModelingBundle();
    const fresh = pythonBundle();
    expect(generated.reevaluation).toEqual(fresh.reevaluation);
    for (const { caseId } of generated.cases) {
      const webCase = generated.cases.find((item) => item.caseId === caseId);
      const pythonCase = fresh.cases.find((item) => item.caseId === caseId);
      expect(pythonCase, caseId).toBeDefined();
      expect(webCase?.features, caseId).toEqual(pythonCase?.features);
      expect(webCase?.scorecard, caseId).toEqual(pythonCase?.scorecard);
      expect(webCase?.modelingEffect, caseId).toEqual(pythonCase?.modelingEffect);
    }
  }, 30_000);
});
