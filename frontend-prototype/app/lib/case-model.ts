export const INTERVIEW_QUESTIONS = [
  {
    id: "change",
    question: "최근 매출이 달라진 가장 큰 이유를 들려주세요.",
    audioSrc: "/audio/yujin-q1.wav",
    options: [
      "리뉴얼 후 다시 영업을 시작했어요.",
      "새로운 납품 계약이 생겼어요.",
    ],
  },
  {
    id: "continuity",
    question: "그 변화가 지금도 이어지고 있나요?",
    audioSrc: "/audio/yujin-q2.wav",
    options: [
      "최근 3개월 매출이 안정됐어요.",
      "단골 고객과 주문이 다시 늘었어요.",
    ],
  },
  {
    id: "documents",
    question: "다음 금융 검토를 위해 먼저 준비할 수 있는 자료는 무엇인가요?",
    audioSrc: "/audio/yujin-q3.wav",
    options: [
      "최근 매출 정산 자료를 준비할 수 있어요.",
      "상환 계획을 다시 확인할 수 있어요.",
    ],
  },
] as const;
export const QUEST_LABELS = [
  "사업 변화의 이유",
  "조정해 볼 지출",
  "준비 가능한 자료",
];
export interface AcceptedAnswer {
  questionId: string;
  questionText: string;
  answerText: string;
  acceptedAt: string;
  revision: number;
}
export interface CaseReview {
  proposalId: string;
  owner: string;
  dueDate: string;
  documents: string[];
  institution: string;
  reviewed: boolean;
}
export interface CompanionCase {
  id: string;
  createdAt: string;
  updatedAt: string;
  businessName: string;
  borrowerName: string;
  quests: Array<string | null>;
  answers: AcceptedAnswer[];
  completedAt: string | null;
  review: CaseReview;
}
export interface CaseCollection {
  version: 1;
  currentId: string | null;
  cases: CompanionCase[];
}
export const EMPTY_COLLECTION: CaseCollection = {
  version: 1,
  currentId: null,
  cases: [],
};
export const EMPTY_REVIEW: CaseReview = {
  proposalId: "",
  owner: "사장님과 담당자",
  dueDate: "",
  documents: [],
  institution: "",
  reviewed: false,
};
export const CHECK_DOCUMENTS = [
  "사업자등록 정보",
  "매출·비용의 기준 기간과 증빙",
  "채무·상환 내역",
  "자금 목적과 필요한 금액",
];

export function readCollection(raw: string | null): CaseCollection {
  try {
    const x: unknown = raw ? JSON.parse(raw) : null;
    if (!x || typeof x !== "object") return EMPTY_COLLECTION;
    const c = x as CaseCollection;
    if (c.version !== 1 || !Array.isArray(c.cases) || c.cases.length > 50)
      return EMPTY_COLLECTION;
    const validText = (value: unknown, max = 3000): value is string =>
      typeof value === "string" && value.length <= max;
    const valid = c.cases.every(
      (item) =>
        item &&
        validText(item.id, 80) &&
        validText(item.createdAt, 40) &&
        validText(item.updatedAt, 40) &&
        validText(item.businessName, 80) &&
        validText(item.borrowerName, 80) &&
        Array.isArray(item.quests) &&
        item.quests.length === 3 &&
        item.quests.every((q) => q === null || validText(q, 100)) &&
        Array.isArray(item.answers) &&
        item.answers.length <= 3 &&
        new Set(item.answers.map((a) => a.questionId)).size ===
          item.answers.length &&
        item.answers.every(
          (a) =>
            INTERVIEW_QUESTIONS.some(
              (q) => q.id === a.questionId && q.question === a.questionText,
            ) &&
            validText(a.answerText) &&
            !!a.answerText.trim() &&
            validText(a.acceptedAt, 40) &&
            Number.isSafeInteger(a.revision) &&
            a.revision > 0,
        ) &&
        (item.completedAt === null ||
          (validText(item.completedAt, 40) && item.answers.length === 3)) &&
        item.review &&
        validText(item.review.proposalId, 80) &&
        validText(item.review.owner, 80) &&
        validText(item.review.dueDate, 20) &&
        validText(item.review.institution, 40) &&
        typeof item.review.reviewed === "boolean" &&
        Array.isArray(item.review.documents) &&
        item.review.documents.every((d) => CHECK_DOCUMENTS.includes(d)),
    );
    return valid
      ? {
          version: 1,
          cases: c.cases,
          currentId: c.cases.some((i) => i.id === c.currentId)
            ? c.currentId
            : null,
        }
      : EMPTY_COLLECTION;
  } catch {
    return EMPTY_COLLECTION;
  }
}
export function acceptAnswer(
  item: CompanionCase,
  questionId: string,
  text: string,
  now: string,
): CompanionCase {
  if (item.completedAt)
    throw new Error("완료된 인터뷰의 원문은 변경할 수 없습니다.");
  const question = INTERVIEW_QUESTIONS.find((q) => q.id === questionId);
  if (!question || !text.trim() || text.trim().length > 3000)
    throw new Error("질문과 답변을 확인해 주세요.");
  const previous = item.answers.find((a) => a.questionId === questionId);
  const answer = {
    questionId,
    questionText: question.question,
    answerText: text.trim(),
    acceptedAt: now,
    revision: (previous?.revision ?? 0) + 1,
  };
  return {
    ...item,
    updatedAt: now,
    answers: INTERVIEW_QUESTIONS.flatMap((q) =>
      q.id === questionId
        ? [answer]
        : item.answers.filter((a) => a.questionId === q.id),
    ),
  };
}
export function completeCase(item: CompanionCase, now: string): CompanionCase {
  if (
    item.answers.length !== INTERVIEW_QUESTIONS.length ||
    !item.businessName.trim()
  )
    throw new Error("사업체 이름과 모든 답변을 확인해 주세요.");
  return item.completedAt
    ? item
    : { ...item, completedAt: now, updatedAt: now };
}
export function proposalsFor(item: CompanionCase) {
  const expense = item.quests[1];
  return [
    {
      id: "evidence",
      title: "변화 전후를 같은 기간으로 정리하기",
      reason:
        item.answers.find((a) => a.questionId === "change")?.answerText ??
        "사업 변화의 구체적인 내용을 추가로 확인합니다.",
      source: "인터뷰 · 사업 변화",
      action:
        "변화 전후의 매출 자료를 같은 기간으로 준비하고, 계절·휴업 등 비교 조건을 함께 기록합니다.",
    },
    {
      id: "expense",
      title: expense
        ? `${expense} 내역부터 살펴보기`
        : "고정비·변동비 나누어 기록하기",
      reason: expense
        ? `골목에서 ‘${expense}’을 먼저 조정해 보고 싶다고 선택했습니다.`
        : "조정할 수 있는 지출과 유지에 필요한 지출을 구분할 자료가 필요합니다.",
      source: expense ? "골목 선택 · 조정할 지출" : "추가 확인 제안",
      action:
        "2주 동안 지출 내역을 나누어 기록하고, 실제 줄일 수 있는 항목과 실행의 영향을 담당자와 검토합니다.",
    },
    {
      id: "documents",
      title: "상담자료 목록과 준비 일정 정하기",
      reason:
        item.answers.find((a) => a.questionId === "documents")?.answerText ??
        "준비 가능한 증빙을 추가로 확인합니다.",
      source: "인터뷰 · 준비 가능한 자료",
      action:
        "준비할 자료의 기간·발급처·담당자를 정리하고, 자금 목적과 필요한 금액을 다음 상담에서 확인합니다.",
    },
  ];
}
