import type {
  GoalView,
  InformationItemView,
  TranscriptView,
} from "@/components/api-adapter";
import {
  DEV_V1_ALL_INFORMATION_CATALOG,
  type DevV1AllInfoCode,
} from "@/domain/information-catalog";
import {
  buildAllowlistedImprovementCandidates,
  type ImprovementCandidateOrigin,
} from "@/domain/improvement-candidate-selection";

export interface GroundedScenarioPrompt {
  id: string;
  label: "생각을 돕는 가정 질문";
  question: string;
  sourceInfoCodes: string[];
  evidenceIds: string[];
  notice: string;
}

export interface EvidenceCuriosityCard {
  id: string;
  label: "AI가 한 가지 더 궁금해요";
  context: string;
  question: string;
  sourceInfoCodes: string[];
  evidenceIds: string[];
  optional: true;
}

export interface ImprovementCandidate {
  id: string;
  title: string;
  description: string;
  sourceLabel: string;
  sourceInfoCodes: string[];
  evidenceIds: string[];
  origin: ImprovementCandidateOrigin;
  confirmed: false;
}

export interface ReconstructedQuestionAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

function borrowerFacingQuestion(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const catalogQuestions = DEV_V1_ALL_INFORMATION_CATALOG
    .flatMap((item) => [item.question, item.followupQuestion])
    .filter((question): question is string => Boolean(question?.trim()))
    .map((question) => question.replace(/\s+/g, " ").trim())
    .sort((left, right) => right.length - left.length);
  return catalogQuestions.find((question) => normalized.endsWith(question)) ?? normalized;
}

const SAFE_SCENARIO_BASIS = [
  "monthly_average_sales",
  "fixed_operating_costs",
  "platform_fee_pressure",
  "hall_customer_decline",
  "repeat_customer_share",
] as const;

const OPTIONAL_EVIDENCE_TRIGGERS: Partial<Record<DevV1AllInfoCode, readonly string[]>> = {
  platform_fee_pressure: ["monthly_average_sales", "fixed_operating_costs"],
  hall_customer_decline: ["monthly_average_sales"],
  repeat_customer_share: ["monthly_average_sales", "hall_customer_decline"],
};

const CANDIDATE_BY_INFO_CODE: Partial<Record<DevV1AllInfoCode, {
  title: string;
  description: (item: InformationItemView) => string;
}>> = {
  monthly_average_sales: {
    title: "월 매출 흐름 기록하기",
    description: (item) => `${item.label} ${item.displayValue}을 기준점으로 두고 실제 변화만 기록해 봅니다.`,
  },
  fixed_operating_costs: {
    title: "고정 운영비 항목 점검하기",
    description: (item) => `${item.label} ${item.displayValue}에서 어떤 항목이 달라지는지 확인해 봅니다.`,
  },
  confirmed_reservations: {
    title: "예약·주문 일정 확인하기",
    description: (item) => `${item.label} ${item.displayValue}의 실제 진행 여부를 일정에 맞춰 확인해 봅니다.`,
  },
  seasonality_outlook: {
    title: "계절 수요 변화 기록하기",
    description: (item) => `${item.label} ${item.displayValue}과 실제 흐름을 비교해 봅니다.`,
  },
  platform_fee_pressure: {
    title: "플랫폼 비용 변화 기록하기",
    description: (item) => `${item.label} ${item.displayValue}의 변화를 확인해 봅니다.`,
  },
  hall_customer_decline: {
    title: "홀 고객 변화 기록하기",
    description: (item) => `${item.label} ${item.displayValue}의 변화를 확인해 봅니다.`,
  },
  repeat_customer_share: {
    title: "단골 매출 변화 기록하기",
    description: (item) => `${item.label} ${item.displayValue}의 변화를 확인해 봅니다.`,
  },
};

