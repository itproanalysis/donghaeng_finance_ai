import {
  DEV_V1_ALL_INFORMATION_CATALOG,
  type DevV1AllInfoCode,
  type DevV1InformationDefinition,
} from "./information-catalog";
import type { InformationQuality, InformationStatus, ValueState } from "./interview";
import {
  alignEvidenceSpan,
  CANONICAL_VALUE_SCHEMA_VERSION,
  exact,
  range,
  type CanonicalExtractionCandidate,
  type CanonicalInformationValue,
  type ConfirmedReservationsValue,
  type DurationValue,
  type ExecutionReadinessValue,
  type GoalMetricValue,
  type ImprovementPlanValue,
  type NumericMeasure,
  type OperatingDayDropReason,
  type PeriodicMoneyValue,
  type ReadinessResourceType,
  type SeasonalityBasisKind,
  type SeasonalityOutlookValue,
  type TextEvidenceSpan,
} from "./information-values";

export interface InformationParserContext {
  currentInfoCode: DevV1AllInfoCode | null;
}

export type CanonicalInformationParser = (
  text: string,
  context: InformationParserContext,
) => CanonicalExtractionCandidate | null;

const REFUSAL_PATTERN =
  /(?:답변|대답|말씀|공개|공유).{0,12}(?:거부|싫|어렵|안\s*할|못\s*할)|(?:말|얘기|답)하고\s*싶지|(?:말|얘기|답)하기.{0,6}(?:싫|어렵|꺼려)|알려\s*드리기.{0,6}(?:싫|어렵|꺼려)|그\s*(?:부분|건|거)는?.{0,10}(?:말|답).{0,8}(?:싫|어렵|안\s*할)/i;
const UNAVAILABLE_PATTERN =
  /(잘\s*모르|잘\s*몰라|모르겠|모른(?:다|다고|다는)|모름|몰라|기억이?\s*안\s*나|확인하기\s*어렵|파악이?\s*안\s*되)/i;
const NOT_APPLICABLE_PATTERN = /해당\s*(사항이?)?\s*없/i;
const NEGATIVE_PATTERN = /(?:-|−|마이너스|적자)\s*[0-9]/i;
export const VAGUE_PATTERN = /(대략|정도|쯤|아마|것\s*같)/i;

export const DEV_V1_SEMANTIC_HALF_PERCENTAGE_RANGE = {
  version: "dev-v1",
  min: 45,
  max: 55,
} as const;

export const DEV_V1_PLAN_WEEKS_PER_STATED_DAL = 4 as const;

const UNIT_MULTIPLIERS: Record<string, number> = {
  억: 100_000_000,
  천만: 10_000_000,
  백만: 1_000_000,
  십만: 100_000,
  만: 10_000,
  천: 1_000,
  백: 100,
};

const KOREAN_SMALL_NUMBERS: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};

const OFF_TURN_STRONG_ANCHORS: Record<DevV1AllInfoCode, readonly string[]> = {
  monthly_average_sales: ["월평균 매출", "월 매출", "매출은", "매출이"],
  fixed_operating_costs: ["고정 운영비", "고정비", "운영비는"],
  improvement_plan: ["개선 계획", "개선하려", "개선할"],
  execution_readiness: ["실행 준비", "준비한 인력", "준비한 예산", "준비한 일정"],
  confirmed_reservations: ["확정 예약", "확정 주문", "확정 수주"],
  seasonality_outlook: ["계절성", "수요 전망", "향후 석 달"],
  essential_household_expenses: ["필수 가계지출", "가계지출", "생활비는"],
  emergency_buffer_months: ["비상자금", "비상금", "생활비를 감당"],
  platform_fee_pressure: ["플랫폼 수수료", "배달 수수료", "수수료가", "수수료는"],
  hall_customer_decline: ["홀 손님", "홀손님", "홀 매출", "매장 손님"],
  repeat_customer_share: ["반복고객", "단골"],
  operating_day_drop_reason: ["문 연 날", "문 여는 날", "영업일"],
};

