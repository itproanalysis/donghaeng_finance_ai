import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  findSohoIndustryProfile,
  IMPROVEMENT_CANDIDATE_ORIGINS,
  validateRequiredInformationCatalog,
  type BorrowerImprovementChoice,
  type RequiredInformationItem,
  type SohoIndustryCode,
} from "@/domain";

import { ApplicationError } from "./errors";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  requestId: string;
}

export type ApiEnvelope<T> =
  | { data: T; error: null; meta: ApiMeta }
  | { data: null; error: ApiErrorBody; meta: ApiMeta };

export interface ApiResponseOptions {
  requestId?: string;
  headers?: HeadersInit;
}

export interface MessageCommandInput {
  text: string;
  clientMessageId: string;
  expectedVersion: number;
  currentQuestionInfoCode: string | null;
  transcriptMetadata?: {
    startMs: number | null;
    endMs: number | null;
    sttConfidence: number | null;
    sttProvider: string | null;
  } | null;
}

export interface CompleteCommandInput {
  clientCommandId: string;
  expectedVersion: number;
  mode: "COMPLETE" | "FORCE_INCOMPLETE";
  borrowerConfirmed: boolean;
  reason: string | null;
  improvementChoice: BorrowerImprovementChoice | null;
}

export interface CreateInterviewCommandInput {
  requiredInformationList: RequiredInformationItem[] | null;
  industryCode?: SohoIndustryCode;
  profile?: {
    borrowerName: string;
    businessName: string;
  };
}

const REQUIRED_INFORMATION_KEYS = new Set([
  "infoCode",
  "label",
  "category",
  "priority",
  "expectedType",
  "required",
  "minQuality",
  "evidencePreference",
  "dependencies",
  "status",
  "question",
  "followupQuestion",
]);

const REQUIRED_INFORMATION_ENUMS = {
  category: new Set(["CURRENT_STATE", "IMPROVEMENT_INTENT", "FUTURE_OUTLOOK", "HOUSEHOLD_STATE"]),
  priority: new Set(["P0", "P1", "P2"]),
  expectedType: new Set(["AMOUNT", "RATIO", "INTEGER", "TEXT", "BOOLEAN", "DATE", "DURATION", "RANGE"]),
  minQuality: new Set(["LOW", "MEDIUM", "HIGH"]),
  status: new Set(["NEEDED", "ASKING", "COLLECTED", "CONFIRMED", "NEEDS_FOLLOWUP", "CONFLICT", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"]),
  evidence: new Set(["SELF_REPORTED", "DOCUMENT_SUPPORTED", "TRANSACTION_SUPPORTED", "SYSTEM_DERIVED", "CONFLICTING", "UNKNOWN"]),
};

function responseHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("Vary", "Cookie, Authorization");
  return headers;
}

export function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied) ? supplied : randomUUID();
}

export function apiSuccess<T>(
  data: T,
  status = 200,
  options: ApiResponseOptions = {},
): NextResponse<ApiEnvelope<T>> {
  const requestId = options.requestId ?? randomUUID();
  const headers = responseHeaders(options.headers);
  headers.set("X-Request-ID", requestId);
  return NextResponse.json(
    { data, error: null, meta: { requestId } },
    { status, headers },
  );
}

