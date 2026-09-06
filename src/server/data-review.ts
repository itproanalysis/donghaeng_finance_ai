import { FEATURE_DICTIONARY_V2, type FeatureV2Set } from "@/domain/improvement-feature-pipeline";
import { selectedRevision, type CanonicalInformationRecord } from "@/domain/information-values";
import { buildAllowlistedImprovementCandidates, improvementPlanCandidateDisplayValue, type BorrowerImprovementSelection } from "@/domain/improvement-candidate-selection";
import type { DataReview, FeatureTrace, ReviewFeature } from "@/domain/data-review";
import type { InterviewApiSnapshot } from "./interview-service";

/** Metadata for the canonical conversions in rawFeatureV2FromInterview. No values are calculated here. */
const CANONICAL_INPUTS: Readonly<Record<string, readonly string[]>> = {
  fin_sales_avg_3m: ["monthly_average_sales"], fin_fixed_cost_ratio: ["fixed_operating_costs", "monthly_average_sales"],
  ops_repeat_customer_ratio: ["repeat_customer_share"],
  own_goal_target_value: ["improvement_plan"], own_goal_target_unit: ["improvement_plan"],
  own_goal_horizon_days: ["improvement_plan"], own_goal_self_selected_flag: ["improvement_plan"],
  own_plan_measurement_metric: ["improvement_plan"], own_plan_constraint_count: ["execution_readiness"],
  own_plan_budget: ["execution_readiness"],
};
const CANONICAL_CALCULATIONS: Readonly<Record<string, string>> = {
  fin_sales_avg_3m: "monthly_average_sales.amount (EXACT, KRW, 3m)",
  fin_fixed_cost_ratio: "fixed_operating_costs.amount / monthly_average_sales.amount (sales > 0)",
  ops_repeat_customer_ratio: "repeat_customer_share.percentage / 100",
  own_goal_horizon_days: "improvement_plan.schedule × (WEEK: 7, MONTH: 30)",
  own_plan_horizon_days: "improvement_plan.schedule ?? execution_readiness.schedule; WEEK × 7, MONTH × 30",
  own_plan_constraint_count: "execution_readiness.blockers.length (관측된 제약만)",
};
// Expected inputs are explanatory metadata for v2's available-input means.
// They are not an additional scoring model and do not fill missing values.
export const SIGNAL_INPUTS: Readonly<Record<string, readonly string[]>> = {
  imp_recovery_momentum: ["fin_sales_growth_3m", "fin_cashflow_trend_slope_6m", "fin_month_end_balance_growth_3m", "crd_delinquency_recovery_trend", "biz_recent_activity_flag"],
  imp_cashflow_stabilization: ["fin_month_end_balance_growth_3m", "fin_net_cashflow_positive_month_ratio_6m", "fin_cashflow_deficit_month_count_6m", "crd_payment_to_sales_ratio"],
  imp_cost_adjustment_headroom: ["fin_fixed_cost_gap_peer", "fin_marketing_cost_gap_peer", "fin_interest_cost_ratio", "own_goal_category"],
  imp_sales_recovery_potential: ["biz_sales_recovery_from_min_6m", "ops_repeat_customer_ratio", "fin_sales_growth_3m", "ext_sales_growth_gap_peer"],
  imp_plan_specificity: ["own_goal_target_value", "own_goal_horizon_days", "own_plan_budget", "own_plan_measurement_metric", "own_plan_start_date", "own_plan_constraint_count"],
  imp_plan_feasibility: ["own_goal_target_value", "own_goal_horizon_days", "own_plan_horizon_days", "own_plan_budget", "own_plan_weekly_time_hours", "own_plan_constraint_count"],
  imp_goal_problem_alignment: ["own_primary_problem_category", "own_goal_category"],
  imp_overall_improvement_signal: ["imp_recovery_momentum", "imp_cashflow_stabilization", "imp_cost_adjustment_headroom", "imp_sales_recovery_potential", "imp_plan_specificity", "imp_plan_feasibility"],
};