function normalize(text: string): string {
  return text.normalize("NFKC").replace(/,/g, "").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface AnchorMatch {
  anchor: string;
  index: number;
}

function isSuppressedOffTurnAnchor(
  infoCode: DevV1AllInfoCode,
  text: string,
  match: AnchorMatch,
): boolean {
  if (
    infoCode !== "monthly_average_sales" ||
    !["매출은", "매출이"].includes(match.anchor)
  ) {
    return false;
  }

  const prefix = text.slice(Math.max(0, match.index - 16), match.index);
  return /(?:단골(?:\s*고객)?|반복\s*고객)\s*$/.test(prefix);
}

function findAnchorMatches(text: string, anchors: readonly string[]): AnchorMatch[] {
  return anchors.flatMap((anchor) => {
    const matches: AnchorMatch[] = [];
    let index = text.indexOf(anchor);
    while (index >= 0) {
      matches.push({ anchor, index });
      index = text.indexOf(anchor, index + anchor.length);
    }
    return matches;
  });
}

function findClause(
  text: string,
  definition: DevV1InformationDefinition,
  context: InformationParserContext,
): TextEvidenceSpan | null {
  const isCurrent = context.currentInfoCode === definition.infoCode;
  const anchors = isCurrent
    ? definition.semanticAnchors
    : OFF_TURN_STRONG_ANCHORS[definition.infoCode];
  const matchingAnchor = findAnchorMatches(text, anchors)
    .filter((match) => isCurrent || !isSuppressedOffTurnAnchor(definition.infoCode, text, match))
    .sort((left, right) => left.index - right.index || right.anchor.length - left.anchor.length)[0];

  if (!matchingAnchor) {
    return isCurrent ? { start: 0, end: text.length, text } : null;
  }

  // A plan commonly names the same customer/channel concepts that are also
  // optional information anchors. Keep the complete current plan utterance so
  // its action, baseline, target, period and measurement source stay together.
  // Off-turn extraction still receives its own narrow, anchor-bounded span.
  const keepCompleteCurrentUtterance =
    isCurrent &&
    ["improvement_plan", "repeat_customer_share"].includes(definition.infoCode);
  const nextOtherAnchor = keepCompleteCurrentUtterance
    ? undefined
    : DEV_V1_ALL_INFORMATION_CATALOG.flatMap((candidate) =>
        candidate.infoCode === definition.infoCode
          ? []
          : findAnchorMatches(text, OFF_TURN_STRONG_ANCHORS[candidate.infoCode])
              .filter(
                (match) =>
                  match.index >= matchingAnchor.index + matchingAnchor.anchor.length &&
                  !isSuppressedOffTurnAnchor(candidate.infoCode, text, match),
              ),
      )
        .sort((left, right) => left.index - right.index)[0];

  let end = nextOtherAnchor?.index ?? text.length;
  const punctuation = text.slice(matchingAnchor.index).search(/[.!?\n;]/);
  if (!isCurrent && punctuation >= 0) {
    end = Math.min(end, matchingAnchor.index + punctuation + 1);
  }
  const clauseText = text.slice(matchingAnchor.index, end).trim();
  const start = text.indexOf(clauseText, matchingAnchor.index);
  const validStart = start >= 0 ? start : matchingAnchor.index;
  return alignEvidenceSpan(text, {
    start: validStart,
    end: validStart + clauseText.length,
    text: clauseText,
  });
}

function parseNumericToken(token: string): number | null {
  const normalized = token.trim();
  if (normalized in KOREAN_SMALL_NUMBERS) return KOREAN_SMALL_NUMBERS[normalized];
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function amountFromParts(numberToken: string, unit?: string): number | null {
  const numeric = Number(numberToken);
  if (!Number.isFinite(numeric)) return null;
  const multiplier = unit ? UNIT_MULTIPLIERS[unit] : 1;
  const amount = numeric * multiplier;
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function parseSingleMoney(text: string): number[] {
  const normalized = normalize(text);
  const compoundEokPattern = /([0-9]+(?:\.[0-9]+)?)\s*억\s*(?:([0-9]+(?:\.[0-9]+)?)\s*(천만|만|천))?\s*원/g;
  const compoundEoks = Array.from(normalized.matchAll(compoundEokPattern)).map((match) => {
    const eokAmount = Number(match[1]) * 100_000_000;
    const subVal = Number(match[2] ?? 0);
    const subUnit = match[3];
    const subMultiplier = subUnit === "천만" || subUnit === "천" ? 10_000_000 : 10_000;
    return eokAmount + subVal * subMultiplier;
  });
  if (compoundEoks.length > 0) return compoundEoks.filter(Number.isSafeInteger);

  const compoundCheonPattern = /([0-9]+)\s*천\s*(?:([0-9]+)\s*백)?\s*만?\s*원/g;
  const compoundCheons = Array.from(normalized.matchAll(compoundCheonPattern)).map((match) => {
    const cheonVal = Number(match[1]);
    const baekVal = Number(match[2] ?? 0);
    return (cheonVal * 1000 + baekVal * 100) * 10_000;
  });
  if (compoundCheons.length > 0) return compoundCheons.filter(Number.isSafeInteger);

  const pattern = /([0-9]+(?:\.[0-9]+)?)\s*(억|천만|백만|십만|만|천|백)?\s*원/g;
  return Array.from(normalized.matchAll(pattern))
    .map((match) => amountFromParts(match[1], match[2]))
    .filter((amount): amount is number => amount !== null);
}

export function parseKoreanMoneyMeasure(text: string): NumericMeasure | null {
  const normalized = normalize(text);
  if (NEGATIVE_PATTERN.test(normalized)) return null;

  const rangePattern = new RegExp(
    "([0-9]+(?:\\.[0-9]+)?)\\s*(억|천만|백만|십만|만|천|백)?\\s*(?:원)?\\s*(?:~|〜|에서|부터|[-–—])\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(억|천만|백만|십만|만|천|백)?\\s*원",
  );
  const rangeMatch = normalized.match(rangePattern);
  if (rangeMatch) {
    const leftUnit = rangeMatch[2] || rangeMatch[4];
    const rightUnit = rangeMatch[4] || rangeMatch[2];
    const left = amountFromParts(rangeMatch[1], leftUnit);
    const right = amountFromParts(rangeMatch[3], rightUnit);
    if (left !== null && right !== null) return range(Math.min(left, right), Math.max(left, right));
  }

  const totalPattern = /(?:합계|총액|총)\s*(?:은|이|가)?\s*([0-9]+(?:\.[0-9]+)?)\s*(억|천만|백만|십만|만|천|백)?\s*원/;
  const totalMatch = normalized.match(totalPattern);
  if (totalMatch) {
    const amount = amountFromParts(totalMatch[1], totalMatch[2]);
    return amount === null ? null : exact(amount);
  }

  const amounts = parseSingleMoney(normalized);
  return amounts.length === 1 ? exact(amounts[0]) : null;
}

function terminalCandidate(
  definition: DevV1InformationDefinition,
  span: TextEvidenceSpan,
  disposition: "UNAVAILABLE" | "REFUSED" | "NOT_APPLICABLE",
): CanonicalExtractionCandidate {
  const valueState: ValueState =
    disposition === "REFUSED"
      ? "REFUSED"
      : disposition === "NOT_APPLICABLE"
        ? "NOT_APPLICABLE"
        : "UNKNOWN";
  return {
    infoCode: definition.infoCode,
    valueState,
    value: null,
    parserConfidence: 1,
    quality: null,
    verification: disposition === "UNAVAILABLE" ? "UNKNOWN" : "SELF_REPORTED",
    evidenceSpan: span,
    missingFields: [],
    proposedStatus: disposition,
    terminalDisposition: disposition,
    explanation: `차주의 명시적 ${disposition} 응답을 값과 분리해 보존했습니다.`,
  };
}

function boundaryCandidate(
  definition: DevV1InformationDefinition,
  span: TextEvidenceSpan,
  options: { notApplicableAllowed: boolean },
): CanonicalExtractionCandidate | null {
  if (REFUSAL_PATTERN.test(span.text)) return terminalCandidate(definition, span, "REFUSED");
  if (UNAVAILABLE_PATTERN.test(span.text)) return terminalCandidate(definition, span, "UNAVAILABLE");
  if (options.notApplicableAllowed && NOT_APPLICABLE_PATTERN.test(span.text)) {
    return terminalCandidate(definition, span, "NOT_APPLICABLE");
  }
  return null;
}

function ambiguousCandidate(
  definition: DevV1InformationDefinition,
  span: TextEvidenceSpan,
  missingFields: string[],
  explanation: string,
): CanonicalExtractionCandidate {
  return {
    infoCode: definition.infoCode,
    valueState: "UNKNOWN",
    value: null,
    parserConfidence: 1,
    quality: null,
    verification: "UNKNOWN",
    evidenceSpan: span,
    missingFields,
    proposedStatus: "NEEDS_FOLLOWUP",
    terminalDisposition: null,
    explanation,
  };
}

function presentCandidate(
  definition: DevV1InformationDefinition,
  span: TextEvidenceSpan,
  value: CanonicalInformationValue,
  quality: InformationQuality,
  missingFields: string[] = [],
  explanation = "결정론적 parser로 canonical 값을 추출했습니다.",
): CanonicalExtractionCandidate {
  const proposedStatus: InformationStatus =
    missingFields.length > 0 || quality === "LOW" && definition.minQuality !== "LOW"
      ? "NEEDS_FOLLOWUP"
      : "CONFIRMED";
  return {
    infoCode: definition.infoCode,
    valueState: "PRESENT",
    value,
    parserConfidence: 1,
    quality,
    verification: "SELF_REPORTED",
    evidenceSpan: span,
    missingFields,
    proposedStatus,
    terminalDisposition: null,
    explanation,
  };
}

function informationDefinition(infoCode: DevV1AllInfoCode): DevV1InformationDefinition {
  const definition = DEV_V1_ALL_INFORMATION_CATALOG.find((item) => item.infoCode === infoCode);
  if (!definition) throw new Error(`Unknown dev-v1 info code: ${infoCode}`);
  return definition;
}

const moneyDefinition = informationDefinition;

function parseMoneyInformation(
  infoCode: "monthly_average_sales" | "fixed_operating_costs" | "essential_household_expenses",
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = moneyDefinition(infoCode);
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: false });
  if (boundary) return boundary;
  if (NEGATIVE_PATTERN.test(normalize(span.text))) {
    return ambiguousCandidate(
      definition,
      span,
      ["nonNegativeAmount"],
      "음수 매출·비용은 손익과 혼동될 수 있어 0 이상의 금액을 다시 확인해야 합니다.",
    );
  }

  let amount = parseKoreanMoneyMeasure(span.text);
  const explicitNone = /(매출|비용|운영비|생활비|가계지출).{0,8}(없|발생하지\s*않)/i.test(span.text);
  if (!amount && explicitNone) amount = exact(0);
  if (!amount) {
    return ambiguousCandidate(
      definition,
      span,
      ["amount"],
      "한 금액 또는 실제 범위를 찾지 못했으며 임의 중간값이나 합계를 만들지 않았습니다.",
    );
  }

  const basis: PeriodicMoneyValue["basis"] =
    infoCode === "monthly_average_sales"
      ? "GROSS_SALES"
      : infoCode === "fixed_operating_costs"
        ? "FIXED_OPERATING_COST_TOTAL"
        : "ESSENTIAL_HOUSEHOLD_EXPENSE";
  const value: PeriodicMoneyValue = {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "PERIODIC_MONEY",
    amount,
    currency: "KRW",
    cadence: "MONTH",
    aggregation: infoCode === "monthly_average_sales" ? "AVERAGE" : "TOTAL",
    basis,
    referenceWindow:
      infoCode === "monthly_average_sales" || infoCode === "fixed_operating_costs"
        ? { unit: "MONTH", count: 3, relation: "TRAILING", source: "QUESTION_CONTEXT" }
        : { unit: "MONTH", count: 1, relation: "CURRENT", source: "QUESTION_CONTEXT" },
    grossNetBasis: infoCode === "monthly_average_sales" ? "UNSPECIFIED" : undefined,
  };
  const zeroNeedsConfirmation =
    amount.kind === "EXACT" && amount.value === 0 && definition.zeroMeaning === "REQUIRES_CONFIRMATION";
  const missingFields = [
    ...(amount.kind === "RANGE" ? ["exactAmount"] : []),
    ...(zeroNeedsConfirmation ? ["zeroConfirmation"] : []),
  ];
  return presentCandidate(
    definition,
    span,
    value,
    amount.kind === "RANGE" ? "LOW" : "MEDIUM",
    missingFields,
    amount.kind === "RANGE"
      ? "구간을 중간값으로 바꾸지 않고 canonical range로 보존했습니다."
      : "월 기준 KRW 금액을 결정론적으로 추출했습니다.",
  );
}

function splitClauses(text: string): Array<{ text: string; start: number; end: number }> {
  const clauses: Array<{ text: string; start: number; end: number }> = [];
  const pattern = /[^.!?\n;]+[.!?]?/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0].trim();
    if (!raw) continue;
    const start = (match.index ?? 0) + match[0].indexOf(raw);
    clauses.push({ text: raw, start, end: start + raw.length });
  }
  return clauses;
}

