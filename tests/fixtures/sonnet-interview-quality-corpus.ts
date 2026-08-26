export const SONNET_QUALITY_CORPUS = {
  neutralBusiness: {
    answer: "최근 3개월 월평균 매출은 2,300만원입니다.",
    unsupportedIndustryTerms: ["카페", "음식점", "식당", "미용실"],
  },
  incidentalFacts: {
    answer:
      "최근 3개월 월평균 매출은 2,300만원이고, 월 고정 운영비는 1,100만원입니다.",
    answeredInfoCodes: ["monthly_average_sales", "fixed_operating_costs"],
    expectedNextInfoCode: "improvement_plan",
  },
  clarificationBoundaries: [
    {
      name: "unknown",
      firstAnswer: "잘 모르겠어요.",
      secondAnswer: "아직도 잘 모르겠습니다.",
      expectedTerminalStatus: "UNAVAILABLE",
      expectedTerminalValueState: "UNKNOWN",
    },
    {
      name: "refusal",
      firstAnswer: "그 부분은 말하고 싶지 않아요.",
      secondAnswer: "답변을 거부합니다.",
      expectedTerminalStatus: "REFUSED",
      expectedTerminalValueState: "REFUSED",
    },
  ],
  validPhrasing: {
    reaction: "말씀하신 내용을 확인했어요.",
    modelQuestion: "이어서 다음 내용도 편하게 말씀해 주실까요?",
  },
  semanticHallucination: {
    answer: "매출은 비슷합니다.",
    unsupportedReaction: "매출이 크게 늘었군요.",
  },
} as const;

export type ClarificationBoundaryScenario =
  (typeof SONNET_QUALITY_CORPUS.clarificationBoundaries)[number];