export function apiFailure(
  error: unknown,
  options: ApiResponseOptions = {},
): NextResponse<ApiEnvelope<never>> {
  const requestId = options.requestId ?? randomUUID();
  const headers = responseHeaders(options.headers);
  headers.set("X-Request-ID", requestId);

  if (error instanceof ApplicationError) {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        meta: { requestId },
      },
      { status: error.status, headers },
    );
  }

  if (error instanceof Error && error.name === "InvalidInformationTransitionError") {
    return NextResponse.json(
      {
        data: null,
        error: {
          code: "INVALID_STATE_TRANSITION",
          message: "현재 인터뷰 상태에서는 요청한 전이를 적용할 수 없습니다.",
        },
        meta: { requestId },
      },
      { status: 409, headers },
    );
  }

  console.error("Unhandled interview API error", {
    requestId,
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "요청을 처리하는 중 서버 오류가 발생했습니다.",
      },
      meta: { requestId },
    },
    { status: 500, headers },
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type");
  if (contentType && !contentType.toLocaleLowerCase("en-US").includes("application/json")) {
    throw new ApplicationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApplicationError(400, "INVALID_JSON", "유효한 JSON 본문이 필요합니다.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApplicationError(400, "INVALID_REQUEST", "요청 본문은 객체여야 합니다.");
  }
  return body as Record<string, unknown>;
}

function invalidRequiredInformation(
  message: string,
  details: Record<string, unknown>,
): never {
  throw new ApplicationError(
    422,
    "INVALID_REQUIRED_INFORMATION_LIST",
    message,
    details,
  );
}

export async function readCreateInterviewCommand(
  request: Request,
): Promise<CreateInterviewCommandInput> {
  const contentType = request.headers.get("content-type");
  if (
    contentType &&
    !contentType.toLocaleLowerCase("en-US").includes("application/json")
  ) {
    throw new ApplicationError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type은 application/json이어야 합니다.",
    );
  }
  const rawBody = request.body === null ? "" : await request.text();
  if (!rawBody.trim()) {
    return { requiredInformationList: null };
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new ApplicationError(400, "INVALID_JSON", "유효한 JSON 본문이 필요합니다.");
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    throw new ApplicationError(400, "INVALID_REQUEST", "요청 본문은 객체여야 합니다.");
  }
  const body = parsedBody as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter(
    (key) => !["requiredInformationList", "industryCode", "profile"].includes(key),
  );
  if (unknownKeys.length > 0) {
    invalidRequiredInformation("인터뷰 생성 요청에 허용되지 않은 필드가 있습니다.", {
      fields: unknownKeys,
    });
  }
  let industryCode: SohoIndustryCode | undefined;
  if (body.industryCode !== undefined) {
    if (typeof body.industryCode !== "string") {
      invalidRequiredInformation("industryCode는 지원 업종 코드 문자열이어야 합니다.", {
        field: "industryCode",
      });
    }
    const profile = findSohoIndustryProfile(body.industryCode as string);
    if (!profile) {
      invalidRequiredInformation("지원하지 않는 industryCode입니다.", {
        field: "industryCode",
        value: body.industryCode,
      });
    }
    industryCode = profile.code;
  }
  let creationProfile: CreateInterviewCommandInput["profile"];
  if (body.profile !== undefined) {
    if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
      invalidRequiredInformation("profile은 사장님과 사업체 정보를 담은 객체여야 합니다.", {
        field: "profile",
      });
    }
    const profile = body.profile as Record<string, unknown>;
    const profileUnknownKeys = Object.keys(profile).filter(
      (key) => !["borrowerName", "businessName"].includes(key),
    );
    if (profileUnknownKeys.length > 0) {
      invalidRequiredInformation("profile에 허용되지 않은 필드가 있습니다.", {
        field: "profile",
        fields: profileUnknownKeys,
      });
    }
    const readProfileText = (key: "borrowerName" | "businessName") => {
      const value = profile[key];
      if (typeof value !== "string" || !value.trim() || value.trim().length > 80) {
        invalidRequiredInformation(`${key}은(는) 1~80자 텍스트여야 합니다.`, {
          field: `profile.${key}`,
        });
      }
      return value.trim();
    };
    creationProfile = {
      borrowerName: readProfileText("borrowerName"),
      businessName: readProfileText("businessName"),
    };
  }
  if (body.requiredInformationList === undefined) {
    return {
      requiredInformationList: null,
      ...(industryCode ? { industryCode } : {}),
      ...(creationProfile ? { profile: creationProfile } : {}),
    };
  }
  if (!Array.isArray(body.requiredInformationList)) {
    invalidRequiredInformation("requiredInformationList는 배열이어야 합니다.", {
      field: "requiredInformationList",
    });
  }

  const parsed: RequiredInformationItem[] = [];
  for (const [index, value] of body.requiredInformationList.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalidRequiredInformation("필요정보 항목은 객체여야 합니다.", { index });
    }
    const item = value as Record<string, unknown>;
    const extraKeys = Object.keys(item).filter(
      (key) => !REQUIRED_INFORMATION_KEYS.has(key),
    );
    if (extraKeys.length > 0) {
      invalidRequiredInformation("필요정보 항목에 허용되지 않은 필드가 있습니다.", {
        index,
        fields: extraKeys,
      });
    }
    const requiredStrings = ["infoCode", "label", "question"] as const;
    for (const field of requiredStrings) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        invalidRequiredInformation(`${field} 값이 올바르지 않습니다.`, {
          index,
          field,
        });
      }
    }
    for (const field of ["category", "priority", "expectedType", "minQuality", "status"] as const) {
      if (
        typeof item[field] !== "string" ||
        !REQUIRED_INFORMATION_ENUMS[field].has(item[field])
      ) {
        invalidRequiredInformation(`${field} 값이 올바르지 않습니다.`, {
          index,
          field,
        });
      }
    }
    if (typeof item.required !== "boolean") {
      invalidRequiredInformation("required 값은 boolean이어야 합니다.", {
        index,
        field: "required",
      });
    }
    for (const field of ["evidencePreference", "dependencies"] as const) {
      if (!Array.isArray(item[field]) || item[field].some((entry) => typeof entry !== "string")) {
        invalidRequiredInformation(`${field} 값은 문자열 배열이어야 합니다.`, {
          index,
          field,
        });
      }
    }
    if (
      (item.evidencePreference as string[]).some(
        (entry) => !REQUIRED_INFORMATION_ENUMS.evidence.has(entry),
      )
    ) {
      invalidRequiredInformation("evidencePreference 값이 올바르지 않습니다.", {
        index,
        field: "evidencePreference",
      });
    }
    if (
      item.followupQuestion !== undefined &&
      (typeof item.followupQuestion !== "string" || !item.followupQuestion.trim())
    ) {
      invalidRequiredInformation("followupQuestion 값이 올바르지 않습니다.", {
        index,
        field: "followupQuestion",
      });
    }
    parsed.push(item as unknown as RequiredInformationItem);
  }

  const issues = validateRequiredInformationCatalog(parsed, {
    requireDevV1Codes: true,
  });
  if (issues.length > 0) {
    invalidRequiredInformation("필요정보 목록 검증에 실패했습니다.", { issues });
  }
  return {
    requiredInformationList: parsed,
    ...(industryCode ? { industryCode } : {}),
    ...(creationProfile ? { profile: creationProfile } : {}),
  };
}