function numericMetricFromText(text: string, anchor: RegExp): GoalMetricValue | null {
  const match = text.match(anchor);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const magnitude = match[2];
  const semanticUnit = match[3];
  if (semanticUnit === "%" || semanticUnit === "퍼센트") {
    return { value: exact(numeric), unit: "%" };
  }
  if (semanticUnit === "건") {
    return { value: exact(numeric), unit: "CASE" };
  }
  if (semanticUnit === "일") {
    return { value: exact(numeric), unit: "DAY" };
  }
  if (semanticUnit === "원" || magnitude) {
    const amount = amountFromParts(match[1], magnitude);
    return amount === null ? null : { value: exact(amount), unit: "KRW" };
  }
  // 단위 없는 숫자를 임의로 비율로 해석하지 않는다.
  return null;
}

export function parseImprovementPlan(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = moneyDefinition("improvement_plan");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: true });
  if (boundary) return boundary;
  const noPlan = /(계획|개선).{0,8}(없|못\s*세웠|정하지\s*못)|아직\s*계획/i.test(span.text);
  if (noPlan) {
    const value: ImprovementPlanValue = {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "IMPROVEMENT_PLAN",
      planExists: false,
      problem: null,
      actions: [],
      owner: "BORROWER",
      schedule: null,
      baseline: null,
      target: null,
      measurementSources: [],
      origin: "BORROWER_DIRECT",
    };
    return presentCandidate(definition, span, value, "MEDIUM", [], "계획이 없다는 직접 진술을 결측이 아닌 관측값으로 보존했습니다.");
  }

  const clauses = splitClauses(span.text);
  const actionPattern = /(하겠|할\s*계획|추진|도입|줄이|늘리|개선|정리|운영|시작|바꾸|받고\s*싶|하려고|하고\s*싶)/i;
  const problemPattern = /(문제|부담|어려|감소|하락|비용|폐기|재방문|매출)/i;
  const actions = clauses
    .filter((clause) => actionPattern.test(clause.text))
    .map((clause) => ({
      text: clause.text,
      evidenceSpan: {
        start: span.start + clause.start,
        end: span.start + clause.end,
        text: clause.text,
      },
    }));
  const problem = clauses.find((clause) => problemPattern.test(clause.text))?.text ?? null;
  const durationMatch = span.text.match(
    /([0-9]+(?:\.[0-9]+)?|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)\s*(주|개월|달)\s*(?:안|내|동안|까지)?/,
  );
  const durationNumber = durationMatch ? parseNumericToken(durationMatch[1]) : null;
  const duration: DurationValue | null = durationMatch
    && durationNumber !== null
    ? {
        schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
        kind: "DURATION",
        duration: exact(
          durationMatch[2] === "달"
            ? durationNumber * DEV_V1_PLAN_WEEKS_PER_STATED_DAL
            : durationNumber,
        ),
        unit: durationMatch[2] === "주" || durationMatch[2] === "달" ? "WEEK" : "MONTH",
        basis: "PLAN_SCHEDULE",
        derivedFrom: null,
      }
    : null;
  const metricNumber = "([0-9]+(?:\\.[0-9]+)?)";
  const moneyMagnitude = "(억|천만|백만|십만|만|천|백)?";
  const metricUnit = "(원|%|퍼센트|건|일)?";
  const baseline = numericMetricFromText(
    span.text,
    new RegExp(
      `(?:현재|지금|기준)\\s*(?:(?:직접\\s*주문|전화\\s*주문|해당\\s*수치)(?:\\s*비중)?(?:이|가|은|는)?\\s*)?${metricNumber}\\s*${moneyMagnitude}\\s*${metricUnit}`,
    ),
  );
  const target =
    numericMetricFromText(
      span.text,
      new RegExp(`목표\\s*(?:값은?|는|를)?\\s*${metricNumber}\\s*${moneyMagnitude}\\s*${metricUnit}`),
    ) ??
    numericMetricFromText(
      span.text,
      new RegExp(
        `${metricNumber}\\s*${moneyMagnitude}\\s*${metricUnit}\\s*(?:까지|로)\\s*(?:늘리|높이|줄이|낮추|만들|확대|축소)`,
      ),
    );
  const measurementSources = [
    ...(/(POS|포스)/i.test(span.text) ? ["POS"] : []),
    ...(/(장부|회계)/i.test(span.text) ? ["ACCOUNTING_LEDGER"] : []),
    ...(/(영수증)/i.test(span.text) ? ["RECEIPT"] : []),
    ...(/(예약)/i.test(span.text) ? ["RESERVATION_LOG"] : []),
    ...(/(전화\s*주문|직접\s*주문)/i.test(span.text) ? ["PHONE_ORDER_LOG"] : []),
  ];
  const value: ImprovementPlanValue = {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "IMPROVEMENT_PLAN",
    planExists: actions.length > 0 || /계획/i.test(span.text),
    problem,
    actions,
    owner: "BORROWER",
    schedule: duration,
    baseline,
    target,
    measurementSources,
    origin: "BORROWER_DIRECT",
  };
  const missingFields = [
    ...(actions.length > 0 ? [] : ["actions"]),
    ...(baseline ? [] : ["baseline"]),
    ...(target ? [] : ["target"]),
    ...(duration ? [] : ["period"]),
    ...(measurementSources.length > 0 ? [] : ["measurementSource"]),
  ];
  return presentCandidate(
    definition,
    span,
    value,
    missingFields.length === 0 ? "MEDIUM" : "LOW",
    missingFields,
    "차주가 직접 말한 문제·행동·기간·수치만 구조화했습니다.",
  );
}

