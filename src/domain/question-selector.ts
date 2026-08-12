import type { InformationItem, NextQuestion } from "./interview";

const PRIORITY_WEIGHT = { P0: 0, P1: 1, P2: 2 } as const;
const STATUS_WEIGHT = { CONFLICT: 0, NEEDS_FOLLOWUP: 1, NEEDED: 2 } as const;

export interface QuestionSelectionContext {
  lastCategory?: InformationItem["category"] | null;
  askedCounts?: Readonly<Record<string, number>>;
  preferredInfoCodes?: readonly string[];
}

function dependenciesReady(item: InformationItem, allItems: InformationItem[]): boolean {
  return item.dependencies.every((dependency) => {
    const dependencyItem = allItems.find((candidate) => candidate.infoCode === dependency);
    return dependencyItem?.status === "CONFIRMED" || dependencyItem?.status === "NOT_APPLICABLE";
  });
}

export function selectNextQuestion(
  items: InformationItem[],
  currentInfoCode: string | null = null,
  context: QuestionSelectionContext = {},
): NextQuestion | null {
  const current = currentInfoCode
    ? items.find((item) => item.infoCode === currentInfoCode)
    : undefined;

  if (current?.status === "ASKING") {
    return { infoCode: current.infoCode, text: current.question, reason: "PRIORITY" };
  }
  if (current?.status === "NEEDS_FOLLOWUP") {
    return {
      infoCode: current.infoCode,
      text: current.followupQuestion ?? `앞서 말씀하신 ${current.label}을(를) 조금 더 구체적으로 알려주세요.`,
      reason: "FOLLOWUP",
    };
  }
  if (current?.status === "CONFLICT") {
    return {
      infoCode: current.infoCode,
      text: `기존 자료와 차이가 있습니다. ${current.label}의 기준 기간과 포함된 매출 채널을 확인해 주세요.`,
      reason: "CONFLICT",
    };
  }

  const candidates = items
    .filter((item) => ["NEEDED", "NEEDS_FOLLOWUP", "CONFLICT"].includes(item.status))
    .filter((item) => dependenciesReady(item, items))
    .sort((left, right) => {
      const priorityDifference = PRIORITY_WEIGHT[left.priority] - PRIORITY_WEIGHT[right.priority];
      if (priorityDifference !== 0) return priorityDifference;
      const leftStatus = STATUS_WEIGHT[left.status as keyof typeof STATUS_WEIGHT] ?? 2;
      const rightStatus = STATUS_WEIGHT[right.status as keyof typeof STATUS_WEIGHT] ?? 2;
      const statusDifference = leftStatus - rightStatus;
      if (statusDifference !== 0) return statusDifference;

      const leftPreferred = context.preferredInfoCodes?.indexOf(left.infoCode) ?? -1;
      const rightPreferred = context.preferredInfoCodes?.indexOf(right.infoCode) ?? -1;
      const leftPreferenceRank = leftPreferred < 0 ? Number.MAX_SAFE_INTEGER : leftPreferred;
      const rightPreferenceRank = rightPreferred < 0 ? Number.MAX_SAFE_INTEGER : rightPreferred;
      if (leftPreferenceRank !== rightPreferenceRank) {
        return leftPreferenceRank - rightPreferenceRank;
      }

      const leftBurden = context.askedCounts?.[left.infoCode] ?? 0;
      const rightBurden = context.askedCounts?.[right.infoCode] ?? 0;
      if (leftBurden !== rightBurden) return leftBurden - rightBurden;

      const leftContinuity = context.lastCategory === left.category ? 0 : 1;
      const rightContinuity = context.lastCategory === right.category ? 0 : 1;
      if (leftContinuity !== rightContinuity) return leftContinuity - rightContinuity;

      return left.infoCode.localeCompare(right.infoCode);
    });

  const selected = candidates[0];
  if (!selected) return null;
  return {
    infoCode: selected.infoCode,
    text:
      selected.status === "NEEDS_FOLLOWUP"
        ? selected.followupQuestion ?? selected.question
        : selected.status === "CONFLICT"
          ? `기존 자료와 차이가 있습니다. ${selected.label}의 산정 기준을 확인해 주세요.`
          : selected.question,
    reason:
      selected.status === "NEEDS_FOLLOWUP"
        ? "FOLLOWUP"
        : selected.status === "CONFLICT"
          ? "CONFLICT"
          : "PRIORITY",
  };
}
