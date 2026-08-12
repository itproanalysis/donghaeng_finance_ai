import type { LiveFeatureSet, LiveFeatureValue } from "./feature-engine";
import type { CanonicalInformationRecord, NumericMeasure } from "./information-values";
import { selectedRevision } from "./information-values";

export type BorrowerSummarySectionKind =
  | "CURRENT_BUSINESS_STATE"
  | "KEY_BURDENS"
  | "CONFIRMED_STRENGTHS"
  | "BORROWER_IMPROVEMENT_PLAN"
  | "FUTURE_DEMAND_EVIDENCE"
  | "HOUSEHOLD_CASHFLOW"
  | "FOLLOWUP_ITEMS";

export interface EvidenceLinkedSummarySection {
  kind: BorrowerSummarySectionKind;
  text: string;
  evidenceIds: string[];
  asOf: string;
  gapStatement: boolean;
}

export interface EvidenceLinkedSummary {
  snapshotType: "PREVIEW" | "FINAL";
  version: number;
  generatedAt: string;
  sections: EvidenceLinkedSummarySection[];
  plainText: string;
}

function formatMeasure(measure: NumericMeasure, suffix: string): string {
  const number = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
  return measure.kind === "EXACT"
    ? `${number(measure.value)}${suffix}`
    : `${number(measure.min)}~${number(measure.max)}${suffix}`;
}

function featureByName(features: LiveFeatureSet, name: string): LiveFeatureValue | null {
  return features.features.find((feature) => feature.name === name) ?? null;
}

