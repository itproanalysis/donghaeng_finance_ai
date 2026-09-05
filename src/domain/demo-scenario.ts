import type { DevV1AllInfoCode, DevV1ConditionalInfoCode } from "./information-catalog";

/**
 * 심사 시연용 사장님 한 명의 인터뷰 대본.
 *
 * 값은 지어내지 않고 `data/mock/case_operating_drop`에 이미 있는 거래 데이터와
 * 인터뷰 답에서 가져왔다. 답변 문장은 `information-parsers.ts`를 실제로 통과해야
 * 하며, 통과 여부는 `tests/domain/demo-scenario.test.ts`가 판정한다.
 *
 * 이 파일은 화면에 의존하지 않는 데이터만 담는다. 자동 재생, 검증 스크립트,
 * 문서가 모두 여기 상수를 읽으므로 대본과 실물이 어긋나지 않는다.
 */

export interface DemoScenarioPersona {
  borrowerName: string;
  businessName: string;
  industryCode: string;
}

export interface DemoScenarioAnswerSet {
  id: string;
  label: string;
  /** modeling 쪽에서 같은 답을 담고 있는 케이스 폴더 */
  modelingCaseId: string;
  answers: Readonly<Partial<Record<DevV1AllInfoCode, string>>>;
}

export interface DemoScenario {
  id: string;
  persona: DemoScenarioPersona;
  /**
   * 거래 데이터에서 추가 질문 조건에 걸린 항목. 판정은 앱이 하지 않고
   * `modeling/triggers.py`가 하며, 여기 값은 그 결과를 옮겨 적은 것이다.
   */
  triggeredInfoCodes: readonly DevV1ConditionalInfoCode[];
  primary: DemoScenarioAnswerSet;
  /** 거래 데이터는 같고 사유와 목표만 답하지 않은 인터뷰 */
  control: DemoScenarioAnswerSet;
}

const PRIMARY_ANSWERS: Readonly<Partial<Record<DevV1AllInfoCode, string>>> = {
  monthly_average_sales: "최근 3개월 월평균 매출은 2600만원입니다.",
  fixed_operating_costs: "고정비는 월 1190만원입니다.",
  operating_day_drop_reason:
    "지난봄에 허리를 다쳐서 자주 문을 닫았습니다. 지금은 치료가 끝나서 다시 매일 열고 있습니다.",
  improvement_plan:
    "가장 큰 문제는 일손이 부족해서 가게 문을 못 여는 날이 생기는 것입니다. 여는 날을 지금 23일에서 6개월 안에 29일까지 늘리고, 장부로 매번 확인하겠습니다.",
  execution_readiness: "예산 80만원은 확보했고 일정도 정했습니다. 아직 일손이 부족합니다.",
  confirmed_reservations: "앞으로 4주 안에 확정된 예약이나 주문은 0건입니다.",
  seasonality_outlook:
    "앞으로 3개월은 비수기라 작년 이맘때도 주문이 줄었고 올해도 줄 것 같습니다.",
  // 가계 항목은 진술 단독이라 2축 점수에 들어가지 않는다. 답을 거부하면 앱이
  // 완료를 막으므로 금액으로 답한다.
  essential_household_expenses: "필수 가계지출은 월 220만원입니다.",
  emergency_buffer_months: "비상자금으로 필수 생활비를 3개월 감당할 수 있습니다.",
  platform_fee_pressure: "배달은 거의 안 해서 플랫폼 수수료 부담 없습니다.",
  hall_customer_decline: "홀 손님은 문을 못 연 날 말고는 그대로입니다.",
  repeat_customer_share: "최근 한 달 기준 단골 매출은 45%입니다.",
};

const CONTROL_ANSWERS: Readonly<Partial<Record<DevV1AllInfoCode, string>>> = {
  ...PRIMARY_ANSWERS,
  operating_day_drop_reason: "그건 잘 모르겠습니다.",
  improvement_plan: "아직 계획을 정하지 못했습니다.",
  execution_readiness: "아직 준비하지 못했습니다.",
};

export const OPERATING_DAY_DEMO_SCENARIO: DemoScenario = {
  id: "operating-day",
  persona: {
    borrowerName: "표기웅",
    businessName: "느티나무감자탕",
    industryCode: "RESTAURANT",
  },
  triggeredInfoCodes: ["operating_day_drop_reason"],
  primary: {
    id: "operating-day-primary",
    label: "영업일 사유를 확인한 인터뷰",
    modelingCaseId: "case_operating_drop",
    answers: PRIMARY_ANSWERS,
  },
  control: {
    id: "operating-day-control",
    label: "영업일 사유를 확인하지 못한 인터뷰",
    modelingCaseId: "case_no_answer",
    answers: CONTROL_ANSWERS,
  },
};

export const DEMO_SCENARIOS: readonly DemoScenario[] = [OPERATING_DAY_DEMO_SCENARIO];

export function findDemoScenario(id: string): DemoScenario | null {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id) ?? null;
}