function requiredString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new ApplicationError(400, "INVALID_REQUEST_FIELD", `${key} 값이 올바르지 않습니다.`, {
      field: key,
    });
  }
  return value.trim();
}

function expectedVersion(body: Record<string, unknown>): number {
  const value = body.expectedVersion;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ApplicationError(
      400,
      "INVALID_EXPECTED_VERSION",
      "expectedVersion은 1 이상의 정수여야 합니다.",
      { field: "expectedVersion" },
    );
  }
  return value as number;
}

function optionalFiniteNumber(
  body: Record<string, unknown>,
  key: string,
  options: { minimum: number; maximum?: number },
): number | null {
  const value = body[key];
  if (value === null || value === undefined) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < options.minimum ||
    (options.maximum !== undefined && value > options.maximum)
  ) {
    throw new ApplicationError(
      400,
      "INVALID_TRANSCRIPT_METADATA",
      `${key} 값이 올바르지 않습니다.`,
      { field: key },
    );
  }
  return value;
}

export async function readMessageCommand(request: Request): Promise<MessageCommandInput> {
  const body = await readJsonObject(request);
  const text = requiredString(body, "text", 5_000);
  const clientMessageId = requiredString(body, "clientMessageId", 128);
  const questionCode = body.currentQuestionInfoCode;
  if (questionCode !== null && (typeof questionCode !== "string" || !questionCode.trim())) {
    throw new ApplicationError(
      400,
      "INVALID_CURRENT_QUESTION",
      "currentQuestionInfoCode는 문자열 또는 null이어야 합니다.",
      { field: "currentQuestionInfoCode" },
    );
  }
  const metadataBody = body.transcriptMetadata;
  let transcriptMetadata: MessageCommandInput["transcriptMetadata"] = null;
  if (metadataBody !== null && metadataBody !== undefined) {
    if (typeof metadataBody !== "object" || Array.isArray(metadataBody)) {
      throw new ApplicationError(
        400,
        "INVALID_TRANSCRIPT_METADATA",
        "transcriptMetadata는 객체 또는 null이어야 합니다.",
        { field: "transcriptMetadata" },
      );
    }
    const values = metadataBody as Record<string, unknown>;
    const startMs = optionalFiniteNumber(values, "startMs", { minimum: 0 });
    const endMs = optionalFiniteNumber(values, "endMs", { minimum: 0 });
    const sttConfidence = optionalFiniteNumber(values, "sttConfidence", {
      minimum: 0,
      maximum: 1,
    });
    const providerValue = values.sttProvider;
    if (
      providerValue !== null &&
      providerValue !== undefined &&
      (typeof providerValue !== "string" ||
        !providerValue.trim() ||
        providerValue.length > 128)
    ) {
      throw new ApplicationError(
        400,
        "INVALID_TRANSCRIPT_METADATA",
        "sttProvider 값이 올바르지 않습니다.",
        { field: "transcriptMetadata.sttProvider" },
      );
    }
    if (startMs !== null && endMs !== null && endMs < startMs) {
      throw new ApplicationError(
        400,
        "INVALID_TRANSCRIPT_TIMING",
        "endMs는 startMs보다 빠를 수 없습니다.",
        { field: "transcriptMetadata.endMs" },
      );
    }
    transcriptMetadata = {
      startMs,
      endMs,
      sttConfidence,
      sttProvider:
        typeof providerValue === "string" ? providerValue.trim() : null,
    };
  }
  return {
    text,
    clientMessageId,
    expectedVersion: expectedVersion(body),
    currentQuestionInfoCode:
      typeof questionCode === "string" ? questionCode.trim() : null,
    transcriptMetadata,
  };
}

