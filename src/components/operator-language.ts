const QUESTION_REASONS: Record<string, string> = { INITIAL: "첫 질문", PRIORITY: "기본 정보 확인", FOLLOWUP: "추가 확인", CONFLICT: "상충 답변 확인" };
const GOAL_STATUSES: Record<string, string> = { UNRESOLVED: "아직 확인 전", CANDIDATE: "목표 후보", NEEDS_FOLLOWUP: "추가 확인", CONFIRMED: "확인 완료", NO_GOAL_STATED: "목표 없음", DEFERRED: "나중에 확인" };

export function questionReasonLabel(reason: string): string { return QUESTION_REASONS[reason] ?? "다음 정보 확인"; }
export function goalStatusLabel(status: string | null | undefined): string { return GOAL_STATUSES[status ?? "UNRESOLVED"] ?? "상태 확인 필요"; }

/** Translate known identifiers only; preserve amounts and unrecognized text verbatim. */
export function readableInformationText(text: string, items: readonly { infoCode: string; label: string }[]): string {
  const labels = new Map(items.map(item => [item.infoCode, item.label]));
  return text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, code => labels.get(code) ?? code);
}
