import type { RequiredInformationItem } from "@/domain/interview";
import { createDevV1AcceptanceRequiredInformationItems, createDevV1RequiredInformationItems, createDevV1ScenarioRequiredInformationItems } from "@/domain/information-catalog";
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";

/** The web entry and end-to-end verification use the same question selection. */
export function createBorrowerRequiredInformationList(industryCode: string, focus: BorrowerConversationFocus = "FULL_REVIEW", scenarioId: string | null = null): RequiredInformationItem[] {
  const items = scenarioId === OPERATING_DAY_DEMO_SCENARIO.id && industryCode === OPERATING_DAY_DEMO_SCENARIO.persona.industryCode
    ? createDevV1ScenarioRequiredInformationItems(OPERATING_DAY_DEMO_SCENARIO.triggeredInfoCodes)
    : industryCode === "CAFE" ? createDevV1AcceptanceRequiredInformationItems() : createDevV1RequiredInformationItems();
  // Preserve the triggered question's P0. Optional background signals already have P2.
  return applyBorrowerConversationFocus(items, focus);
}

export type BorrowerConversationFocus =
  | "FULL_REVIEW"
  | "COSTS"
  | "IMPROVEMENT"
  | "FUTURE";

export interface BorrowerConversationFocusOption {
  id: BorrowerConversationFocus;
  label: string;
  description: string;
  initialInfoCode: string;
  recommended?: true;
}

/**
 * Lets the borrower choose where the conversation begins without changing the
 * server-owned completion catalog. Every path still converges on the same
 * required information; only the first safe, dependency-free question changes.
 */
export const BORROWER_CONVERSATION_FOCUS_OPTIONS: readonly BorrowerConversationFocusOption[] = [
  {
    id: "FULL_REVIEW",
    label: "전체 흐름을 차근차근",
    description: "최근 매출부터 시작해 사업 전반을 하나씩 살펴봐요.",
    initialInfoCode: "monthly_average_sales",
    recommended: true,
  },
  {
    id: "COSTS",
    label: "비용 부담부터",
    description: "매달 반복되는 운영비 이야기부터 시작해요.",
    initialInfoCode: "fixed_operating_costs",
  },
  {
    id: "IMPROVEMENT",
    label: "개선하고 싶은 점부터",
    description: "지금 가장 바꾸고 싶은 문제와 계획부터 이야기해요.",
    initialInfoCode: "improvement_plan",
  },
  {
    id: "FUTURE",
    label: "앞으로의 계획부터",
    description: "확정된 예약·주문과 앞으로의 흐름부터 살펴봐요.",
    initialInfoCode: "confirmed_reservations",
  },
] as const;

export function initialInfoCodeForBorrowerFocus(
  focus: BorrowerConversationFocus,
): string {
  return BORROWER_CONVERSATION_FOCUS_OPTIONS.find((option) => option.id === focus)
    ?.initialInfoCode ?? "monthly_average_sales";
}

export function applyBorrowerConversationFocus(
  items: readonly RequiredInformationItem[],
  focus: BorrowerConversationFocus,
): RequiredInformationItem[] {
  const preferred = initialInfoCodeForBorrowerFocus(focus);
  const initialInfoCode = items.some((item) => item.infoCode === preferred)
    ? preferred
    : items.find((item) => item.infoCode === "monthly_average_sales")?.infoCode ??
      items.find((item) => item.required)?.infoCode ??
      items[0]?.infoCode ??
      null;

  return items.map((item) => ({
    ...item,
    evidencePreference: [...item.evidencePreference],
    dependencies: [...item.dependencies],
    status: item.infoCode === initialInfoCode ? "ASKING" : "NEEDED",
  }));
}
