import {
  DEV_V1_FEATURE_REGISTRY,
  DEV_V1_FEATURE_REGISTRY_VERSION,
  type FeatureDefinition,
} from "./feature-registry";
import type { EvidenceKind, InformationCategory } from "./interview";
import {
  type CanonicalInformationRecord,
  type CanonicalInformationValue,
  type CanonicalValueRevision,
  type ExecutionReadinessValue,
  type NumericMeasure,
  selectedRevision,
} from "./information-values";
import {
  DETERMINISTIC_DEV_RUBRIC_CLASSIFIER,
  parseRubricClassifierOutput,
  type RubricClassifierPort,
  type RubricFeatureName,
} from "./rubric-classifier";

export type FeatureComputationState =
  | "COMPUTED"
  | "MISSING"
  | "UNKNOWN"
  | "REFUSED"
  | "NOT_APPLICABLE"
  | "CONFLICTING"
  | "NOT_CALCULABLE";

export interface LiveFeatureValue {
  name: string;
  domain: InformationCategory;
  state: FeatureComputationState;
  raw: unknown;
  normalized: number | null;
  sourceInfoCodes: string[];
  verification: EvidenceKind | null;
  evidenceIds: string[];
  formula: string | null;
  reason: string;
  registryVersion: typeof DEV_V1_FEATURE_REGISTRY_VERSION;
}

export interface LiveFeatureSet {
  snapshotType: "PREVIEW" | "FINAL";
  stateVersion: number;
  registryVersion: typeof DEV_V1_FEATURE_REGISTRY_VERSION;
  features: LiveFeatureValue[];
}

function missingFeature(definition: FeatureDefinition, reason = "필요한 canonical 입력이 없습니다."): LiveFeatureValue {
  return {
    name: definition.name,
    domain: definition.domain,
    state: "MISSING",
    raw: null,
    normalized: null,
    sourceInfoCodes: definition.sourceInfoCodes,
    verification: null,
    evidenceIds: [],
    formula: null,
    reason,
    registryVersion: DEV_V1_FEATURE_REGISTRY_VERSION,
  };
}

function conflictingFeature(
  definition: FeatureDefinition,
  reason = "원천 정보 항목이 충돌(CONFLICTING) 상태이므로 피처 계산을 유예합니다.",
): LiveFeatureValue {
  return {
    name: definition.name,
    domain: definition.domain,
    state: "CONFLICTING",
    raw: null,
    normalized: null,
    sourceInfoCodes: definition.sourceInfoCodes,
    verification: "CONFLICTING",
    evidenceIds: [],
    formula: null,
    reason,
    registryVersion: DEV_V1_FEATURE_REGISTRY_VERSION,
  };
}

function recordValue(
  records: readonly CanonicalInformationRecord[],
  infoCode: string,
): { record: CanonicalInformationRecord; revision: CanonicalValueRevision; value: CanonicalInformationValue } | null {
  const record = records.find((candidate) => candidate.infoCode === infoCode);
  if (!record) return null;
  const revision = selectedRevision(record);
  if (!revision?.value || revision.valueState !== "PRESENT") return null;
  return { record, revision, value: revision.value };
}

function computed(
  definition: FeatureDefinition,
  raw: unknown,
  normalized: number | null,
  revisions: CanonicalValueRevision[],
  reason: string,
  formula: string | null = null,
  evidenceIdsOverride?: readonly string[],
): LiveFeatureValue {
  return {
    name: definition.name,
    domain: definition.domain,
    state: "COMPUTED",
    raw,
    normalized,
    sourceInfoCodes: definition.sourceInfoCodes,
    verification: formula ? "SYSTEM_DERIVED" : revisions[0]?.verification ?? null,
    evidenceIds: evidenceIdsOverride
      ? [...evidenceIdsOverride]
      : [...new Set(revisions.flatMap((revision) => revision.evidenceIds))],
    formula,
    reason,
    registryVersion: DEV_V1_FEATURE_REGISTRY_VERSION,
  };
}

function measureBounds(measure: NumericMeasure): [number, number] {
  return measure.kind === "EXACT" ? [measure.value, measure.value] : [measure.min, measure.max];
}