export function parsePlatformFeePressure(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = informationDefinition("platform_fee_pressure");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: true });
  if (boundary) return boundary;
  const relieved = /(부담이?\s*(?:아니|없)|수수료.{0,8}(?:낮|줄어))/i.test(span.text);
  const pressured = /(수수료.{0,16}(?:부담|많이\s*나가|높|비싸|과도)|부담.{0,12}수수료)/i.test(span.text);
  if (!relieved && !pressured) {
    return ambiguousCandidate(definition, span, ["pressurePresent"], "수수료 부담 여부를 명시적으로 확인해야 합니다.");
  }
  return presentCandidate(
    definition,
    span,
    {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "BUSINESS_SIGNAL",
      signal: "PLATFORM_FEE_PRESSURE",
      observed: pressured && !relieved,
      reason: null,
      resolved: null,
      origin: "BORROWER_DIRECT",
    },
    "LOW",
    [],
    "수수료에 대한 직접 진술만 구조화했으며 말투·감정은 사용하지 않았습니다.",
  );
}

export function parseHallCustomerDecline(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = informationDefinition("hall_customer_decline");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: true });
  if (boundary) return boundary;
  const notDeclined = /(줄지\s*않|감소하지\s*않|하락하지\s*않|늘|증가|회복|비슷|그대로)/i.test(span.text);
  const declined = !notDeclined && /(줄|감소|하락|적어|끊)/i.test(span.text);
  if (!declined && !notDeclined) {
    return ambiguousCandidate(definition, span, ["direction"], "홀 손님 변화 방향을 확인해야 합니다.");
  }
  return presentCandidate(
    definition,
    span,
    {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "BUSINESS_SIGNAL",
      signal: "HALL_CUSTOMER_DECLINE",
      observed: declined && !notDeclined,
      reason: null,
      resolved: null,
      origin: "BORROWER_DIRECT",
    },
    "LOW",
    [],
    "홀 손님 변화의 직접 진술만 구조화했으며 감정분석을 사용하지 않았습니다.",
  );
}

