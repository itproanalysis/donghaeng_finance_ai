import {
  INFORMATION_CATEGORIES,
  type FinalInterviewSnapshot,
  type InterviewEvaluation,
  type EvaluationPillar,
  type InformationCategory,
} from "./interview";

const CATEGORY_LABELS: Record<InformationCategory, string> = {
  CURRENT_STATE: "현재 사업상태",
  IMPROVEMENT_INTENT: "개선 의지와 실행 준비",
  FUTURE_OUTLOOK: "향후 사업 전망",
  HOUSEHOLD_STATE: "가계 현금흐름",
};

function sufficiencyLevel(score: number): "SUFFICIENT" | "PARTIAL" | "INSUFFICIENT" {
  if (score >= 80) return "SUFFICIENT";
  if (score >= 40) return "PARTIAL";
  return "INSUFFICIENT";
}

export function buildDeterministicEvaluation(
  snapshot: FinalInterviewSnapshot,
  evaluationId: string,
): InterviewEvaluation {
  const pillars: EvaluationPillar[] = INFORMATION_CATEGORIES.map((category) => {
    const coverage = snapshot.coverage.byCategory[category];
    const score = Math.round(coverage.evaluableRate * 100);
    return {
      category,
      label: CATEGORY_LABELS[category],
      dataSufficiencyScore: score,
      level: sufficiencyLevel(score),
      coverage,
      summary: `${CATEGORY_LABELS[category]} 필수정보 ${coverage.evaluable}/${coverage.total}건이 평가 가능한 상태입니다.`,
    };
  });

  const overallScore = Math.round(snapshot.coverage.overallRate * 100);
  const unresolvedItems = snapshot.informationItems
    .filter(
      (item) =>
        item.required &&
        !(
          (item.status === "CONFIRMED" &&
            item.valueState === "PRESENT" &&
            item.value !== null &&
            item.quality !== null &&
            item.evidenceIds.length > 0) ||
          (item.status === "NOT_APPLICABLE" && item.valueState === "NOT_APPLICABLE")
        ),
    )
    .map(({ infoCode, label, priority, status }) => ({ infoCode, label, priority, status }));

  return {
    id: evaluationId,
    interviewId: snapshot.interviewId,
    finalSnapshotId: snapshot.id,
    snapshotVersion: snapshot.version,
    status: "READY",
    decisionScope: "DATA_SUFFICIENCY_ONLY",
    approvalDecision: null,
    disclaimer:
      "이 결과는 인터뷰 데이터의 충분도와 확인 상태를 요약한 보조 평가이며, 대출 승인·거절 또는 신용등급 판단이 아닙니다.",
    overall: {
      dataSufficiencyScore: overallScore,
      level: sufficiencyLevel(overallScore),
      completionStatus: snapshot.completionStatus,
    },
    pillars,
    unresolvedItems,
    createdAt: snapshot.finalizedAt,
  };
}
