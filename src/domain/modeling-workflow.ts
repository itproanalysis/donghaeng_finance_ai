import type { ModelingCase, ModelingValue } from "@/server/modeling-demo";

const states: Record<string, string> = { MISSING: "미확인", UNDECIDED: "미결정", REFUSED: "답변 거절", NOT_APPLICABLE: "해당 없음" };

export function displayModelValue(value: ModelingValue | undefined, code = ""): string {
  if (value === undefined || value === null) return "미확인";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "string") return states[value] ?? value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "미확인";
    const percentage = /ratio|growth|change|share|cv|recovery|drawdown/.test(code);
    const unit = percentage ? "%" : /day_count|horizon_days/.test(code) ? "일" : /transaction_count/.test(code) ? "건" : /sales_avg|outflow|balance|ticket|budget|cashflow_avg/.test(code) ? "원" : "";
    return `${(percentage ? value * 100 : value).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}${unit}`;
  }
  if (Array.isArray(value)) return value.map((part) => displayModelValue(part)).join(", ");
  return JSON.stringify(value);
}

export function getCaseGoal(item: ModelingCase) {
  const features = new Map(item.features.map((feature) => [feature.code, feature]));
  const code = features.get("own_goal_evidence_feature")?.value;
  const feature = typeof code === "string" ? features.get(code) : undefined;
  const target = features.get("own_goal_target_value");
  const horizon = features.get("own_goal_horizon_days");
  const ready = !!feature && feature.status === "VALUE" && typeof feature.value === "number"
    && target?.status === "VALUE" && typeof target.value === "number"
    && horizon?.status === "VALUE" && typeof horizon.value === "number" && horizon.value > 0;
  return {
    feature, target, horizon, ready,
    direction: ready && typeof target?.value === "number" && typeof feature?.value === "number"
      ? target.value >= feature.value ? "INCREASE" : "DECREASE" : null,
    action: features.get("own_plan_action_category"),
    budget: features.get("own_plan_budget"),
    blocker: features.get("own_plan_top_blocker"),
    problem: features.get("own_primary_problem"),
    scoreItem: item.scorecard.improvement.items.find((metric) => metric.name === "계획의 현실성"),
  };
}

export function getScoreChanges(before: ModelingCase, after: ModelingCase) {
  return (["currentSituation", "improvement"] as const).flatMap((axis) => before.scorecard[axis].items.flatMap((item) => {
    const next = after.scorecard[axis].items.find((row) => row.name === item.name);
    if (!next || (item.points === next.points && item.excluded === next.excluded && item.band === next.band)) return [];
    return [{ axis, name: item.name, before: item, after: next }];
  }));
}

export interface ModelingReviewDraft {
  version: 1;
  goalConfirmed: boolean;
  recordsReviewed: boolean;
  disposition: "PENDING" | "NEEDS_INFORMATION" | "READY_FOR_REVIEW" | "HOLD";
  note: string;
  updatedAt: string | null;
}

export const EMPTY_REVIEW: ModelingReviewDraft = {
  version: 1, goalConfirmed: false, recordsReviewed: false, disposition: "PENDING", note: "", updatedAt: null,
};

export function readReviewDraft(raw: string | null): ModelingReviewDraft {
  if (!raw) return EMPTY_REVIEW;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1 || typeof parsed.note !== "string"
      || typeof parsed.goalConfirmed !== "boolean" || typeof parsed.recordsReviewed !== "boolean"
      || !["PENDING", "NEEDS_INFORMATION", "READY_FOR_REVIEW", "HOLD"].includes(parsed.disposition)
      || typeof parsed.updatedAt !== "string" || !Number.isFinite(Date.parse(parsed.updatedAt))) return EMPTY_REVIEW;
    return { version: 1, goalConfirmed: parsed.goalConfirmed, recordsReviewed: parsed.recordsReviewed,
      disposition: parsed.disposition, note: parsed.note.slice(0, 2000), updatedAt: parsed.updatedAt };
  } catch { return EMPTY_REVIEW; }
}