const CATALOG_FALLBACK_CANDIDATES: readonly ImprovementCandidate[] = [
  {
    id: "catalog-improvement-action",
    title: "한 가지 개선 행동 정하기",
    description: "사업 개선 계획 질문에서 이야기한 내용을 바탕으로, 가장 작은 행동 하나를 골라 봅니다.",
    sourceLabel: "인터뷰 질문 카탈로그",
    sourceInfoCodes: ["improvement_plan"],
    evidenceIds: [],
    origin: "CATALOG_SUGGESTION",
    confirmed: false,
  },
  {
    id: "catalog-execution-order",
    title: "실행 준비 순서 정하기",
    description: "인력·예산·일정 중 먼저 확인할 준비 한 가지를 골라 봅니다.",
    sourceLabel: "인터뷰 질문 카탈로그",
    sourceInfoCodes: ["execution_readiness"],
    evidenceIds: [],
    origin: "CATALOG_SUGGESTION",
    confirmed: false,
  },
  {
    id: "catalog-sales-log",
    title: "월 매출 흐름 기록하기",
    description: "이용 중인 판매 채널을 합친 월 매출 흐름을 같은 기준으로 기록해 봅니다.",
    sourceLabel: "인터뷰 질문 카탈로그",
    sourceInfoCodes: ["monthly_average_sales"],
    evidenceIds: [],
    origin: "CATALOG_SUGGESTION",
    confirmed: false,
  },
] as const;

function confirmedValue(item: InformationItemView | undefined): item is InformationItemView & {
  displayValue: string;
} {
  return item?.status === "CONFIRMED" && Boolean(item.displayValue?.trim());
}

function newestConfirmed(
  items: readonly InformationItemView[],
  allowedInfoCodes: readonly string[],
): (InformationItemView & { displayValue: string }) | null {
  const allowed = new Set(allowedInfoCodes);
  return items
    .filter((item): item is InformationItemView & { displayValue: string } =>
      allowed.has(item.infoCode) && confirmedValue(item),
    )
    .sort((left, right) => {
      const leftTime = left.updatedAt ? Date.parse(left.updatedAt) : Number.NEGATIVE_INFINITY;
      const rightTime = right.updatedAt ? Date.parse(right.updatedAt) : Number.NEGATIVE_INFINITY;
      return rightTime - leftTime;
    })[0] ?? null;
}

/**
 * Offers a bounded thought experiment only when the current catalog question
 * can safely receive the answer. It never predicts sales, savings, approval,
 * or credit outcomes and never turns a suggested scenario into a fact.
 */
export function buildGroundedScenarioPrompt(input: {
  informationItems: readonly InformationItemView[];
  currentQuestionInfoCode: string | null;
  questionReason: string | null;
}): GroundedScenarioPrompt | null {
  if (input.questionReason === "CONFLICT" || input.questionReason === "FOLLOWUP") return null;

  if (input.currentQuestionInfoCode === "improvement_plan") {
    const basis = newestConfirmed(input.informationItems, SAFE_SCENARIO_BASIS);
    if (!basis) return null;
    return {
      id: `scenario-improvement-${basis.infoCode}`,
      label: "생각을 돕는 가정 질문",
      question: `앞서 ${basis.label}을 ${basis.displayValue}로 확인했어요. 만약 지금 한 가지만 먼저 바꿔본다면, 어떤 행동부터 시도하고 싶으세요?`,
      sourceInfoCodes: [basis.infoCode],
      evidenceIds: [...basis.evidenceIds],
      notice: "가능성을 함께 생각해 보는 질문이며, 예상 성과나 금융 판단을 뜻하지 않아요.",
    };
  }

  if (input.currentQuestionInfoCode === "execution_readiness") {
    const plan = newestConfirmed(input.informationItems, ["improvement_plan"]);
    if (!plan) return null;
    return {
      id: "scenario-execution-improvement-plan",
      label: "생각을 돕는 가정 질문",
      question: `말씀하신 “${plan.displayValue}”을 실제로 시작한다고 가정하면, 인력·예산·일정 중 무엇부터 준비해야 할까요?`,
      sourceInfoCodes: [plan.infoCode],
      evidenceIds: [...plan.evidenceIds],
      notice: "실행 순서를 생각해 보는 질문이며, 계획이 확정되었다는 뜻은 아니에요.",
    };
  }

  return null;
}

/**
 * Promotes a catalog-authored optional question only when a related confirmed
 * answer has persisted evidence. No causal claim is made between the two.
 */
export function buildEvidenceCuriosityCard(input: {
  informationItems: readonly InformationItemView[];
  currentQuestionInfoCode: string | null;
  displayedQuestion: string | null;
}): EvidenceCuriosityCard | null {
  const infoCode = input.currentQuestionInfoCode as DevV1AllInfoCode | null;
  if (!infoCode) return null;
  const triggerCodes = OPTIONAL_EVIDENCE_TRIGGERS[infoCode];
  if (!triggerCodes) return null;
  const currentDefinition = DEV_V1_ALL_INFORMATION_CATALOG.find(
    (definition) => definition.infoCode === infoCode,
  );
  if (!currentDefinition || currentDefinition.required) return null;

  const source = newestConfirmed(input.informationItems, triggerCodes);
  if (!source || source.evidenceIds.length === 0) return null;

  return {
    id: `curiosity-${infoCode}-${source.infoCode}`,
    label: "AI가 한 가지 더 궁금해요",
    context: `앞서 ${source.label}을 ${source.displayValue}로 확인했어요. 사업 모습을 더 입체적으로 정리하기 위한 선택 질문이에요.`,
    question: input.displayedQuestion?.trim() || currentDefinition.question,
    sourceInfoCodes: [source.infoCode],
    evidenceIds: [...source.evidenceIds],
    optional: true,
  };
}