function ratioMeasure(numerator: NumericMeasure, denominator: NumericMeasure): NumericMeasure | null {
  const [nMin, nMax] = measureBounds(numerator);
  const [dMin, dMax] = measureBounds(denominator);
  if (dMin === 0 && dMax === 0) {
    if (nMin === 0 && nMax === 0) {
      return { kind: "EXACT", value: 0 };
    }
    return null;
  }
  if (dMin <= 0) return null;
  const min = nMin / dMax;
  const max = nMax / dMin;
  return min === max ? { kind: "EXACT", value: min } : { kind: "RANGE", min, max };
}

function percentageAsRatio(measure: NumericMeasure): NumericMeasure {
  return measure.kind === "EXACT"
    ? { kind: "EXACT", value: measure.value / 100 }
    : { kind: "RANGE", min: measure.min / 100, max: measure.max / 100 };
}

function comparableMonthlyMoney(
  left: Extract<CanonicalInformationValue, { kind: "PERIODIC_MONEY" }>,
  right: Extract<CanonicalInformationValue, { kind: "PERIODIC_MONEY" }>,
): boolean {
  return (
    left.currency === right.currency &&
    left.cadence === right.cadence &&
    left.referenceWindow.unit === right.referenceWindow.unit &&
    left.referenceWindow.count === right.referenceWindow.count &&
    left.referenceWindow.relation === right.referenceWindow.relation
  );
}

function setFeature(map: Map<string, LiveFeatureValue>, value: LiveFeatureValue): void {
  map.set(value.name, value);
}

