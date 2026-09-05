import { apiFailure, apiSuccess, requestIdFor } from "@/server/api-response";
import { ApplicationError } from "@/server/errors";
import { getAuthService, getInterviewService } from "@/server/service-instance";
import type { EvaluationListQuery } from "@/server/interview-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEVELS = new Set(["A", "B", "C", "D", "E", "UNGRADED"]);

function optionalText(
  parameters: URLSearchParams,
  key: string,
  maxLength: number,
): string | null {
  const value = parameters.get(key)?.trim() ?? "";
  if (!value) return null;
  if (value.length > maxLength) {
    throw new ApplicationError(
      400,
      "INVALID_EVALUATION_FILTER",
      `${key} 검색 조건이 너무 깁니다.`,
      { field: key, maxLength },
    );
  }
  return value;
}

function optionalDate(parameters: URLSearchParams, key: "from" | "to"): string | null {
  const value = optionalText(parameters, key, 10);
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApplicationError(
      400,
      "INVALID_EVALUATION_FILTER",
      `${key}는 YYYY-MM-DD 형식이어야 합니다.`,
      { field: key },
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApplicationError(
      400,
      "INVALID_EVALUATION_FILTER",
      `${key} 날짜가 올바르지 않습니다.`,
      { field: key },
    );
  }
  return value;
}

function evaluationListQuery(request: Request): EvaluationListQuery {
  const parameters = new URL(request.url).searchParams;
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = parameters.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new ApplicationError(400, "INVALID_EVALUATION_FILTER", `${key} 목록 범위가 올바르지 않습니다.`);
    }
    return value;
  };
  const level = optionalText(parameters, "level", 16);
  if (level && !LEVELS.has(level)) {
    throw new ApplicationError(
      400,
      "INVALID_EVALUATION_FILTER",
      "level 검색 조건이 올바르지 않습니다.",
      { field: "level" },
    );
  }
  const from = optionalDate(parameters, "from");
  const to = optionalDate(parameters, "to");
  if (from && to && from > to) {
    throw new ApplicationError(
      400,
      "INVALID_EVALUATION_FILTER",
      "조회 시작일은 종료일보다 늦을 수 없습니다.",
      { field: "from" },
    );
  }
  return {
    q: optionalText(parameters, "q", 100),
    industry: optionalText(parameters, "industry", 100),
    level: level as EvaluationListQuery["level"],
    from,
    to,
    limit: integer("limit", 24, 1, 100),
    offset: integer("offset", 0, 0, 100_000),
  };
}

export async function GET(request: Request) {
  const requestId = requestIdFor(request);
  try {
    const principal = getAuthService().authenticate(request);
    return apiSuccess(
      getInterviewService().listEvaluationSummaries(
        principal,
        evaluationListQuery(request),
      ),
      200,
      { requestId },
    );
  } catch (error) {
    return apiFailure(error, { requestId });
  }
}