const OPERATING_DAY_DROP_REASON_PATTERNS: ReadonlyArray<
  readonly [OperatingDayDropReason, RegExp]
> = [
  ["HEALTH", /(건강|아파|아팠|다쳐|다쳤|수술|입원|치료)/i],
  ["FAMILY", /(가족|간병|돌봄|육아|장례|상을\s*당)/i],
  ["STAFFING", /(일손|인력|직원|구인|사람을?\s*못\s*구)/i],
  ["DEMAND_DECLINE", /(손님이?\s*(?:줄|없)|수요\s*(?:감소|가\s*줄)|장사가?\s*안\s*(?:돼|되))/i],
  ["BUSINESS_DOWNSIZING", /(사업을?\s*축소|규모를?\s*줄|영업\s*시간을?\s*줄|정리하려)/i],
];

const OPERATING_DAY_DROP_UNRESOLVED_PATTERN =
  /(아직|여전히|계속되|나아지지\s*않|그대로|진행\s*중)/i;
const OPERATING_DAY_DROP_RESOLVED_PATTERN =
  /(치료가?\s*끝|다\s*나았|회복(?:했|됐|되었)|해결(?:했|됐|되었)|지금은\s*(?:괜찮|정상)|다시\s*매일)/i;

/**
 * 데이터에서 영업일 감소가 확인됐을 때만 묻는 사유 질문. 사유 보기와 해소 여부만
 * 뽑고, 어느 보기에도 닿지 않으면 값을 만들지 않고 다시 묻는다.
 */