/**
 * Builds three non-binding next-step cards. Confirmed values may be quoted as
 * provenance, but every card remains an unconfirmed suggestion until the
 * borrower explicitly chooses it. The selectable identity/provenance fields
 * come from the same domain function that the completion endpoint validates;
 * the text below is presentation only.
 */
export function buildImprovementCandidates(input: {
  informationItems: readonly InformationItemView[];
  goal: GoalView | null;
}): ImprovementCandidate[] {
  const plan = newestConfirmed(input.informationItems, ["improvement_plan"]);
  const fallbackById = new Map(CATALOG_FALLBACK_CANDIDATES.map((item) => [item.id, item]));
  const allowlisted = buildAllowlistedImprovementCandidates({
    informationItems: input.informationItems.map((item) => ({
      infoCode: item.infoCode,
      status: item.status,
      updatedAt: item.updatedAt,
      evidenceIds: item.evidenceIds,
      displayValue: item.displayValue,
    })),
    goal: input.goal
      ? {
          status: input.goal.status,
          title: input.goal.title,
          evidenceIds: input.goal.evidenceIds,
        }
      : null,
  });

  return allowlisted.map((candidate): ImprovementCandidate => {
    if (candidate.id === "confirmed-goal-candidate") {
      return {
        ...candidate,
        description: "인터뷰에서 확인한 목표를 다음 실행 후보로 다시 살펴봅니다.",
        sourceLabel: "사장님이 확인한 목표",
        confirmed: false,
      };
    }
    if (candidate.id === "confirmed-improvement-plan-candidate") {
      return {
        ...candidate,
        description: plan
          ? "사장님이 말씀한 개선 계획을 다음 실행 후보로 다시 살펴봅니다."
          : "인터뷰에서 확인한 개선 계획을 다음 실행 후보로 살펴봅니다.",
        sourceLabel: "사장님이 확인한 답변",
        confirmed: false,
      };
    }

    const infoCode = candidate.sourceInfoCodes[0] as DevV1AllInfoCode | undefined;
    const source = infoCode
      ? input.informationItems.find((item) => item.infoCode === infoCode)
      : undefined;
    const definition = infoCode ? CANDIDATE_BY_INFO_CODE[infoCode] : undefined;
    if (candidate.id.startsWith("confirmed-") && source && definition) {
      return {
        ...candidate,
        description: definition.description(source),
        sourceLabel: "사장님이 확인한 답변",
        confirmed: false,
      };
    }

    const fallback = fallbackById.get(candidate.id);
    return {
      ...candidate,
      description: fallback?.description ?? "다음에 살펴볼 수 있는 참고용 개선 후보입니다.",
      sourceLabel: fallback?.sourceLabel ?? "인터뷰 질문 카탈로그",
      confirmed: false,
    };
  });
}

/** Reconstructs portable Q&A review rows from the authoritative transcript. */
export function reconstructQuestionAnswerHistory(
  transcript: readonly TranscriptView[],
): ReconstructedQuestionAnswer[] {
  const result: ReconstructedQuestionAnswer[] = [];
  let pendingQuestion: TranscriptView | null = null;

  for (const segment of transcript) {
    if (segment.speaker === "ASSISTANT") {
      pendingQuestion = segment;
      continue;
    }
    if (!pendingQuestion) continue;
    const effectiveQuestion = pendingQuestion.correctedText?.trim() || pendingQuestion.text;
    result.push({
      id: `server-${pendingQuestion.id}-${segment.id}`,
      // Claude may persist a short grounded reaction before the canonical
      // question. The borrower review must show the exact sentence that Qwen
      // spoke, while the reaction stays in its separate UI card.
      question: borrowerFacingQuestion(effectiveQuestion),
      answer: segment.correctedText?.trim() || segment.text,
      createdAt: segment.createdAt,
    });
    pendingQuestion = null;
  }

  return result;
}