/** Projection only: features always come from InterviewService's actual LIVE/FINAL artifact. */
export function buildDataReview(snapshot: InterviewApiSnapshot, selection: BorrowerImprovementSelection | null, frozen: boolean): DataReview {
  const records: CanonicalInformationRecord[] = "canonicalInformationItems" in snapshot ? snapshot.canonicalInformationItems
    : snapshot.informationItems.filter((item): item is CanonicalInformationRecord => "revisions" in item);
  const canonical = records.map((record) => ({ ...record, selected: selectedRevision(record) ?? null }));
  const evidence = ("evidence" in snapshot ? snapshot.evidence : snapshot.evidenceManifest).map((item) => ({
    ...item, originalText: snapshot.transcript?.find((segment) => segment.id === item.transcriptSegmentId)?.text ?? null,
  }));
  const artifact: FeatureV2Set | null = snapshot.improvementFeatures;
  const byName = new Map(artifact?.features.map((feature) => [feature.name, feature]) ?? []);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  function trace(name: string, path: string[] = []): FeatureTrace[] {
    if (path.includes(name)) return [];
    const feature = byName.get(name);
    if (!feature || feature.state !== "COMPUTED") return [];
    let codes = CANONICAL_INPUTS[name];
    if (name === "own_plan_horizon_days") {
      const plan = canonical.find((item) => item.infoCode === "improvement_plan")?.selected?.value;
      codes = plan?.kind === "IMPROVEMENT_PLAN" && plan.schedule?.duration.kind === "EXACT" ? ["improvement_plan"] : ["execution_readiness"];
    }
    if (codes) return codes.map((infoCode) => {
      const revision = canonical.find((item) => item.infoCode === infoCode)?.selected;
      return { featureNames: [...path, name], infoCode, revisionId: revision?.id ?? null,
        evidenceIds: revision?.evidenceIds.filter((id) => evidenceIds.has(id)) ?? [] };
    });
    return feature.sourceFeatures.filter((source) => source !== name).flatMap((source) => trace(source, [...path, name]));
  }
  const features: ReviewFeature[] = (artifact?.features ?? []).map((feature) => {
    const definition = FEATURE_DICTIONARY_V2.find((item) => item.name === feature.name)!;
    const traces = trace(feature.name);
    const expectedInputs = [...(SIGNAL_INPUTS[feature.name] ?? [])];
    const missingInputs = expectedInputs.filter((name) => byName.get(name)?.state !== "COMPUTED");
    return { ...feature, definition, traces, expectedInputs, missingInputs,
      calculation: feature.calculation ?? CANONICAL_CALCULATIONS[feature.name] ?? null,
      evidenceIds: [...new Set(traces.flatMap((item) => item.evidenceIds))],
      interpretation: feature.state === "MISSING" ? "정보 부족" : feature.state === "NOT_CALCULABLE" ? "계산 불가"
        : expectedInputs.length > 0 ? missingInputs.length > 0 ? "일부 입력 확인" : "계산 입력 확보" : "직접 진술에서 변환",
    };
  });
  const goal = "goalSnapshot" in snapshot ? snapshot.goalSnapshot : null;
  const legacy = "legacyInformationItems" in snapshot ? snapshot.legacyInformationItems : "canonicalInformationItems" in snapshot ? snapshot.informationItems : [];
  return {
    interviewId: snapshot.session.id, businessName: snapshot.business.businessName, borrowerName: snapshot.borrower.name,
    version: snapshot.session.version, snapshotType: snapshot.snapshotType, lifecycleStatus: snapshot.session.lifecycleStatus,
    finalHash: "contentHash" in snapshot ? snapshot.contentHash : null,
    featureArtifactOrigin: snapshot.snapshotType === "PREVIEW" ? "LIVE_SERVER" : frozen ? "FROZEN_FINAL" : "LEGACY_PROJECTION",
    schemaVersion: artifact?.schemaVersion ?? null, enabled: artifact?.enabled ?? false,
    metrics: {
      confirmed: canonical.filter((item) => item.status === "CONFIRMED").length,
      needed: canonical.filter((item) => !["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(item.status)).length,
      evidence: evidence.length, computed: features.filter((item) => item.state === "COMPUTED").length,
      missing: features.filter((item) => item.state === "MISSING").length, notCalculable: features.filter((item) => item.state === "NOT_CALCULABLE").length,
      totalFeatures: features.length, totalInformation: canonical.length,
      evidenceCovered: canonical.filter((item) => item.selected?.evidenceIds.some((id) => evidenceIds.has(id))).length,
      resolvedRequired: snapshot.coverage.resolvedRequired, totalRequired: snapshot.coverage.totalRequired,
    }, canonical, evidence, features, selection,
    candidates: buildAllowlistedImprovementCandidates({ informationItems: legacy.map((item) => ({
      infoCode: item.infoCode, status: item.status, updatedAt: item.updatedAt, evidenceIds: item.evidenceIds,
      displayValue: item.infoCode === "improvement_plan" ? improvementPlanCandidateDisplayValue(item.value) : item.status === "CONFIRMED" && item.value !== null ? "CONFIRMED_VALUE" : null,
    })), goal: goal ? { status: goal.status, title: goal.title, evidenceIds: goal.evidenceIds } : null }),
    summary: "liveSummary" in snapshot ? snapshot.liveSummary.plainText : "transcriptSummary" in snapshot ? snapshot.transcriptSummary : null,
  };
}