export function parseOperatingDayDropReason(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = informationDefinition("operating_day_drop_reason");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: true });
  if (boundary) return boundary;

  const reason =
    OPERATING_DAY_DROP_REASON_PATTERNS.find(([, pattern]) => pattern.test(span.text))?.[0] ?? null;
  if (!reason) {
    return ambiguousCandidate(
      definition,
      span,
      ["reason"],
      "영업일이 줄어든 사유를 보기 중 하나로 확인하지 못해 값을 만들지 않았습니다.",
    );
  }

  const resolved = OPERATING_DAY_DROP_UNRESOLVED_PATTERN.test(span.text)
    ? false
    : OPERATING_DAY_DROP_RESOLVED_PATTERN.test(span.text)
      ? true
      : null;

  return presentCandidate(
    definition,
    span,
    {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "BUSINESS_SIGNAL",
      signal: "OPERATING_DAY_DROP",
      observed: true,
      reason,
      resolved,
      origin: "BORROWER_DIRECT",
    },
    "LOW",
    resolved === null ? ["resolution"] : [],
    "사유 보기와 해소 여부만 구조화했고 말투는 사용하지 않았습니다.",
  );
}

export function parseRepeatCustomerShare(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = informationDefinition("repeat_customer_share");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: false });
  if (boundary) return boundary;
  const explicit = span.text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:%|퍼센트)/);
  const explicitValue = explicit ? Number(explicit[1]) : null;
  const percentage =
    explicitValue !== null && Number.isFinite(explicitValue) && explicitValue >= 0 && explicitValue <= 100
      ? exact(explicitValue)
      : /(?:절반|반\s*(?:정도|쯤|가량))/i.test(span.text)
        ? range(
            DEV_V1_SEMANTIC_HALF_PERCENTAGE_RANGE.min,
            DEV_V1_SEMANTIC_HALF_PERCENTAGE_RANGE.max,
          )
        : null;
  if (!percentage) {
    return ambiguousCandidate(definition, span, ["percentage"], "반복고객 매출 비중을 찾지 못했습니다.");
  }
  const semanticRange = percentage.kind === "RANGE";
  return presentCandidate(
    definition,
    span,
    {
      schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
      kind: "PERCENTAGE",
      percentage,
      basis: "REPEAT_CUSTOMER_SALES_SHARE",
      referenceWindow: {
        unit: "MONTH",
        count: 1,
        relation: "TRAILING",
        source:
          context.currentInfoCode === "repeat_customer_share"
            ? "QUESTION_CONTEXT"
            : "SYSTEM",
      },
      approximation: semanticRange ? "SEMANTIC_RANGE" : "EXPLICIT_NUMBER",
    },
    semanticRange ? "LOW" : "MEDIUM",
    semanticRange ? ["exactPercentage"] : [],
    semanticRange
      ? "'절반 정도'를 dev-v1 의미 구간으로 보존하고 정확한 비율을 후속 확인합니다."
      : "차주가 명시한 숫자 비율을 최근 한 달 반복고객 매출 비중으로 보존했습니다.",
  );
}

function resourcesFromSpan(span: TextEvidenceSpan): ExecutionReadinessValue["resources"] {
  const definitions: Array<[ReadinessResourceType, RegExp]> = [
    ["PEOPLE", /(인력|직원|담당자)/i],
    ["BUDGET", /(예산|자금)/i],
    ["SCHEDULE", /(일정|시작일|이번\s*달|다음\s*달)/i],
    ["DOCUMENT", /(견적서|계약서|자료|문서)/i],
    ["EQUIPMENT", /(장비|설비)/i],
  ];
  return definitions.flatMap(([type, pattern]) =>
    pattern.test(span.text)
      ? [{ type, detail: span.text, evidenceSpan: span }]
      : [],
  );
}

/**
 * 실행 준비 진술에 예산 금액이 함께 있을 때만 뽑는다. 금액이 여럿이거나 없으면
 * 어느 쪽도 예산으로 정하지 않는다.
 */
function planBudgetAmount(text: string): NumericMeasure | null {
  if (!/(예산|자금)/i.test(text)) return null;
  return parseKoreanMoneyMeasure(text);
}

