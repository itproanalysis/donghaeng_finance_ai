import type { ImprovementPlanValue } from "./information-values";

export const RUBRIC_FEATURE_NAMES = [
  "problem_specificity",
  "plan_specificity",
] as const;

export type RubricFeatureName = (typeof RUBRIC_FEATURE_NAMES)[number];

/**
 * A classifier receives only the canonical plan and the evidence lineage it may
 * cite. An external model adapter can implement this port later; the dev runtime
 * intentionally uses the deterministic adapter below.
 */
export interface RubricClassifierInput {
  rubric: RubricFeatureName;
  plan: Readonly<ImprovementPlanValue>;
  allowedEvidenceIds: readonly string[];
}

/** The complete and exclusive structured output contract of a rubric classifier. */
export interface RubricClassifierOutput {
  level: number;
  reason: string;
  evidenceIds: string[];
}

/**
 * Classifier output is untrusted at this boundary. Returning unknown forces every
 * adapter, including a future LLM adapter, through the runtime validator.
 */
export interface RubricClassifierPort {
  classify(input: RubricClassifierInput): unknown;
}

export type RubricClassifierValidationIssueCode =
  | "OUTPUT_NOT_OBJECT"
  | "UNEXPECTED_OUTPUT_KEYS"
  | "INVALID_LEVEL"
  | "EMPTY_REASON"
  | "INVALID_EVIDENCE_IDS"
  | "INVALID_EVIDENCE_ID"
  | "DUPLICATE_EVIDENCE_ID"
  | "UNKNOWN_EVIDENCE_ID";

export interface RubricClassifierValidationIssue {
  code: RubricClassifierValidationIssueCode;
  path: string;
  message: string;
}

const OUTPUT_KEYS = new Set<PropertyKey>(["level", "reason", "evidenceIds"]);

function asRecord(value: unknown): Record<PropertyKey, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<PropertyKey, unknown>)
    : null;
}

export function validateRubricClassifierOutput(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string> | readonly string[],
): RubricClassifierValidationIssue[] {
  const output = asRecord(value);
  if (!output) {
    return [
      {
        code: "OUTPUT_NOT_OBJECT",
        path: "$",
        message: "rubric classifier output은 객체여야 합니다.",
      },
    ];
  }

  const issues: RubricClassifierValidationIssue[] = [];
  const ownKeys = Reflect.ownKeys(output);
  if (
    ownKeys.length !== OUTPUT_KEYS.size ||
    ownKeys.some((key) => !OUTPUT_KEYS.has(key))
  ) {
    issues.push({
      code: "UNEXPECTED_OUTPUT_KEYS",
      path: "$",
      message: "rubric classifier output은 level, reason, evidenceIds만 포함해야 합니다.",
    });
  }

  if (
    typeof output.level !== "number" ||
    !Number.isInteger(output.level) ||
    output.level < 0 ||
    output.level > 5
  ) {
    issues.push({
      code: "INVALID_LEVEL",
      path: "$.level",
      message: "level은 0 이상 5 이하의 정수여야 합니다.",
    });
  }

  if (typeof output.reason !== "string" || output.reason.trim().length === 0) {
    issues.push({
      code: "EMPTY_REASON",
      path: "$.reason",
      message: "reason은 공백이 아닌 문자열이어야 합니다.",
    });
  }

  if (!Array.isArray(output.evidenceIds)) {
    issues.push({
      code: "INVALID_EVIDENCE_IDS",
      path: "$.evidenceIds",
      message: "evidenceIds는 문자열 배열이어야 합니다.",
    });
    return issues;
  }

  const allowed =
    allowedEvidenceIds instanceof Set
      ? allowedEvidenceIds
      : new Set(allowedEvidenceIds);
  const seen = new Set<string>();
  output.evidenceIds.forEach((evidenceId, index) => {
    if (typeof evidenceId !== "string" || evidenceId.trim().length === 0) {
      issues.push({
        code: "INVALID_EVIDENCE_ID",
        path: `$.evidenceIds[${index}]`,
        message: "evidence ID는 공백이 아닌 문자열이어야 합니다.",
      });
      return;
    }
    if (seen.has(evidenceId)) {
      issues.push({
        code: "DUPLICATE_EVIDENCE_ID",
        path: `$.evidenceIds[${index}]`,
        message: `중복 evidence ID입니다: ${evidenceId}`,
      });
      return;
    }
    seen.add(evidenceId);
    if (!allowed.has(evidenceId)) {
      issues.push({
        code: "UNKNOWN_EVIDENCE_ID",
        path: `$.evidenceIds[${index}]`,
        message: `허용된 원천 lineage에 없는 evidence ID입니다: ${evidenceId}`,
      });
    }
  });

  return issues;
}

export class RubricClassifierOutputValidationError extends TypeError {
  constructor(readonly issues: readonly RubricClassifierValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "RubricClassifierOutputValidationError";
  }
}

export function parseRubricClassifierOutput(
  value: unknown,
  allowedEvidenceIds: ReadonlySet<string> | readonly string[],
): RubricClassifierOutput {
  const issues = validateRubricClassifierOutput(value, allowedEvidenceIds);
  if (issues.length > 0) {
    throw new RubricClassifierOutputValidationError(issues);
  }
  const output = value as RubricClassifierOutput;
  return {
    level: output.level,
    reason: output.reason,
    evidenceIds: [...output.evidenceIds],
  };
}

function uniqueEvidenceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function planSpecificityLevel(plan: Readonly<ImprovementPlanValue>): number {
  if (!plan.planExists) return 0;
  if (plan.actions.length === 0) return 1;
  let level = 2;
  if (plan.problem) level = 3;
  if (plan.schedule || plan.target || plan.measurementSources.length > 0) level = 4;
  if (plan.schedule && plan.target && plan.measurementSources.length > 0) level = 5;
  return level;
}

function problemSpecificityLevel(plan: Readonly<ImprovementPlanValue>): number {
  if (!plan.problem) return 0;
  const length = plan.problem.replace(/\s/g, "").length;
  if (length >= 30) return 5;
  if (length >= 20) return 4;
  if (length >= 12) return 3;
  if (length >= 6) return 2;
  return 1;
}

/**
 * Local dev adapter: no network/model call, no ambient state, and identical input
 * yields identical output. It deliberately cannot provide a normalized score.
 */
export const DETERMINISTIC_DEV_RUBRIC_CLASSIFIER: RubricClassifierPort = {
  classify(input): RubricClassifierOutput {
    const evidenceIds = uniqueEvidenceIds(input.allowedEvidenceIds);
    if (input.rubric === "plan_specificity") {
      const level = planSpecificityLevel(input.plan);
      return {
        level,
        reason:
          "계획 존재, 행동, 문제, 기간, 목표 수치, 측정 출처의 존재만 사용하는 dev-v1 결정론적 rubric입니다.",
        evidenceIds,
      };
    }

    const level = problemSpecificityLevel(input.plan);
    return {
      level,
      reason: input.plan.problem
        ? `공백을 제외한 차주 문제 설명 ${input.plan.problem.replace(/\s/g, "").length}자의 dev-v1 결정론적 기준입니다.`
        : "차주가 진술한 문제 설명이 없어 0단계입니다.",
      evidenceIds,
    };
  },
};
