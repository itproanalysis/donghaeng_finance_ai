export const INTERVIEW_CONTEXT_CATALOG_VERSION = "dev-v1" as const;

export const REQUIRED_SEASONALITY_LABELS = [
  "신학기",
  "방학",
  "명절",
  "연말",
  "휴가철",
  "성수기",
  "비수기",
  "장마",
  "폭염/한파",
  "지역행사",
] as const;

export const REQUIRED_SITUATION_LABELS = [
  "매출급감",
  "매출회복",
  "원가급등",
  "휴업",
  "미수금",
  "재고누적",
  "플랫폼수수료 압박",
  "신규사업",
  "부채증가",
] as const;

export type SeasonalityLabel = (typeof REQUIRED_SEASONALITY_LABELS)[number];
export type SituationLabel = (typeof REQUIRED_SITUATION_LABELS)[number];
export type InterviewContextLabel = SeasonalityLabel | SituationLabel;

export interface InterviewContextDefinition {
  catalogVersion: typeof INTERVIEW_CONTEXT_CATALOG_VERSION;
  code: string;
  label: InterviewContextLabel;
  kind: "SEASONALITY" | "SITUATION";
  aliases: readonly string[];
  evidencePrompts: readonly string[];
  comparisonPolicy: "BORROWER_HISTORY_FIRST";
  externalBaselinePolicy: "ONLY_IF_BORROWER_HISTORY_UNAVAILABLE";
  scoreEffect: "CONTEXT_ONLY";
  modelCandidate: false;
  defaultAdjustment: null;
}

function context(input: Omit<InterviewContextDefinition, "catalogVersion" | "comparisonPolicy" | "externalBaselinePolicy" | "scoreEffect" | "modelCandidate" | "defaultAdjustment">): InterviewContextDefinition {
  return {
    ...input,
    catalogVersion: INTERVIEW_CONTEXT_CATALOG_VERSION,
    comparisonPolicy: "BORROWER_HISTORY_FIRST",
    externalBaselinePolicy: "ONLY_IF_BORROWER_HISTORY_UNAVAILABLE",
    scoreEffect: "CONTEXT_ONLY",
    modelCandidate: false,
    defaultAdjustment: null,
  };
}

export const INTERVIEW_CONTEXT_CATALOG: readonly InterviewContextDefinition[] = [
  context({ code: "SCHOOL_OPENING", label: "신학기", kind: "SEASONALITY", aliases: ["개학", "새학기"], evidencePrompts: ["본인의 지난해 같은 신학기 매출·주문", "확정 등록·예약"] }),
  context({ code: "SCHOOL_BREAK", label: "방학", kind: "SEASONALITY", aliases: ["여름방학", "겨울방학"], evidencePrompts: ["본인의 과거 방학기간 매출·주문", "현재 예약·등록"] }),
  context({ code: "HOLIDAY", label: "명절", kind: "SEASONALITY", aliases: ["설", "추석", "연휴"], evidencePrompts: ["본인의 과거 동일 명절 전후 매출", "확정 주문·재고"] }),
  context({ code: "YEAR_END", label: "연말", kind: "SEASONALITY", aliases: ["송년", "12월"], evidencePrompts: ["본인의 과거 연말 매출·예약", "확정 주문"] }),
  context({ code: "VACATION_SEASON", label: "휴가철", kind: "SEASONALITY", aliases: ["휴가", "여름휴가"], evidencePrompts: ["본인의 과거 휴가철 매출·예약", "현재 예약"] }),
  context({ code: "PEAK_SEASON", label: "성수기", kind: "SEASONALITY", aliases: ["피크시즌"], evidencePrompts: ["본인이 정의한 성수기 기간", "과거 같은 기간의 매출·가동률"] }),
  context({ code: "OFF_SEASON", label: "비수기", kind: "SEASONALITY", aliases: ["로우시즌"], evidencePrompts: ["본인이 정의한 비수기 기간", "과거 같은 기간의 매출·고정비"] }),
  context({ code: "MONSOON", label: "장마", kind: "SEASONALITY", aliases: ["장마철", "우기"], evidencePrompts: ["본인의 과거 장마기간 채널별 주문", "영업일·휴업 기록"] }),
  context({ code: "EXTREME_TEMPERATURE", label: "폭염/한파", kind: "SEASONALITY", aliases: ["폭염", "한파", "혹서", "혹한"], evidencePrompts: ["본인의 과거 유사 기온기간 매출", "채널별 주문·가동률"] }),
  context({ code: "LOCAL_EVENT", label: "지역행사", kind: "SEASONALITY", aliases: ["축제", "지역축제", "박람회"], evidencePrompts: ["본인의 과거 동일·유사 행사 매출", "행사기간 확정 주문·예약"] }),

  context({ code: "SALES_SHARP_DECLINE", label: "매출급감", kind: "SITUATION", aliases: ["매출 급감", "매출급락"], evidencePrompts: ["급감 전후 본인 매출 원천자료", "발생일과 지속기간"] }),
  context({ code: "SALES_RECOVERY", label: "매출회복", kind: "SITUATION", aliases: ["매출 회복", "회복세"], evidencePrompts: ["저점 이후 본인 주차별 매출", "회복 행동과 시점"] }),
  context({ code: "INPUT_COST_SPIKE", label: "원가급등", kind: "SITUATION", aliases: ["원가 급등", "비용급등"], evidencePrompts: ["급등 전후 매입원장", "가격전가·대체조달 행동"] }),
  context({ code: "BUSINESS_SUSPENSION", label: "휴업", kind: "SITUATION", aliases: ["영업중단", "임시휴업"], evidencePrompts: ["휴업 시작·종료일", "재개 후 본인 주문·매출"] }),
  context({ code: "RECEIVABLE_OVERDUE", label: "미수금", kind: "SITUATION", aliases: ["미수", "외상대금"], evidencePrompts: ["본인 매출채권 원장", "회수 예정일·실제 회수일"] }),
  context({ code: "INVENTORY_BUILDUP", label: "재고누적", kind: "SITUATION", aliases: ["재고 누적", "장기재고"], evidencePrompts: ["본인 재고 입출고 기록", "재고연령·회전"] }),
  context({ code: "PLATFORM_FEE_PRESSURE", label: "플랫폼수수료 압박", kind: "SITUATION", aliases: ["플랫폼 수수료 압박", "배달수수료 부담"], evidencePrompts: ["본인 플랫폼 정산서", "채널별 매출·수수료"] }),
  context({ code: "NEW_BUSINESS", label: "신규사업", kind: "SITUATION", aliases: ["신규 사업", "창업", "영업 전"], evidencePrompts: ["본인 확정 주문·계약", "매출 이력 부재 여부"] }),
  context({ code: "DEBT_INCREASE", label: "부채증가", kind: "SITUATION", aliases: ["부채 증가", "대출증가"], evidencePrompts: ["본인 채무 원장", "증가 시점·용도·상환액"] }),
];