export function parseExecutionReadiness(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = moneyDefinition("execution_readiness");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: true });
  if (boundary) return boundary;
  const notStarted = /(아직|전혀).{0,8}(준비|시작).{0,6}(못|안)|준비.{0,6}(없|못|안\s*됐)/i.test(span.text);
  const resources = notStarted ? [] : resourcesFromSpan(span);
  const ready = /(준비.{0,5}(완료|됐|되어)|바로\s*시작|확보했)/i.test(span.text);
  const budgetAmount = notStarted ? null : planBudgetAmount(span.text);
  const value: ExecutionReadinessValue = {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "EXECUTION_READINESS",
    state: notStarted ? "NOT_STARTED" : ready ? "READY" : "PARTIAL",
    resources,
    budget: budgetAmount
      ? {
          schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
          kind: "PERIODIC_MONEY",
          amount: budgetAmount,
          currency: "KRW",
          cadence: "MONTH",
          aggregation: "TOTAL",
          basis: "IMPROVEMENT_PLAN_BUDGET",
          referenceWindow: { unit: "MONTH", count: 1, relation: "FORWARD", source: "QUESTION_CONTEXT" },
        }
      : null,
    schedule: null,
    blockers: /(부족|어렵|장애|문제)/i.test(span.text) ? [span.text] : [],
    pastExamples: /(전에|과거|지난번).{0,20}(했|실행|개선)/i.test(span.text) ? [span.text] : [],
    evidenceReady: /(견적서|계약서|자료|문서).{0,5}(있|준비)/i.test(span.text)
      ? true
      : /(자료|문서).{0,5}(없)/i.test(span.text)
        ? false
        : null,
  };
  const missingFields = !notStarted && !ready && resources.length === 0 ? ["preparedResourcesOrNotStarted"] : [];
  return presentCandidate(definition, span, value, "LOW", missingFields, "말투나 감정이 아니라 명시된 자원·일정·장애물만 구조화했습니다.");
}

function parseCountMeasure(text: string): NumericMeasure | null {
  const normalized = normalize(text);
  const token = "([0-9]+|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)";
  const rangePattern = new RegExp(`${token}\\s*(?:건|개)?\\s*(?:~|에서|부터|[-–—])\\s*${token}\\s*(?:건|개)`);
  const rangeMatch = normalized.match(rangePattern);
  if (rangeMatch) {
    const left = parseNumericToken(rangeMatch[1]);
    const right = parseNumericToken(rangeMatch[2]);
    if (left !== null && right !== null) return range(Math.min(left, right), Math.max(left, right));
  }
  const exactMatch = normalized.match(new RegExp(`${token}\\s*(?:건|개)`));
  if (!exactMatch) return null;
  const value = parseNumericToken(exactMatch[1]);
  return value === null || !Number.isSafeInteger(value) || value < 0 ? null : exact(value);
}

export function parseConfirmedReservations(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = moneyDefinition("confirmed_reservations");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: false });
  if (boundary) return boundary;
  let count = parseCountMeasure(span.text);
  if (!count && /(예약|주문|수주).{0,8}(없|0\s*건)/i.test(span.text)) count = exact(0);
  if (!count) {
    return ambiguousCandidate(definition, span, ["confirmedCount"], "확정 건수를 찾지 못했습니다.");
  }
  const totalMatch = span.text.match(/(?:총액|주문금액|예약금액)[^0-9]{0,8}([0-9][^,.;]*)/);
  const totalOrderValue = totalMatch ? parseKoreanMoneyMeasure(totalMatch[1]) : null;
  const value: ConfirmedReservationsValue = {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "CONFIRMED_RESERVATIONS",
    count,
    unit: "CASE",
    horizon: {
      unit: "WEEK",
      count: 4,
      relation: "FORWARD",
      source: "QUESTION_CONTEXT",
    },
    totalOrderValue,
    scheduledDates: [],
    confirmationBasis: "BORROWER_CONFIRMED",
  };
  return presentCandidate(
    definition,
    span,
    value,
    count.kind === "EXACT" ? "MEDIUM" : "LOW",
    count.kind === "RANGE" ? ["exactCount"] : [],
    "확정 예약의 건수와 4주 horizon을 보존했으며 건수를 주문금액으로 바꾸지 않았습니다.",
  );
}

function parsePercentMeasure(text: string): NumericMeasure | null {
  const normalized = normalize(text);
  const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:~|에서|[-–—])\s*([0-9]+(?:\.[0-9]+)?)\s*(?:%|퍼센트)/);
  if (match) return range(Math.min(Number(match[1]), Number(match[2])), Math.max(Number(match[1]), Number(match[2])));
  const exactMatch = normalized.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:%|퍼센트)/);
  return exactMatch ? exact(Number(exactMatch[1])) : null;
}

export function parseSeasonalityOutlook(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = moneyDefinition("seasonality_outlook");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: true });
  if (boundary) return boundary;
  const direction: SeasonalityOutlookValue["direction"] = /(증가|늘|좋아|상승|많아)/i.test(span.text)
    ? "UP"
    : /(감소|줄|나빠|하락|적어)/i.test(span.text)
      ? "DOWN"
      : /(비슷|같|보합|평년)/i.test(span.text)
        ? "FLAT"
        : "UNKNOWN";
  const basisPatterns: Array<[SeasonalityBasisKind, RegExp]> = [
    ["HISTORICAL", /(작년|과거|지난\s*해|평년)/i],
    ["RESERVATION", /(예약|주문)/i],
    ["CONTRACT", /(계약|수주)/i],
    ["LOCAL_EVENT", /(지역행사|축제|명절|신학기|휴가|연말|장마|혹서|혹한)/i],
  ];
  const bases = basisPatterns.flatMap(([kind, pattern]) =>
    pattern.test(span.text) ? [{ kind, detail: span.text, evidenceSpan: span }] : [],
  );
  if (bases.length === 0 && direction !== "UNKNOWN") {
    bases.push({ kind: "BORROWER_EXPECTATION", detail: span.text, evidenceSpan: span });
  }
  const value: SeasonalityOutlookValue = {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "SEASONALITY_OUTLOOK",
    direction,
    horizonMonths: 3,
    expectedChangePct: parsePercentMeasure(span.text),
    bases,
    drivers: bases.filter((basis) => basis.kind === "LOCAL_EVENT").map((basis) => basis.detail),
  };
  const evidenceBasis = bases.some((basis) => basis.kind !== "BORROWER_EXPECTATION");
  const missingFields = [
    ...(direction === "UNKNOWN" ? ["direction"] : []),
    ...(direction !== "FLAT" && !evidenceBasis ? ["evidenceBasis"] : []),
  ];
  return presentCandidate(
    definition,
    span,
    value,
    evidenceBasis || direction === "FLAT" ? "LOW" : "LOW",
    missingFields,
    evidenceBasis
      ? "방향과 차주가 말한 수요 근거를 분리해 보존했습니다."
      : "낙관적 전망 단독 발언을 점수 근거로 사용하지 않고 추가 근거를 요청합니다.",
  );
}

