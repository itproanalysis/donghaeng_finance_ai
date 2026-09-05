/** Synthetic, browser-only review data. Never persisted as an interview or evaluation. */
export interface DemoQuestion {
  label: string;
  question: string;
  why: string;
  options: { text: string; value: number | string; short: string }[];
}

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  {
    label: "사업 현황",
    question: "사장님, 지금 어떤 가게를 운영하고 계신가요?",
    why: "업종과 운영 상황은 다음 질문의 출발점이에요.",
    options: [
      {
        text: "동행카페를 3년째 운영해요. 주택가에서 단골 손님을 주로 만나고 있어요.",
        value: "주택가 · 운영 3년",
        short: "주택가 카페 · 3년",
      },
      {
        text: "동행카페를 1년째 운영해요. 사무실 근처라 점심시간 손님이 많아요.",
        value: "오피스 상권 · 운영 1년",
        short: "오피스 카페 · 1년",
      },
    ],
  },
  {
    label: "매출",
    question: "요즘 한 달 매출은 어느 정도인가요?",
    why: "매출의 기준 기간을 맞춰 비용과 함께 살펴볼게요.",
    options: [
      {
        text: "최근 3개월은 한 달 평균 2,200만 원 정도예요.",
        value: 2200,
        short: "월평균 2,200만 원",
      },
      {
        text: "최근 3개월은 한 달 평균 1,800만 원 정도예요.",
        value: 1800,
        short: "월평균 1,800만 원",
      },
      {
        text: "최근 3개월은 한 달 평균 2,600만 원 정도예요.",
        value: 2600,
        short: "월평균 2,600만 원",
      },
    ],
  },
  {
    label: "비용",
    question: "재료비와 임대료·인건비는 한 달에 얼마나 드나요?",
    why: "나가는 돈을 나눠 보면 확인할 비용이 선명해져요.",
    options: [
      {
        text: "재료비가 700만 원, 임대료와 인건비 등 고정비는 850만 원이에요.",
        value: 700,
        short: "재료 700 · 고정비 850만 원",
      },
      {
        text: "재료비가 850만 원, 임대료와 인건비 등 고정비는 850만 원이에요.",
        value: 850,
        short: "재료 850 · 고정비 850만 원",
      },
    ],
  },
  {
    label: "상환",
    question: "사업과 관련해 매달 갚고 있는 금액도 있나요?",
    why: "매출과 비용에 상환 부담까지 더해 자금 흐름을 살펴봐요.",
    options: [
      {
        text: "기존 사업자 대출의 원금과 이자로 매달 180만 원을 내고 있어요.",
        value: 180,
        short: "월 상환 180만 원",
      },
      {
        text: "기존 사업자 대출의 원금과 이자로 매달 300만 원을 내고 있어요.",
        value: 300,
        short: "월 상환 300만 원",
      },
      {
        text: "현재 사업자 대출이나 매달 갚는 돈은 없어요.",
        value: 0,
        short: "현재 상환 없음",
      },
    ],
  },
  {
    label: "개선 계획",
    question: "가게에서 가장 먼저 바꿔보고 싶은 것은 무엇인가요?",
    why: "사장님이 원하는 변화에서 실행 후보를 준비해요.",
    options: [
      {
        text: "남는 재료가 아까워요. 매일 재고를 기록해서 버리는 양부터 줄이고 싶어요.",
        value: "inventory",
        short: "재고 기록과 재료 낭비 줄이기",
      },
      {
        text: "오후가 한산해요. 단골 손님에게 오후 방문 혜택을 시험해 보고 싶어요.",
        value: "customers",
        short: "오후 단골 방문 혜택 시험하기",
      },
    ],
  },
  {
    label: "필요한 지원",
    question: "앞으로 어떤 지원을 함께 알아보면 좋을까요?",
    why: "자금 목적을 먼저 정리한 뒤 담당자가 상담 경로를 검토해요.",
    options: [
      {
        text: "노후한 커피 장비를 바꾸고 싶어서 시설 자금 상담을 준비하고 싶어요.",
        value: "equipment",
        short: "장비 교체 · 시설 자금 상담",
      },
      {
        text: "비수기에 대비할 운영 자금 상담을 준비하고 싶어요.",
        value: "working",
        short: "비수기 대비 · 운영 자금 상담",
      },
    ],
  },
];

export const DEMO_SESSION_KEY = "donghaeng-review-tour-v1";
export interface DemoSession {
  answers: number[];
  completed: boolean;
}
export const EMPTY_DEMO: DemoSession = { answers: [], completed: false };
export const SAMPLE_DEMO: DemoSession = {
  answers: [0, 0, 0, 0, 0, 0],
  completed: true,
};

export function parseDemoSession(raw: string | null): DemoSession {
  if (!raw) return { ...EMPTY_DEMO, answers: [] };
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object")
      return { ...EMPTY_DEMO, answers: [] };
    const input = value as Record<string, unknown>;
    if (
      !Array.isArray(input.answers) ||
      input.answers.length > DEMO_QUESTIONS.length
    )
      return { ...EMPTY_DEMO, answers: [] };
    const answers: number[] = [];
    for (const [i, selected] of input.answers.entries()) {
      if (
        !Number.isInteger(selected) ||
        !DEMO_QUESTIONS[i]?.options[selected as number]
      )
        return { ...EMPTY_DEMO, answers: [] };
      answers.push(selected as number);
    }
    return {
      answers,
      completed:
        input.completed === true && answers.length === DEMO_QUESTIONS.length,
    };
  } catch {
    return { ...EMPTY_DEMO, answers: [] };
  }
}

export function demoMetrics(answers: readonly number[]) {
  const read = (index: number) =>
    DEMO_QUESTIONS[index]?.options[answers[index]!]?.value;
  const sales = typeof read(1) === "number" ? (read(1) as number) : null;
  const materials = typeof read(2) === "number" ? (read(2) as number) : null;
  const fixed = materials === null ? null : 850;
  const repayment = typeof read(3) === "number" ? (read(3) as number) : null;
  const available =
    sales !== null && materials !== null && repayment !== null
      ? sales - materials - 850 - repayment
      : null;
  return {
    sales,
    materials,
    fixed,
    repayment,
    available,
    plan: read(4),
    purpose: read(5),
  };
}

export function money(value: number | null) {
  return value === null ? "확인 전" : `${value.toLocaleString("ko-KR")}만 원`;
}

export function demoImprovement(answers: readonly number[]) {
  const plan = demoMetrics(answers).plan;
  return plan === "customers"
    ? {
        title: "오후 단골 방문 혜택 시험",
        reason: "사장님이 오후 손님이 적다고 말씀했어요.",
        action: "2주 동안 오후 방문 건수와 혜택에 든 비용을 함께 기록합니다.",
        evidence: "시간대별 POS 매출 · 혜택 비용 기록",
        owner: "사장님",
        period: "2주 실행 후 검토",
      }
    : {
        title: "재료 사용과 폐기 기록 시작",
        reason:
          "사장님이 남는 재료와 재고 기록을 먼저 개선하고 싶다고 말씀했어요.",
        action:
          "2주 동안 매일 발주량·사용량·폐기량을 기록하고 다음 발주량을 검토합니다.",
        evidence: "매입 내역 · 일별 재고·폐기 기록",
        owner: "사장님",
        period: "2주 실행 후 검토",
      };
}