function normalizeContext(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR").replace(/[\s/·_-]+/g, "");
}

export function findInterviewContext(value: string): InterviewContextDefinition | null {
  const normalized = normalizeContext(value);
  return INTERVIEW_CONTEXT_CATALOG.find((definition) =>
    [definition.label, ...definition.aliases].some(
      (candidate) => normalizeContext(candidate) === normalized,
    ),
  ) ?? null;
}

export function getInterviewContextsByKind(
  kind: InterviewContextDefinition["kind"],
): InterviewContextDefinition[] {
  return INTERVIEW_CONTEXT_CATALOG.filter((definition) => definition.kind === kind);
}

export function validateInterviewContextCatalog(
  catalog: readonly InterviewContextDefinition[] = INTERVIEW_CONTEXT_CATALOG,
): string[] {
  const issues: string[] = [];
  const codes = new Set<string>();
  const labels = new Set<string>();
  for (const definition of catalog) {
    if (codes.has(definition.code)) issues.push(`duplicate context code: ${definition.code}`);
    if (labels.has(definition.label)) issues.push(`duplicate context label: ${definition.label}`);
    codes.add(definition.code);
    labels.add(definition.label);
    if (definition.catalogVersion !== INTERVIEW_CONTEXT_CATALOG_VERSION) {
      issues.push(`invalid context catalog version: ${definition.code}`);
    }
    if (definition.evidencePrompts.length === 0) {
      issues.push(`context requires evidence prompts: ${definition.code}`);
    }
    if (
      definition.comparisonPolicy !== "BORROWER_HISTORY_FIRST" ||
      definition.externalBaselinePolicy !== "ONLY_IF_BORROWER_HISTORY_UNAVAILABLE"
    ) {
      issues.push(`borrower history must have priority: ${definition.code}`);
    }
    if (
      definition.scoreEffect !== "CONTEXT_ONLY" ||
      definition.modelCandidate !== false ||
      definition.defaultAdjustment !== null
    ) {
      issues.push(`context must not create an automatic score adjustment: ${definition.code}`);
    }
  }
  for (const label of [...REQUIRED_SEASONALITY_LABELS, ...REQUIRED_SITUATION_LABELS]) {
    if (!labels.has(label)) issues.push(`missing required context: ${label}`);
  }
  return issues;
}