export function buildEvidenceLinkedSummary(input: {
  records: readonly CanonicalInformationRecord[];
  features: LiveFeatureSet;
  version: number;
  generatedAt: string;
  snapshotType?: "PREVIEW" | "FINAL";
}): EvidenceLinkedSummary {
  const sections: EvidenceLinkedSummarySection[] = [];
  const value = (infoCode: string) => {
    const record = input.records.find((candidate) => candidate.infoCode === infoCode);
    const revision = record ? selectedRevision(record) : null;
    return revision?.value ? { record, revision, value: revision.value } : null;
  };
  const push = (
    kind: BorrowerSummarySectionKind,
    text: string,
    evidenceIds: string[],
    asOf: string,
    gapStatement = false,
  ) => {
    if (!gapStatement && evidenceIds.length === 0) return;
    sections.push({ kind, text, evidenceIds: [...new Set(evidenceIds)], asOf, gapStatement });
  };

  const sales = value("monthly_average_sales");
  const costs = value("fixed_operating_costs");
  const currentParts: string[] = [];
  const currentEvidence: string[] = [];
  if (sales?.value.kind === "PERIODIC_MONEY") {
    currentParts.push(`최근 3개월 월평균 매출은 ${formatMeasure(sales.value.amount, "원")}으로 진술되었습니다.`);
    currentEvidence.push(...sales.revision.evidenceIds);
  }
  if (costs?.value.kind === "PERIODIC_MONEY") {
    currentParts.push(`월 고정 운영비는 ${formatMeasure(costs.value.amount, "원")}으로 진술되었습니다.`);
    currentEvidence.push(...costs.revision.evidenceIds);
  }
  const hallDecline = value("hall_customer_decline");
  if (
    hallDecline?.value.kind === "BUSINESS_SIGNAL" &&
    hallDecline.value.signal === "HALL_CUSTOMER_DECLINE"
  ) {
    currentParts.push(
      hallDecline.value.observed
        ? "차주는 최근 홀 손님이 감소했다고 진술했습니다."
        : "차주는 최근 홀 손님 감소가 없다고 진술했습니다.",
    );
    currentEvidence.push(...hallDecline.revision.evidenceIds);
  }
  const repeatCustomer = value("repeat_customer_share");
  if (repeatCustomer?.value.kind === "PERCENTAGE") {
    currentParts.push(
      `최근 한 달 반복고객 매출 비중은 ${formatMeasure(repeatCustomer.value.percentage, "%")}로 진술되었습니다.`,
    );
    currentEvidence.push(...repeatCustomer.revision.evidenceIds);
  }
  if (currentParts.length > 0) push("CURRENT_BUSINESS_STATE", currentParts.join(" "), currentEvidence, input.generatedAt);

  const fixedRatio = featureByName(input.features, "fixed_cost_ratio");
  const platformPressure = value("platform_fee_pressure");
  const burdenParts: string[] = [];
  const burdenEvidence: string[] = [];
  if (fixedRatio?.state === "COMPUTED") {
    burdenParts.push("동일 월 기준 고정비/매출 비율이 계산되었습니다. 이 값은 부담의 좋고 나쁨이나 승인 여부를 판단하지 않습니다.");
    burdenEvidence.push(...fixedRatio.evidenceIds);
  }
  if (
    platformPressure?.value.kind === "BUSINESS_SIGNAL" &&
    platformPressure.value.signal === "PLATFORM_FEE_PRESSURE" &&
    platformPressure.value.observed
  ) {
    burdenParts.push("차주는 배달 플랫폼 수수료를 주요 운영 부담으로 직접 진술했습니다.");
    burdenEvidence.push(...platformPressure.revision.evidenceIds);
  }
  if (burdenParts.length > 0) {
    push(
      "KEY_BURDENS",
      burdenParts.join(" "),
      burdenEvidence,
      input.generatedAt,
    );
  }

  const plan = value("improvement_plan");
  if (plan?.value.kind === "IMPROVEMENT_PLAN") {
    const actions = plan.value.actions
      .map((action) => action.text.trim())
      .filter(Boolean);
    const planText = !plan.value.planExists
      ? "차주는 현재 확정된 개선 계획이 없다고 직접 밝혔습니다."
      : actions.length > 0
        ? `차주가 직접 말한 개선 내용입니다. ${actions.join(" ")}`
        : "차주가 직접 밝힌 개선 계획은 아직 구체화되지 않았습니다.";
    push("BORROWER_IMPROVEMENT_PLAN", planText, plan.revision.evidenceIds, plan.revision.observedAt);
  }

  const readiness = value("execution_readiness");
  const reservations = value("confirmed_reservations");
  if (readiness?.value.kind === "EXECUTION_READINESS" && readiness.value.state === "READY") {
    push(
      "CONFIRMED_STRENGTHS",
      "차주는 개선계획 실행 준비가 완료되었다고 진술했으며, 준비 자원은 상세 근거에서 확인할 수 있습니다.",
      readiness.revision.evidenceIds,
      readiness.revision.observedAt,
    );
  } else if (reservations?.value.kind === "CONFIRMED_RESERVATIONS") {
    push(
      "CONFIRMED_STRENGTHS",
      `향후 4주 확정 예약·주문은 ${formatMeasure(reservations.value.count, "건")}으로 진술되었습니다.`,
      reservations.revision.evidenceIds,
      reservations.revision.observedAt,
    );
  }

  const seasonality = value("seasonality_outlook");
  const futureParts: string[] = [];
  const futureEvidence: string[] = [];
  if (reservations?.value.kind === "CONFIRMED_RESERVATIONS") {
    futureParts.push(`향후 4주 확정 건수는 ${formatMeasure(reservations.value.count, "건")}입니다.`);
    futureEvidence.push(...reservations.revision.evidenceIds);
  }
  if (seasonality?.value.kind === "SEASONALITY_OUTLOOK") {
    const basis = seasonality.value.bases.filter((entry) => entry.kind !== "BORROWER_EXPECTATION");
    futureParts.push(
      basis.length > 0
        ? `향후 3개월 전망 방향은 ${seasonality.value.direction}이며 차주가 ${basis.map((entry) => entry.kind).join(", ")} 근거를 제시했습니다.`
        : `향후 3개월 전망 방향은 ${seasonality.value.direction}이지만 확인 가능한 수요 근거는 아직 없습니다.`,
    );
    futureEvidence.push(...seasonality.revision.evidenceIds);
  }
  if (futureParts.length > 0) push("FUTURE_DEMAND_EVIDENCE", futureParts.join(" "), futureEvidence, input.generatedAt);

  const expenses = value("essential_household_expenses");
  const buffer = value("emergency_buffer_months");
  const householdParts: string[] = [];
  const householdEvidence: string[] = [];
  if (expenses?.value.kind === "PERIODIC_MONEY") {
    householdParts.push(`월 필수 가계지출은 ${formatMeasure(expenses.value.amount, "원")}입니다.`);
    householdEvidence.push(...expenses.revision.evidenceIds);
  }
  if (buffer?.value.kind === "DURATION") {
    householdParts.push(`비상자금으로 감당 가능한 기간은 ${formatMeasure(buffer.value.duration, "개월")}입니다.`);
    householdEvidence.push(...buffer.revision.evidenceIds);
  }
  if (householdParts.length > 0) push("HOUSEHOLD_CASHFLOW", householdParts.join(" "), householdEvidence, input.generatedAt);

  const unresolved = input.records.filter(
    (record) => record.required && record.status !== "CONFIRMED" && record.status !== "NOT_APPLICABLE",
  );
  if (unresolved.length > 0) {
    push(
      "FOLLOWUP_ITEMS",
      `추가 확인이 필요한 필수정보는 ${unresolved.map((record) => record.infoCode).join(", ")}입니다.`,
      unresolved.flatMap((record) => selectedRevision(record)?.evidenceIds ?? []),
      input.generatedAt,
      true,
    );
  } else {
    push(
      "FOLLOWUP_ITEMS",
      "추가 확인이 필요한 필수정보가 없습니다.",
      [],
      input.generatedAt,
      true,
    );
  }

  return {
    snapshotType: input.snapshotType ?? "PREVIEW",
    version: input.version,
    generatedAt: input.generatedAt,
    sections,
    plainText: sections.map((section) => section.text).join(" "),
  };
}

export function summaryPreviewDelta(
  before: EvidenceLinkedSummary,
  after: EvidenceLinkedSummary,
): EvidenceLinkedSummarySection[] {
  return after.sections.filter((section) => {
    const previous = before.sections.find((candidate) => candidate.kind === section.kind);
    return !previous || JSON.stringify(previous) !== JSON.stringify(section);
  });
}