export function calculateLiveFeatures(input: {
  records: readonly CanonicalInformationRecord[];
  stateVersion: number;
  snapshotType?: "PREVIEW" | "FINAL";
  rubricClassifier?: RubricClassifierPort;
}): LiveFeatureSet {
  const conflictingInfoCodes = new Set(
    input.records
      .filter(
        (r) =>
          r.revisions.some((rev) => rev.status === "CONFLICTING"),
      )
      .map((r) => r.infoCode),
  );

  const featureMap = new Map(
    DEV_V1_FEATURE_REGISTRY.map((definition) => {
      const isConflicting = definition.sourceInfoCodes.some((code) =>
        conflictingInfoCodes.has(code),
      );
      return [
        definition.name,
        isConflicting ? conflictingFeature(definition) : missingFeature(definition),
      ];
    }),
  );
  const definition = (name: string): FeatureDefinition => {
    const found = DEV_V1_FEATURE_REGISTRY.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`등록되지 않은 feature입니다: ${name}`);
    return found;
  };

  const sales = recordValue(input.records, "monthly_average_sales");
  const costs = recordValue(input.records, "fixed_operating_costs");
  if (sales?.value.kind === "PERIODIC_MONEY") {
    setFeature(featureMap, computed(definition("monthly_average_sales"), sales.value.amount, null, [sales.revision], "정규화하지 않은 월평균 매출 원천값입니다."));
  }

  const repeatCustomer = recordValue(input.records, "repeat_customer_share");
  if (repeatCustomer?.value.kind === "PERCENTAGE") {
    setFeature(
      featureMap,
      computed(
        definition("repeat_customer_share"),
        percentageAsRatio(repeatCustomer.value.percentage),
        null,
        [repeatCustomer.revision],
        "차주가 말한 반복고객 매출 비중을 0~1 비율로 단위 변환했습니다.",
        "repeat_customer_percentage / 100",
      ),
    );
  }
  const hallDecline = recordValue(input.records, "hall_customer_decline");
  if (
    hallDecline?.value.kind === "BUSINESS_SIGNAL" &&
    hallDecline.value.signal === "HALL_CUSTOMER_DECLINE"
  ) {
    setFeature(
      featureMap,
      computed(
        definition("shock_present"),
        hallDecline.value.observed,
        hallDecline.value.observed ? 1 : 0,
        [hallDecline.revision],
        "홀 손님 감소에 대한 차주의 직접 진술을 사업 충격 descriptor로 연결했습니다.",
      ),
    );
  }
  if (costs?.value.kind === "PERIODIC_MONEY") {
    setFeature(featureMap, computed(definition("fixed_operating_costs"), costs.value.amount, null, [costs.revision], "정규화하지 않은 월 고정비 원천값입니다."));
  }
  if (sales?.value.kind === "PERIODIC_MONEY" && costs?.value.kind === "PERIODIC_MONEY") {
    const fixedCostDefinition = definition("fixed_cost_ratio");
    const ratio = comparableMonthlyMoney(costs.value, sales.value)
      ? ratioMeasure(costs.value.amount, sales.value.amount)
      : null;
    setFeature(
      featureMap,
      ratio
        ? computed(fixedCostDefinition, ratio, null, [sales.revision, costs.revision], "동일 월 기준 비용/매출 비율이며 값의 좋고 나쁨을 판단하지 않습니다.", "fixed_operating_costs / monthly_average_sales")
        : {
            ...missingFeature(fixedCostDefinition),
            state: "NOT_CALCULABLE",
            sourceInfoCodes: fixedCostDefinition.sourceInfoCodes,
            evidenceIds: [...new Set([...sales.revision.evidenceIds, ...costs.revision.evidenceIds])],
            verification: "SYSTEM_DERIVED",
            formula: "fixed_operating_costs / monthly_average_sales",
            reason: comparableMonthlyMoney(costs.value, sales.value)
              ? "매출 범위가 0을 포함해 비율을 안전하게 계산할 수 없습니다."
              : "매출과 고정비의 기준기간이 달라 비율을 계산하지 않았습니다.",
          },
    );
  }

  const planInput = recordValue(input.records, "improvement_plan");
  if (planInput?.value.kind === "IMPROVEMENT_PLAN") {
    const plan = planInput.value;
    const classifier = input.rubricClassifier ?? DETERMINISTIC_DEV_RUBRIC_CLASSIFIER;
    const classify = (rubric: RubricFeatureName) =>
      parseRubricClassifierOutput(
        classifier.classify({
          rubric,
          plan,
          allowedEvidenceIds: [...planInput.revision.evidenceIds],
        }),
        new Set(planInput.revision.evidenceIds),
      );
    const problemSpecificity = classify("problem_specificity");
    const planSpecificity = classify("plan_specificity");
    const planFeatures: Array<[string, unknown, number | null, string]> = [
      ["self_plan_exists", plan.planExists, plan.planExists ? 1 : 0, "계획 존재 여부의 직접 관측값입니다."],
      ["plan_action_count", plan.actions.length, null, "차주가 직접 말한 실행 행동 수입니다."],
      ["plan_time_bound", plan.schedule !== null, plan.schedule ? 1 : 0, "명시된 기간의 존재 여부입니다."],
      ["plan_measurability", plan.target !== null || plan.measurementSources.length > 0, plan.target !== null || plan.measurementSources.length > 0 ? 1 : 0, "명시된 목표수치 또는 측정출처의 존재 여부입니다."],
    ];
    for (const [name, raw, normalized, reason] of planFeatures) {
      setFeature(featureMap, computed(definition(name), raw, normalized, [planInput.revision], reason));
    }
    for (const [name, classification] of [
      ["problem_specificity", problemSpecificity],
      ["plan_specificity", planSpecificity],
    ] as const) {
      setFeature(
        featureMap,
        computed(
          definition(name),
          classification,
          classification.level / 5,
          [planInput.revision],
          "classifier가 반환한 0~5 정수 level을 서버 feature engine이 5로 나눴습니다.",
          "rubric_level / 5",
          classification.evidenceIds,
        ),
      );
    }
  }

  const readinessInput = recordValue(input.records, "execution_readiness");
  if (readinessInput?.value.kind === "EXECUTION_READINESS") {
    const readiness: ExecutionReadinessValue = readinessInput.value;
    const normalized = readiness.state === "READY" ? 1 : readiness.state === "PARTIAL" ? 0.5 : 0;
    const values: Array<[string, unknown, number | null, string]> = [
      ["execution_readiness", readiness.state, normalized, "준비상태 3단계를 0/0.5/1로 표현한 dev-v1 descriptor입니다."],
      ["past_execution_examples", readiness.pastExamples.length, null, "차주가 직접 말한 과거 실행 사례 수입니다."],
      ["obstacle_awareness", readiness.blockers.length > 0, readiness.blockers.length > 0 ? 1 : 0, "명시된 장애물의 존재 여부입니다."],
    ];
    if (readiness.evidenceReady !== null) {
      values.push(["evidence_readiness", readiness.evidenceReady, readiness.evidenceReady ? 1 : 0, "자료 준비 여부의 직접 진술입니다."]);
    }
    for (const [name, raw, score, reason] of values) {
      setFeature(featureMap, computed(definition(name), raw, score, [readinessInput.revision], reason));
    }
  }

  const reservationInput = recordValue(input.records, "confirmed_reservations");
  if (reservationInput?.value.kind === "CONFIRMED_RESERVATIONS") {
    const reservation = reservationInput.value;
    setFeature(featureMap, computed(definition("confirmed_reservation_count_4w"), reservation.count, null, [reservationInput.revision], "4주 horizon의 확정 건수 원천값입니다."));
    if (reservation.totalOrderValue) {
      setFeature(featureMap, computed(definition("confirmed_order_value"), reservation.totalOrderValue, null, [reservationInput.revision], "차주가 명시한 확정 주문 총액입니다."));
    } else if (reservation.count.kind === "EXACT" && reservation.count.value === 0) {
      setFeature(featureMap, computed(definition("confirmed_order_value"), { kind: "EXACT", value: 0 }, null, [reservationInput.revision], "확정 건수 0건에 대응하는 확정 주문금액 0원입니다.", "confirmed_count == 0 => confirmed_order_value = 0"));
      setFeature(featureMap, computed(definition("booking_coverage_weeks"), { kind: "EXACT", value: 0 }, null, [reservationInput.revision], "확정 건수 0건에 대응하는 예약 커버리지 0주입니다.", "confirmed_count == 0 => booking_coverage_weeks = 0"));
    }
  }

  const seasonInput = recordValue(input.records, "seasonality_outlook");
  if (seasonInput?.value.kind === "SEASONALITY_OUTLOOK") {
    const nonExpectationBasis = seasonInput.value.bases.filter((basis) => basis.kind !== "BORROWER_EXPECTATION");
    if (seasonInput.value.expectedChangePct && nonExpectationBasis.some((basis) => basis.kind === "HISTORICAL")) {
      setFeature(featureMap, computed(definition("season_adjusted_growth"), seasonInput.value.expectedChangePct, null, [seasonInput.revision], "과거 계절성 근거와 함께 차주가 말한 변화율이며 모델 점수로 사용하지 않습니다."));
    }
    if (nonExpectationBasis.length > 0 || reservationInput) {
      const revisions = [seasonInput.revision, ...(reservationInput ? [reservationInput.revision] : [])];
      setFeature(featureMap, computed(definition("demand_visibility"), {
        confirmedReservations: reservationInput?.value.kind === "CONFIRMED_RESERVATIONS" ? reservationInput.value.count : null,
        bases: nonExpectationBasis.map(({ kind, detail }) => ({ kind, detail })),
      }, null, revisions, "예약·계약·과거·지역행사 근거를 구조화했으며 낙관 발언 자체는 점수화하지 않습니다."));
    }
  }

  const householdExpense = recordValue(input.records, "essential_household_expenses");
  if (householdExpense?.value.kind === "PERIODIC_MONEY") {
    setFeature(featureMap, computed(definition("essential_living_expense"), householdExpense.value.amount, null, [householdExpense.revision], "월 필수 가계지출 원천값이며 가족구성을 사용하지 않습니다."));
  }
  const buffer = recordValue(input.records, "emergency_buffer_months");
  if (buffer?.value.kind === "DURATION") {
    setFeature(featureMap, computed(definition("buffer_months"), buffer.value.duration, null, [buffer.revision], "필수 생활비를 감당할 수 있는 기간 원천값입니다."));
  }

  const mirrorComputedFeature = (targetName: string, sourceName: string): void => {
    const source = featureMap.get(sourceName);
    if (!source || source.state !== "COMPUTED") return;
    const target = definition(targetName);
    setFeature(featureMap, {
      ...source,
      name: target.name,
      domain: target.domain,
      formula: `named feature alias of ${sourceName}`,
      reason: `${source.reason} 제품 표준 이름(${targetName})으로 동일 근거를 투영했습니다.`,
    });
  };
  mirrorComputedFeature("past_execution_example_count", "past_execution_examples");
  mirrorComputedFeature("booking_count", "confirmed_reservation_count_4w");
  mirrorComputedFeature("essential_household_expense", "essential_living_expense");
  mirrorComputedFeature("household_buffer_months", "buffer_months");

  return {
    snapshotType: input.snapshotType ?? "PREVIEW",
    stateVersion: input.stateVersion,
    registryVersion: DEV_V1_FEATURE_REGISTRY_VERSION,
    features: DEV_V1_FEATURE_REGISTRY.map((entry) => featureMap.get(entry.name) ?? missingFeature(entry)),
  };
}

export function featurePreviewDelta(
  before: LiveFeatureSet,
  after: LiveFeatureSet,
): LiveFeatureValue[] {
  return after.features.filter((feature) => {
    const previous = before.features.find((candidate) => candidate.name === feature.name);
    return !previous || JSON.stringify(previous) !== JSON.stringify(feature);
  });
}
