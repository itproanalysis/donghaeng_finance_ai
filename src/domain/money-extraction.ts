import type { InformationStatus, MoneyValue, ValueState } from "./interview";

export type MonthlySalesExtraction =
  | {
      kind: "PRESENT";
      valueState: "PRESENT";
      targetStatus: "COLLECTED";
      value: MoneyValue;
      confidence: number;
      normalizedText: string;
    }
  | {
      kind: "AMBIGUOUS" | "UNAVAILABLE" | "REFUSED" | "NOT_APPLICABLE";
      valueState: Exclude<ValueState, "PRESENT" | "MISSING">;
      targetStatus: Extract<
        InformationStatus,
        "NEEDS_FOLLOWUP" | "UNAVAILABLE" | "REFUSED" | "NOT_APPLICABLE"
      >;
      value: null;
      confidence: number;
      normalizedText: string;
      followupQuestion: string | null;
    };

const REFUSAL_PATTERN =
  /(답변|말씀|공개|공유).{0,6}(거부|싫|어렵)|말하고\s*싶지|알려\s*드리기\s*싫/i;
const NOT_APPLICABLE_PATTERN = /해당\s*(사항이?)?\s*없/i;
const NO_SALES_PATTERN = /매출이?\s*발생하지\s*않/i;
const UNAVAILABLE_PATTERN =
  /(잘\s*모르|모르겠|기억이?\s*안\s*나|확인하기\s*어렵|파악이?\s*안\s*되)/i;
const VARIABLE_PATTERN =
  /(월마다\s*(많이\s*)?(다르|달라)|들쭉날쭉|일정하지\s*않|편차가\s*(크|커))/i;

const AMOUNT_PATTERN =
  /(?:월(?:평균)?\s*)?([0-9]+(?:\.[0-9]+)?)\s*(억|천만|백만|십만|만|천|백)?\s*원/i;
const AMOUNT_PATTERN_GLOBAL = new RegExp(AMOUNT_PATTERN.source, "gi");
const COMPOUND_EOK_PATTERN =
  /([0-9]+(?:\.[0-9]+)?)\s*억\s*(?:([0-9]+(?:\.[0-9]+)?)\s*(천만|만|천))?\s*원/i;
const COMPOUND_CHEON_PATTERN =
  /([0-9]+)\s*천\s*(?:([0-9]+)\s*백)?\s*만?\s*원/i;
const NEGATIVE_AMOUNT_PATTERN =
  /(?:-|−|마이너스|적자)\s*(?:월(?:평균)?\s*)?[0-9]+(?:\.[0-9]+)?\s*(?:억|천만|백만|십만|만|천|백)?\s*원/i;
const RANGE_AMOUNT_PATTERN =
  /[0-9]+(?:\.[0-9]+)?\s*(?:억|천만|백만|십만|만|천|백)?\s*원\s*(?:~|〜|에서|부터|[-–—])\s*[0-9]+/i;

const UNIT_MULTIPLIERS: Record<string, number> = {
  억: 100_000_000,
  천만: 10_000_000,
  백만: 1_000_000,
  십만: 100_000,
  만: 10_000,
  천: 1_000,
  백: 100,
};

function normalizeKoreanAmountText(text: string): string {
  return text.normalize("NFKC").replace(/,/g, "").trim();
}

function ambiguousAmount(normalizedText: string, followupQuestion: string): MonthlySalesExtraction {
  return {
    kind: "AMBIGUOUS",
    valueState: "UNKNOWN",
    targetStatus: "NEEDS_FOLLOWUP",
    value: null,
    confidence: 0.98,
    normalizedText,
    followupQuestion,
  };
}

function presentAmount(normalizedText: string, amount: number): MonthlySalesExtraction {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    return ambiguousAmount(normalizedText, "매출 금액을 0 이상의 원 단위 숫자로 다시 알려주세요.");
  }
  return {
    kind: "PRESENT",
    valueState: "PRESENT",
    targetStatus: "COLLECTED",
    value: { amount, currency: "KRW", period: "MONTH" },
    confidence: 0.99,
    normalizedText,
  };
}