export async function readCompleteCommand(request: Request): Promise<CompleteCommandInput> {
  const body = await readJsonObject(request);
  const unknownKeys = Object.keys(body).filter(
    (key) => ![
      "clientCommandId",
      "expectedVersion",
      "mode",
      "borrowerConfirmed",
      "reason",
      "improvementChoice",
    ].includes(key),
  );
  if (unknownKeys.length > 0) {
    throw new ApplicationError(
      400,
      "INVALID_COMPLETION_REQUEST",
      "완료 요청에 허용되지 않은 필드가 있습니다.",
      { fields: unknownKeys },
    );
  }
  const clientCommandId = requiredString(body, "clientCommandId", 128);
  const mode = body.mode;
  if (mode !== "COMPLETE" && mode !== "FORCE_INCOMPLETE") {
    throw new ApplicationError(400, "INVALID_COMPLETION_MODE", "완료 mode가 올바르지 않습니다.", {
      field: "mode",
    });
  }
  if (typeof body.borrowerConfirmed !== "boolean") {
    throw new ApplicationError(
      400,
      "INVALID_BORROWER_CONFIRMATION",
      "borrowerConfirmed boolean 값이 필요합니다.",
      { field: "borrowerConfirmed" },
    );
  }
  if (body.borrowerConfirmed !== true) {
    throw new ApplicationError(
      400,
      "BORROWER_CONFIRMATION_REQUIRED",
      "인터뷰 완료에는 차주의 명시적 최종 확인이 필요합니다.",
      { field: "borrowerConfirmed" },
    );
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : null;
  if (mode === "FORCE_INCOMPLETE" && !reason) {
    throw new ApplicationError(
      400,
      "COMPLETION_REASON_REQUIRED",
      "강제 중단에는 비어 있지 않은 reason이 필요합니다.",
      { field: "reason" },
    );
  }
  const improvementChoice = readImprovementChoice(body.improvementChoice);
  return {
    clientCommandId,
    expectedVersion: expectedVersion(body),
    mode,
    borrowerConfirmed: body.borrowerConfirmed,
    reason,
    improvementChoice,
  };
}

function readImprovementChoice(value: unknown): BorrowerImprovementChoice | null {
  if (value === undefined || value === null) return null;
  if (value === "SKIP") return "SKIP";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApplicationError(
      400,
      "INVALID_IMPROVEMENT_CHOICE",
      "improvementChoice는 SKIP 또는 개선 후보 객체여야 합니다.",
      { field: "improvementChoice" },
    );
  }
  const candidate = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "id",
    "title",
    "origin",
    "sourceInfoCodes",
    "evidenceIds",
  ]);
  const unknownKeys = Object.keys(candidate).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new ApplicationError(
      400,
      "INVALID_IMPROVEMENT_CHOICE",
      "개선 후보에 허용되지 않은 필드가 있습니다.",
      { field: "improvementChoice", fields: unknownKeys },
    );
  }
  const id = candidate.id;
  const title = candidate.title;
  const origin = candidate.origin;
  if (typeof id !== "string" || !id.trim() || id.length > 160) {
    throw new ApplicationError(400, "INVALID_IMPROVEMENT_CHOICE", "개선 후보 id가 올바르지 않습니다.", {
      field: "improvementChoice.id",
    });
  }
  if (typeof title !== "string" || !title.trim() || title.length > 300) {
    throw new ApplicationError(400, "INVALID_IMPROVEMENT_CHOICE", "개선 후보 title이 올바르지 않습니다.", {
      field: "improvementChoice.title",
    });
  }
  if (
    typeof origin !== "string" ||
    !IMPROVEMENT_CANDIDATE_ORIGINS.includes(
      origin as (typeof IMPROVEMENT_CANDIDATE_ORIGINS)[number],
    )
  ) {
    throw new ApplicationError(400, "INVALID_IMPROVEMENT_CHOICE", "개선 후보 origin이 올바르지 않습니다.", {
      field: "improvementChoice.origin",
    });
  }
  const readIds = (key: "sourceInfoCodes" | "evidenceIds", maximum: number) => {
    const ids = candidate[key];
    if (
      !Array.isArray(ids) ||
      ids.length > maximum ||
      ids.some((entry) => typeof entry !== "string" || !entry.trim() || entry.length > 160)
    ) {
      throw new ApplicationError(
        400,
        "INVALID_IMPROVEMENT_CHOICE",
        `개선 후보 ${key}가 올바르지 않습니다.`,
        { field: `improvementChoice.${key}` },
      );
    }
    return [...new Set(ids.map((entry) => (entry as string).trim()))]
      .sort((left, right) => left.localeCompare(right));
  };
  return {
    id: id.trim(),
    title: title.trim(),
    origin: origin as (typeof IMPROVEMENT_CANDIDATE_ORIGINS)[number],
    sourceInfoCodes: readIds("sourceInfoCodes", 16),
    evidenceIds: readIds("evidenceIds", 64),
  };
}

// Kept for server-side callers that still need the original text-only parser.
export async function readMessageText(request: Request): Promise<string> {
  const body = await readJsonObject(request);
  return requiredString(body, "text", 5_000);
}
