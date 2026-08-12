import {
  INFORMATION_CATEGORIES,
  type CategoryCoverage,
  type Coverage,
  type InformationCategory,
  type InformationItem,
  type SnapshotType,
} from "./interview";
import { isResolvedInformationStatus } from "./state-machine";

function ratio(numerator: number, denominator: number): number {
  if (denominator === 0) return 1;
  return Number((numerator / denominator).toFixed(4));
}

const QUALITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3 } as const;

function isEvaluable(item: InformationItem): boolean {
  return (
    (item.status === "CONFIRMED" &&
      item.valueState === "PRESENT" &&
      item.value !== null &&
      item.quality !== null &&
      QUALITY_RANK[item.quality] >= QUALITY_RANK[item.minQuality] &&
      item.evidenceIds.length > 0) ||
    (item.status === "NOT_APPLICABLE" && item.valueState === "NOT_APPLICABLE")
  );
}

function categoryCoverage(items: InformationItem[]): CategoryCoverage {
  const total = items.length;
  const resolved = items.filter((item) => isResolvedInformationStatus(item.status)).length;
  const evaluable = items.filter(isEvaluable).length;
  return {
    total,
    resolved,
    evaluable,
    confirmationRate: ratio(resolved, total),
    evaluableRate: ratio(evaluable, total),
  };
}

export function calculateCoverage(
  informationItems: InformationItem[],
  snapshotType: SnapshotType = "PREVIEW",
): Coverage {
  const requiredItems = informationItems.filter((item) => item.required);
  const resolvedRequired = requiredItems.filter((item) =>
    isResolvedInformationStatus(item.status),
  ).length;
  const evaluableRequired = requiredItems.filter(isEvaluable).length;
  const statusConfirmationRate = ratio(resolvedRequired, requiredItems.length);
  const evaluableValueRate = ratio(evaluableRequired, requiredItems.length);

  const byCategory = Object.fromEntries(
    INFORMATION_CATEGORIES.map((category) => [
      category,
      categoryCoverage(requiredItems.filter((item) => item.category === category)),
    ]),
  ) as Record<InformationCategory, CategoryCoverage>;

  return {
    snapshotType,
    totalRequired: requiredItems.length,
    resolvedRequired,
    evaluableRequired,
    statusConfirmationRate,
    evaluableValueRate,
    requiredInformationRate: evaluableValueRate,
    // terminal refusal/unknown 상태가 데이터 충분도 점수를 올리지 않도록 evaluable rate만 사용한다.
    overallRate: evaluableValueRate,
    unresolvedP0: requiredItems.filter(
      (item) => item.priority === "P0" && !isResolvedInformationStatus(item.status),
    ).length,
    byCategory,
  };
}