function parseDurationMeasure(text: string): NumericMeasure | null {
  const normalized = normalize(text);
  const token = "([0-9]+(?:\\.[0-9]+)?|한|하나|두|둘|세|셋|네|넷|다섯|여섯|일곱|여덟|아홉|열)";
  const rangePattern = new RegExp(`${token}\\s*(?:개월|달)?\\s*(?:~|에서|부터|[-–—])\\s*${token}\\s*(?:개월|달)`);
  const match = normalized.match(rangePattern);
  if (match) {
    const left = parseNumericToken(match[1]);
    const right = parseNumericToken(match[2]);
    if (left !== null && right !== null) return range(Math.min(left, right), Math.max(left, right));
  }
  const exactMatch = normalized.match(new RegExp(`${token}\\s*(?:개월|달)`));
  if (!exactMatch) return null;
  const value = parseNumericToken(exactMatch[1]);
  return value === null || value < 0 ? null : exact(value);
}

export function parseEmergencyBufferMonths(
  text: string,
  context: InformationParserContext,
): CanonicalExtractionCandidate | null {
  const definition = moneyDefinition("emergency_buffer_months");
  const span = findClause(text, definition, context);
  if (!span) return null;
  const boundary = boundaryCandidate(definition, span, { notApplicableAllowed: false });
  if (boundary) return boundary;
  let duration = parseDurationMeasure(span.text);
  if (!duration && /(비상금|비상자금).{0,8}(없|0\s*개월)/i.test(span.text)) duration = exact(0);
  if (!duration) return ambiguousCandidate(definition, span, ["durationMonths"], "개월 단위 기간을 찾지 못했습니다.");
  const value: DurationValue = {
    schemaVersion: CANONICAL_VALUE_SCHEMA_VERSION,
    kind: "DURATION",
    duration,
    unit: "MONTH",
    basis: "ESSENTIAL_EXPENSE_COVERAGE",
    derivedFrom: null,
  };
  return presentCandidate(
    definition,
    span,
    value,
    "LOW",
    [],
    duration.kind === "RANGE"
      ? "비상자금 보유기간 범위를 중간값 없이 보존했습니다."
      : "비상자금으로 감당 가능한 개월 수를 보존했습니다.",
  );
}

export const DEV_V1_INFORMATION_PARSERS: Readonly<
  Record<DevV1AllInfoCode, CanonicalInformationParser>
> = {
  monthly_average_sales: (text, context) => parseMoneyInformation("monthly_average_sales", text, context),
  fixed_operating_costs: (text, context) => parseMoneyInformation("fixed_operating_costs", text, context),
  improvement_plan: parseImprovementPlan,
  execution_readiness: parseExecutionReadiness,
  confirmed_reservations: parseConfirmedReservations,
  seasonality_outlook: parseSeasonalityOutlook,
  essential_household_expenses: (text, context) => parseMoneyInformation("essential_household_expenses", text, context),
  emergency_buffer_months: parseEmergencyBufferMonths,
  platform_fee_pressure: parsePlatformFeePressure,
  hall_customer_decline: parseHallCustomerDecline,
  repeat_customer_share: parseRepeatCustomerShare,
  operating_day_drop_reason: parseOperatingDayDropReason,
};

export function parseCanonicalInformation(
  infoCode: DevV1AllInfoCode,
  text: string,
  context: InformationParserContext = { currentInfoCode: infoCode },
): CanonicalExtractionCandidate | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidate = DEV_V1_INFORMATION_PARSERS[infoCode](trimmed, context);
  if (!candidate) return null;
  return {
    ...candidate,
    evidenceSpan: alignEvidenceSpan(trimmed, candidate.evidenceSpan),
  };
}

export function containsStrongAnchor(infoCode: DevV1AllInfoCode, text: string): boolean {
  return findAnchorMatches(text, OFF_TURN_STRONG_ANCHORS[infoCode]).some(
    (match) => !isSuppressedOffTurnAnchor(infoCode, text, match),
  );
}

export function describeMissingFields(candidate: CanonicalExtractionCandidate): string {
  return candidate.missingFields.map((field) => escapeRegExp(field)).join(", ");
}