export function parseMonthlyAverageSales(text: string): MonthlySalesExtraction {
  const normalizedText = normalizeKoreanAmountText(text);

  // 불확실성을 나타내는 문장이 숫자를 함께 포함해도 임의의 확정값으로 만들지 않는다.
  if (REFUSAL_PATTERN.test(normalizedText)) {
    return {
      kind: "REFUSED",
      valueState: "REFUSED",
      targetStatus: "REFUSED",
      value: null,
      confidence: 0.99,
      normalizedText,
      followupQuestion: null,
    };
  }

  if (NOT_APPLICABLE_PATTERN.test(normalizedText)) {
    return {
      kind: "NOT_APPLICABLE",
      valueState: "NOT_APPLICABLE",
      targetStatus: "NOT_APPLICABLE",
      value: null,
      confidence: 0.95,
      normalizedText,
      followupQuestion: null,
    };
  }

  if (UNAVAILABLE_PATTERN.test(normalizedText)) {
    return {
      kind: "UNAVAILABLE",
      valueState: "UNKNOWN",
      targetStatus: "UNAVAILABLE",
      value: null,
      confidence: 0.98,
      normalizedText,
      followupQuestion: null,
    };
  }

  if (VARIABLE_PATTERN.test(normalizedText)) {
    return ambiguousAmount(
      normalizedText,
      "월별 차이가 있다면 최근 3개월을 기준으로 가장 낮은 달과 높은 달의 매출 범위를 알려주세요.",
    );
  }

  if (NEGATIVE_AMOUNT_PATTERN.test(normalizedText)) {
    return ambiguousAmount(
      normalizedText,
      "매출액과 손익은 구분해서, 월 매출액만 0 이상의 금액으로 다시 알려주세요.",
    );
  }

  if (RANGE_AMOUNT_PATTERN.test(normalizedText)) {
    return ambiguousAmount(
      normalizedText,
      "범위의 중간값을 임의로 만들지 않도록 최근 3개월 합계와 기간을 알려주세요.",
    );
  }

  const compoundMatch = normalizedText.match(COMPOUND_EOK_PATTERN);
  if (compoundMatch) {
    const eokAmount = Number(compoundMatch[1]) * 100_000_000;
    const subVal = Number(compoundMatch[2] ?? 0);
    const subUnit = compoundMatch[3];
    const subMultiplier = subUnit === "천만" || subUnit === "천" ? 10_000_000 : 10_000;
    const amount = eokAmount + subVal * subMultiplier;
    return presentAmount(normalizedText, amount);
  }

  const cheonMatch = normalizedText.match(COMPOUND_CHEON_PATTERN);
  if (cheonMatch) {
    const cheonVal = Number(cheonMatch[1]);
    const baekVal = Number(cheonMatch[2] ?? 0);
    const amount = (cheonVal * 1000 + baekVal * 100) * 10_000;
    return presentAmount(normalizedText, amount);
  }

  const amountMatches = Array.from(normalizedText.matchAll(AMOUNT_PATTERN_GLOBAL));
  if (amountMatches.length > 1) {
    return ambiguousAmount(
      normalizedText,
      "여러 금액 중 월평균 총매출이 무엇인지 하나의 금액으로 다시 알려주세요.",
    );
  }

  const match = amountMatches[0] ?? null;
  if (!match) {
    if (NO_SALES_PATTERN.test(normalizedText)) {
      return {
        kind: "NOT_APPLICABLE",
        valueState: "NOT_APPLICABLE",
        targetStatus: "NOT_APPLICABLE",
        value: null,
        confidence: 0.95,
        normalizedText,
        followupQuestion: null,
      };
    }
    return {
      kind: "AMBIGUOUS",
      valueState: "UNKNOWN",
      targetStatus: "NEEDS_FOLLOWUP",
      value: null,
      confidence: 0.9,
      normalizedText,
      followupQuestion: "최근 3개월 기준 월평균 매출을 원 단위 또는 범위로 알려주세요.",
    };
  }

  const numeric = Number(match[1]);
  const multiplier = match[2] ? UNIT_MULTIPLIERS[match[2]] : 1;
  const amount = numeric * multiplier;
  return presentAmount(normalizedText, amount);
}

export function hasMaterialAmountConflict(prefillAmount: number, reportedAmount: number): boolean {
  const absoluteDifference = Math.abs(prefillAmount - reportedAmount);
  if (absoluteDifference === 0) return false;
  const materialThreshold = Math.max(1_000_000, Math.abs(prefillAmount) * 0.25);
  return absoluteDifference >= materialThreshold;
}
