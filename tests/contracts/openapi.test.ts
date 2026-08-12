import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readCompleteCommand, readMessageCommand } from "@/server/api-response";
import { CONSENT_PURPOSES } from "@/server/consent-service";
import { REALTIME_EVENT_TYPES } from "@/server/platform-repository";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`${label} must be a string array`);
  }
  return value as string[];
}

function asObjectArray(value: unknown, label: string): JsonObject[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value.map((item, index) => asObject(item, `${label}[${index}]`));
}

function property(object: JsonObject, key: string): JsonObject {
  return asObject(object[key], key);
}

function collectLocalRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectLocalRefs(item, refs);
    return refs;
  }
  if (value === null || typeof value !== "object") return refs;
  for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string" && item.startsWith("#/")) refs.push(item);
    collectLocalRefs(item, refs);
  }
  return refs;
}

function resolveLocalRef(root: JsonObject, ref: string): unknown {
  return ref
    .slice(2)
    .split("/")
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((value, token) => asObject(value, ref)[token], root);
}

const document = asObject(
  JSON.parse(readFileSync(new URL("../../contracts/openapi.json", import.meta.url), "utf8")),
  "OpenAPI document",
);
const correctionRouteSource = readFileSync(
  new URL(
    "../../src/app/api/interviews/[id]/transcript-segments/[segmentId]/corrections/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const retentionRouteSource = readFileSync(
  new URL("../../src/app/api/admin/retention/route.ts", import.meta.url),
  "utf8",
);
const paths = property(document, "paths");
const components = property(document, "components");
const schemas = property(components, "schemas");

function operation(path: string, method: string): JsonObject {
  return property(property(paths, path), method);
}

function schema(name: string): JsonObject {
  return property(schemas, name);
}

describe("OpenAPI contract", () => {
  it("uses OpenAPI 3.1 and JSON Schema 2020-12", () => {
    expect(document.openapi).toBe("3.1.0");
    expect(document.jsonSchemaDialect).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  it("contains no dangling local references", () => {
    const refs = collectLocalRefs(document);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(resolveLocalRef(document, ref), ref).toBeDefined();
  });

  it("defines every supported HTTP operation with a stable operationId", () => {
    const expectedOperations = [
      ["/auth/bootstrap", "post", "bootstrapLocalAccount"],
      ["/auth/session", "post", "createSession"],
      ["/auth/session", "delete", "deleteSession"],
      ["/auth/me", "get", "getCurrentIdentity"],
      ["/interviews", "post", "createInterview"],
      ["/interviews/{id}", "get", "getInterview"],
      ["/interviews/{id}/messages", "post", "addInterviewMessage"],
      [
        "/interviews/{id}/transcript-segments/{segmentId}/corrections",
        "post",
        "correctInterviewTranscriptSegment",
      ],
      ["/interviews/{id}/complete", "post", "completeInterview"],
      ["/interviews/{id}/events", "get", "streamInterviewEvents"],
      ["/interviews/{id}/consents", "get", "getInterviewConsents"],
      ["/interviews/{id}/consents", "post", "recordInterviewConsent"],
      ["/interviews/{id}/information-items", "get", "getInterviewInformationItems"],
      ["/interviews/{id}/live-features", "get", "getInterviewLiveFeatures"],
      ["/interview-evaluations", "get", "listInterviewEvaluations"],
      ["/interview-evaluations/{id}", "get", "getInterviewEvaluation"],
      ["/interview-evaluations/{id}/pillars", "get", "getInterviewEvaluationPillars"],
      ["/interview-evaluations/{id}/goals", "get", "getInterviewEvaluationGoals"],
      ["/interview-evaluations/{id}/evidence", "get", "getInterviewEvaluationEvidence"],
      ["/admin/retention", "post", "enforceRetention"],
    ] as const;

    for (const [path, method, operationId] of expectedOperations) {
      expect(operation(path, method).operationId).toBe(operationId);
    }
  });

  it("documents local bootstrap/session principal shapes and the session cookie", () => {
    const productionAuthentication = property(document, "x-production-authentication");
    expect(productionAuthentication).toMatchObject({
      status: "EXTERNAL_IDP_NOT_IMPLEMENTED",
      failClosed: true,
      errorStatus: 503,
      errorCode: "PRODUCTION_IDP_NOT_CONFIGURED",
      localException: "AUTOMATED_LOOPBACK_E2E_ONLY",
    });
    expect(productionAuthentication.description).toContain("in-process attestation");
    expect(productionAuthentication.description).toContain("direct Next deployment");

    const securitySchemes = property(components, "securitySchemes");
    const sessionCookie = property(securitySchemes, "sessionCookie");
    expect(sessionCookie).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: "donghaeng_session",
    });
    expect(sessionCookie.description).toContain("not a production identity mechanism");

    expect(schema("BootstrapRequest")).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
    expect(asStringArray(schema("BootstrapResult").required, "BootstrapResult.required")).toEqual(
      ["principal", "expiresAt", "bootstrapMode"],
    );
    expect(property(property(schema("BootstrapResult"), "properties"), "bootstrapMode").const).toBe(
      "LOCAL_WORKSPACE",
    );
    expect(asStringArray(schema("AuthPrincipal").required, "AuthPrincipal.required")).toEqual([
      "tenantId",
      "userId",
      "email",
      "displayName",
    ]);

    const bootstrapResponses = property(operation("/auth/bootstrap", "post"), "responses");
    expect(bootstrapResponses).toHaveProperty("200");
    expect(bootstrapResponses).toHaveProperty("403");
    expect(property(property(property(bootstrapResponses, "200"), "headers"), "Set-Cookie")).toBeDefined();
  });

  it("requires a requestId in every JSON success/error envelope", () => {
    expect(asStringArray(schema("ApiMeta").required, "ApiMeta.required")).toEqual([
      "requestId",
    ]);

    const envelopes = [
      "ErrorEnvelope",
      "BootstrapSuccessEnvelope",
      "SessionSuccessEnvelope",
      "SignOutSuccessEnvelope",
      "MeSuccessEnvelope",
      "PreviewSnapshotSuccessEnvelope",
      "InterviewSnapshotSuccessEnvelope",
      "MessageSuccessEnvelope",
      "CompletionSuccessEnvelope",
      "EvaluationListSuccessEnvelope",
      "EvaluationSuccessEnvelope",
      "InformationItemsSuccessEnvelope",
      "LiveFeaturesSuccessEnvelope",
      "EvaluationPillarsSuccessEnvelope",
      "EvaluationGoalsSuccessEnvelope",
      "EvaluationEvidenceSuccessEnvelope",
      "ConsentStateSuccessEnvelope",
      "ConsentDecisionSuccessEnvelope",
      "TranscriptCorrectionSuccessEnvelope",
      "RetentionSuccessEnvelope",
    ];

    for (const name of envelopes) {
      expect(asStringArray(schema(name).required, `${name}.required`).sort()).toEqual([
        "data",
        "error",
        "meta",
      ]);
      expect(property(schema(name), "properties")).toHaveProperty("meta");
    }

    expect(property(property(schema("ErrorEnvelope"), "properties"), "data").type).toBe(
      "null",
    );
    expect(property(property(schema("ApiError"), "properties"), "code").type).toBe(
      "string",
    );
  });

  it("documents the optional dev-v1 RequiredInformationList creation input", () => {
    const requestBody = property(operation("/interviews", "post"), "requestBody");
    expect(requestBody.required).toBe(true);
    const mediaType = property(property(requestBody, "content"), "application/json");
    expect(property(mediaType, "schema").$ref).toBe(
      "#/components/schemas/CreateInterviewRequest",
    );

    const createRequest = schema("CreateInterviewRequest");
    expect(createRequest).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(createRequest).not.toHaveProperty("required");
    expect(property(property(createRequest, "properties"), "requiredInformationList").$ref)
      .toBe("#/components/schemas/RequiredInformationListDevV1");
    expect(asStringArray(
      property(property(createRequest, "properties"), "industryCode").enum,
      "CreateInterviewRequest.industryCode.enum",
    )).toHaveLength(11);
    expect(property(property(createRequest, "properties"), "profile")).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["borrowerName", "businessName"],
    });

    const list = schema("RequiredInformationListDevV1");
    expect(list).toMatchObject({ type: "array", minItems: 8, maxItems: 11 });
    // The first eight contains rules keep completion items mandatory; the last
    // three permit each registered supporting signal zero or one time.
    const containsRules = asObjectArray(list.allOf, "RequiredInformationListDevV1.allOf");
    expect(containsRules).toHaveLength(11);
    expect(containsRules.slice(0, 8).every((rule) => rule.minContains === 1)).toBe(true);
    expect(containsRules.slice(8).every((rule) => rule.minContains === 0)).toBe(true);
    const item = schema("RequiredInformationItemDevV1");
    expect(item.additionalProperties).toBe(false);
    expect(asStringArray(item.required, "RequiredInformationItemDevV1.required")).toEqual([
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
    ]);
    expect(asStringArray(
      property(property(item, "properties"), "infoCode").enum,
      "RequiredInformationItemDevV1.infoCode.enum",
    )).toHaveLength(11);
    expect(property(operation("/interviews", "post"), "responses")).toHaveProperty("422");
  });

  it("matches the canonical interview data-quality evaluation payload", () => {
    const evaluation = schema("InterviewEvaluation");
    expect(evaluation.additionalProperties).toBe(false);
    expect(asStringArray(evaluation.required, "InterviewEvaluation.required")).toEqual([
      "id",
      "interviewId",
      "finalSnapshotId",
      "snapshotVersion",
      "createdAt",
      "policyVersion",
      "snapshotId",
      "snapshotStateVersion",
      "status",
      "decisionScope",
      "gradeScope",
      "approvalDecision",
      "creditGrade",
      "qualitySummary",
      "disclaimer",
      "overall",
      "pillars",
      "items",
      "failureReasons",
    ]);
    const properties = property(evaluation, "properties");
    expect(property(properties, "decisionScope").const).toBe(
      "INTERVIEW_DATA_QUALITY_ONLY",
    );
    expect(property(properties, "gradeScope").const).toBe(
      "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
    );
    expect(property(properties, "approvalDecision").type).toBe("null");
    expect(property(properties, "creditGrade").type).toBe("null");
    const overall = property(properties, "overall");
    expect(asStringArray(overall.required, "InterviewEvaluation.overall.required"))
      .toEqual(["score", "grade", "completionStatus"]);
    expect(property(property(overall, "properties"), "grade").enum).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
      "UNGRADED",
    ]);
    expect(asStringArray(schema("EvaluationPillar").required, "EvaluationPillar.required"))
      .toContain("evidenceIds");
    expect(asStringArray(schema("EvaluationItem").required, "EvaluationItem.required"))
      .toEqual([
        "infoCode",
        "category",
        "required",
        "status",
        "valueState",
        "evaluable",
        "score",
        "grade",
        "parserConfidence",
        "informationQuality",
        "verification",
        "source",
        "asOf",
        "evidenceIds",
        "summary",
      ]);
    const evaluationItemProperties = property(schema("EvaluationItem"), "properties");
    expect(property(evaluationItemProperties, "score").type).toEqual(["integer", "null"]);
    expect(property(evaluationItemProperties, "grade").description).toContain("data-quality");
    expect(property(evaluationItemProperties, "source").type).toEqual(["string", "null"]);
    expect(property(evaluationItemProperties, "asOf").oneOf).toBeDefined();
  });

  it("documents the tenant-scoped evaluation list and its data-quality boundary", () => {
    const listOperation = operation("/interview-evaluations", "get");
    const parameters = asObjectArray(listOperation.parameters, "evaluation list parameters");
    expect(parameters.map((parameter) => parameter.name)).toEqual([
      "q",
      "industry",
      "level",
      "from",
      "to",
    ]);
    const responses = property(listOperation, "responses");
    expect(property(
      property(property(property(responses, "200"), "content"), "application/json"),
      "schema",
    ).$ref).toBe("#/components/schemas/EvaluationListSuccessEnvelope");

    const item = schema("EvaluationListItem");
    expect(item.additionalProperties).toBe(false);
    expect(asStringArray(item.required, "EvaluationListItem.required")).toEqual([
      "id",
      "interviewId",
      "status",
      "createdAt",
      "completedAt",
      "borrowerName",
      "businessName",
      "industry",
      "overallScore",
      "overallLevel",
      "overallLevelLabel",
      "informationRate",
      "goalCount",
      "completionStatus",
      "decisionScope",
    ]);
    const itemProperties = property(item, "properties");
    expect(property(itemProperties, "decisionScope").const).toBe(
      "INTERVIEW_DATA_QUALITY_ONLY",
    );
    expect(property(itemProperties, "overallScore").description).toContain("not a credit score");
    expect(property(itemProperties, "overallLevel").description).toContain("not a credit grade");
  });

  it("keeps the message contract synchronized with the strict runtime parser", async () => {
    const requestBody = property(operation("/interviews/{id}/messages", "post"), "requestBody");
    expect(requestBody.required).toBe(true);
    const mediaType = property(property(requestBody, "content"), "application/json");
    expect(property(mediaType, "schema").$ref).toBe("#/components/schemas/AddMessageRequest");

    const messageRequest = schema("AddMessageRequest");
    const requiredFields = [
      "text",
      "clientMessageId",
      "expectedVersion",
      "currentQuestionInfoCode",
    ];
    expect(asStringArray(messageRequest.required, "AddMessageRequest.required")).toEqual(
      requiredFields,
    );
    const messageProperties = property(messageRequest, "properties");
    expect(Object.keys(messageProperties).sort()).toEqual(
      [
        "clientMessageId",
        "currentQuestionInfoCode",
        "expectedVersion",
        "text",
        "transcriptMetadata",
      ].sort(),
    );
    expect(property(messageProperties, "expectedVersion")).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    expect(property(messageProperties, "text").maxLength).toBe(5_000);
    expect(property(messageProperties, "currentQuestionInfoCode").type).toEqual([
      "string",
      "null",
    ]);

    const validBody = {
      text: "가".repeat(5_000),
      clientMessageId: "message-1",
      expectedVersion: 1,
      currentQuestionInfoCode: null,
      transcriptMetadata: null,
    };
    await expect(
      readMessageCommand(
        new Request("http://localhost/api/interviews/i/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(validBody),
        }),
      ),
    ).resolves.toEqual(validBody);
    await expect(
      readMessageCommand(
        new Request("http://localhost/api/interviews/i/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...validBody, text: "가".repeat(5_001) }),
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST_FIELD" });

    for (const field of requiredFields) {
      const invalidBody = { ...validBody } as Record<string, unknown>;
      delete invalidBody[field];
      await expect(
        readMessageCommand(
          new Request("http://localhost/api/interviews/i/messages", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(invalidBody),
          }),
        ),
        field,
      ).rejects.toBeDefined();
    }

    const metadata = {
      startMs: 120,
      endMs: 2_480,
      sttConfidence: 0.93,
      sttProvider: "mock-streaming-stt",
    };
    await expect(
      readMessageCommand(
        new Request("http://localhost/api/interviews/i/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...validBody, transcriptMetadata: metadata }),
        }),
      ),
    ).resolves.toMatchObject({ transcriptMetadata: metadata });
    await expect(
      readMessageCommand(
        new Request("http://localhost/api/interviews/i/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...validBody,
            transcriptMetadata: { ...metadata, sttConfidence: 1.1 },
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSCRIPT_METADATA" });

    const metadataSchema = schema("TranscriptMetadata");
    const metadataProperties = property(metadataSchema, "properties");
    expect(property(metadataProperties, "startMs")).toMatchObject({ minimum: 0 });
    expect(property(metadataProperties, "endMs")).toMatchObject({ minimum: 0 });
    expect(property(metadataProperties, "sttConfidence")).toMatchObject({
      minimum: 0,
      maximum: 1,
    });
    expect(property(metadataProperties, "sttProvider")).toMatchObject({
      minLength: 1,
      maxLength: 128,
      pattern: "\\S",
    });

    const resultSchema = schema("MessageProcessingResult");
    expect(asStringArray(resultSchema.required, "MessageProcessingResult.required")).toEqual([
      "snapshot",
      "stateChanges",
      "evidenceAdded",
      "acceptedTranscript",
      "processing",
    ]);
    const processing = property(property(resultSchema, "properties"), "processing");
    expect(processing).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(asStringArray(processing.required, "MessageProcessingResult.processing.required"))
      .toEqual(["status", "code"]);
    expect(property(property(processing, "properties"), "status").enum).toEqual([
      "APPLIED",
      "RETRYABLE_FAILURE",
      "NON_RETRYABLE_FAILURE",
    ]);
    expect(property(property(processing, "properties"), "metadata").$ref).toBe(
      "#/components/schemas/TurnPlannerMetadata",
    );
    const plannerMetadata = schema("TurnPlannerMetadata");
    expect(plannerMetadata).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(asStringArray(plannerMetadata.required, "TurnPlannerMetadata.required")).toEqual([
      "provider",
      "model",
      "requestId",
      "inputTokens",
      "outputTokens",
      "stopReason",
    ]);
    const plannerMetadataProperties = property(plannerMetadata, "properties");
    expect(property(plannerMetadataProperties, "provider").maxLength).toBe(40);
    expect(property(plannerMetadataProperties, "model").maxLength).toBe(120);
    expect(property(plannerMetadataProperties, "requestId").maxLength).toBe(160);
    expect(property(plannerMetadataProperties, "inputTokens").minimum).toBe(0);
    expect(property(plannerMetadataProperties, "outputTokens").minimum).toBe(0);
  });

  it("documents the idempotent COMPLETE/FORCE_INCOMPLETE runtime command", async () => {
    const requestBody = property(operation("/interviews/{id}/complete", "post"), "requestBody");
    expect(requestBody.required).toBe(true);
    const mediaType = property(property(requestBody, "content"), "application/json");
    expect(property(mediaType, "schema").$ref).toBe(
      "#/components/schemas/CompleteInterviewRequest",
    );

    const completeRequest = schema("CompleteInterviewRequest");
    expect(asStringArray(completeRequest.required, "CompleteInterviewRequest.required")).toEqual([
      "clientCommandId",
      "expectedVersion",
      "mode",
      "borrowerConfirmed",
      "reason",
    ]);
    const completeProperties = property(completeRequest, "properties");
    expect(property(completeProperties, "mode").enum).toEqual([
      "COMPLETE",
      "FORCE_INCOMPLETE",
    ]);
    expect(completeRequest.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          if: expect.objectContaining({ properties: { mode: { const: "FORCE_INCOMPLETE" } } }),
          then: expect.objectContaining({
            properties: {
              reason: expect.objectContaining({ type: "string", minLength: 1, pattern: "\\S" }),
            },
          }),
        }),
      ]),
    );

    const strict = {
      clientCommandId: "complete-1",
      expectedVersion: 2,
      mode: "COMPLETE" as const,
      borrowerConfirmed: true,
      reason: null,
    };
    await expect(
      readCompleteCommand(
        new Request("http://localhost/api/interviews/i/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(strict),
        }),
      ),
    ).resolves.toEqual(strict);

    const forced = { ...strict, mode: "FORCE_INCOMPLETE" as const, reason: "borrower stopped" };
    await expect(
      readCompleteCommand(
        new Request("http://localhost/api/interviews/i/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(forced),
        }),
      ),
    ).resolves.toEqual(forced);
    await expect(
      readCompleteCommand(
        new Request("http://localhost/api/interviews/i/complete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...forced, reason: "   " }),
        }),
      ),
    ).rejects.toMatchObject({ code: "COMPLETION_REASON_REQUIRED" });

    const completionResult = schema("CompletionResult");
    expect(asStringArray(completionResult.required, "CompletionResult.required")).toEqual([
      "snapshot",
      "evaluation",
      "evaluationEligibility",
    ]);
  });

  it("documents append-only transcript correction commands and results", () => {
    const path = "/interviews/{id}/transcript-segments/{segmentId}/corrections";
    const correctionOperation = operation(path, "post");
    const requestBody = property(correctionOperation, "requestBody");
    expect(requestBody.required).toBe(true);
    const mediaType = property(property(requestBody, "content"), "application/json");
    expect(property(mediaType, "schema").$ref).toBe(
      "#/components/schemas/TranscriptCorrectionRequest",
    );

    const request = schema("TranscriptCorrectionRequest");
    expect(asStringArray(request.required, "TranscriptCorrectionRequest.required")).toEqual([
      "clientCorrectionId",
      "expectedVersion",
      "correctedText",
      "reason",
    ]);
    const requestProperties = property(request, "properties");
    expect(property(requestProperties, "clientCorrectionId").maxLength).toBe(128);
    expect(property(requestProperties, "expectedVersion")).toMatchObject({
      type: "integer",
      minimum: 1,
    });
    expect(property(requestProperties, "correctedText").maxLength).toBe(5_000);
    expect(property(requestProperties, "reason").maxLength).toBe(1_000);

    expect(correctionRouteSource).toContain(
      'clientCorrectionId: requiredString(body, "clientCorrectionId", 128)',
    );
    expect(correctionRouteSource).toContain(
      'correctedText: requiredString(body, "correctedText", 5_000)',
    );
    expect(correctionRouteSource).toContain('reason: requiredString(body, "reason", 1_000)');

    const responses = property(correctionOperation, "responses");
    for (const status of ["200", "400", "401", "403", "404", "409", "422", "500"]) {
      expect(responses, status).toHaveProperty(status);
    }
    const successSchema = property(
      property(property(responses, "200"), "content"),
      "application/json",
    );
    expect(property(successSchema, "schema").$ref).toBe(
      "#/components/schemas/TranscriptCorrectionSuccessEnvelope",
    );

    expect(asStringArray(schema("TranscriptCorrectionResult").required, "result.required"))
      .toEqual(["correction", "segment", "interview", "events"]);
    const segment = schema("CorrectedTranscriptSegment");
    expect(asStringArray(segment.required, "segment.required")).toEqual(
      expect.arrayContaining([
        "startMs",
        "endMs",
        "sttConfidence",
        "sttProvider",
        "rawText",
        "correctedText",
        "revision",
      ]),
    );
    const resultProperties = property(schema("TranscriptCorrectionResult"), "properties");
    expect(property(property(resultProperties, "events"), "items").$ref).toBe(
      "#/components/schemas/SseEventEnvelope",
    );
    expect(asStringArray(schema("RealtimeEventType").enum, "event types")).toEqual(
      [...REALTIME_EVENT_TYPES],
    );
  });

  it("documents ADMIN-only retention dry runs and protected artifacts", () => {
    const retentionOperation = operation("/admin/retention", "post");
    const requestBody = property(retentionOperation, "requestBody");
    expect(requestBody.required).toBe(true);
    const mediaType = property(property(requestBody, "content"), "application/json");
    expect(property(mediaType, "schema").$ref).toBe("#/components/schemas/RetentionRequest");
    expect(property(property(schema("RetentionRequest"), "properties"), "dryRun"))
      .toMatchObject({ type: "boolean", default: true });
    expect(retentionRouteSource).toContain('principal.roles.includes("ADMIN")');
    expect(retentionRouteSource).toContain("body.dryRun !== false");

    const responses = property(retentionOperation, "responses");
    for (const status of ["200", "400", "401", "403", "500"]) {
      expect(responses, status).toHaveProperty(status);
    }
    const result = schema("RetentionRunResult");
    expect(asStringArray(result.required, "RetentionRunResult.required")).toEqual([
      "runId",
      "dryRun",
      "cutoff",
      "candidates",
      "deleted",
      "protectedArtifacts",
    ]);
    const resultProperties = property(result, "properties");
    expect(property(resultProperties, "candidates").$ref).toBe(
      "#/components/schemas/RetentionCounts",
    );
    expect(property(resultProperties, "deleted").$ref).toBe(
      "#/components/schemas/RetentionCounts",
    );
    const protectedArtifacts = property(resultProperties, "protectedArtifacts");
    expect(asObjectArray(protectedArtifacts.prefixItems, "protectedArtifacts.prefixItems")
      .map((item) => item.const)).toEqual([
      "TRANSCRIPT",
      "EVIDENCE",
      "AUDIT_EVENT",
      "FINAL_SNAPSHOT",
    ]);
  });

  it("defines GET interview as a PREVIEW/FINAL discriminated union", () => {
    const interviewSnapshot = schema("InterviewSnapshot");
    const choices = interviewSnapshot.oneOf;
    if (!Array.isArray(choices)) throw new TypeError("InterviewSnapshot.oneOf must be an array");
    expect(choices).toEqual([
      { $ref: "#/components/schemas/PreviewSnapshot" },
      { $ref: "#/components/schemas/FinalSnapshot" },
    ]);
    expect(property(interviewSnapshot, "discriminator")).toMatchObject({
      propertyName: "snapshotType",
      mapping: {
        PREVIEW: "#/components/schemas/PreviewSnapshot",
        FINAL: "#/components/schemas/FinalSnapshot",
      },
    });
    expect(property(property(schema("PreviewSnapshot"), "properties"), "snapshotType").const).toBe(
      "PREVIEW",
    );
    expect(
      asStringArray(schema("PreviewSnapshot").required, "PreviewSnapshot.required"),
    ).toContain("pendingCommand");
    const pendingCommand = schema("PendingMessageCommand");
    expect(pendingCommand).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(
      asStringArray(pendingCommand.required, "PendingMessageCommand.required"),
    ).toEqual([
      "text",
      "clientMessageId",
      "expectedVersion",
      "currentQuestionInfoCode",
      "transcriptMetadata",
      "processingState",
    ]);
    expect(
      property(property(pendingCommand, "properties"), "processingState").enum,
    ).toEqual(["READY", "PROCESSING"]);
    expect(property(property(schema("FinalSnapshot"), "properties"), "snapshotType").const).toBe(
      "FINAL",
    );
    expect(asStringArray(schema("InterviewSessionSummary").required, "session.required")).toContain(
      "lastEventSeq",
    );
    expect(property(property(schema("InterviewSessionSummary"), "properties"), "lastEventSeq"))
      .toMatchObject({ type: "integer", minimum: 0 });
    expect(asStringArray(schema("FinalSnapshot").required, "FinalSnapshot.required")).toContain(
      "session",
    );
    expect(asStringArray(schema("FinalSnapshot").required, "FinalSnapshot.required")).toContain(
      "evaluationId",
    );
    expect(property(property(schema("FinalSnapshot"), "properties"), "evaluationId").type)
      .toEqual(["string", "null"]);

    const responses = property(operation("/interviews/{id}", "get"), "responses");
    const content = property(property(responses, "200"), "content");
    const responseSchema = property(property(content, "application/json"), "schema");
    expect(responseSchema.$ref).toBe("#/components/schemas/InterviewSnapshotSuccessEnvelope");
  });

  it("documents PREVIEW/FINAL projection and FINAL evaluation subresources", () => {
    const informationItems = schema("InformationItemsProjection");
    const itemProperties = property(informationItems, "properties");
    expect(property(itemProperties, "snapshotType").enum).toEqual(["PREVIEW", "FINAL"]);
    expect(asStringArray(informationItems.required, "InformationItemsProjection.required"))
      .toEqual(["interviewId", "snapshotType", "version", "informationItems"]);

    const liveFeatures = schema("LiveFeaturesProjection");
    expect(asStringArray(liveFeatures.required, "LiveFeaturesProjection.required"))
      .toEqual(["interviewId", "snapshotType", "version", "features", "improvementFeatures", "summary"]);
    expect(property(property(liveFeatures, "properties"), "improvementFeatures").anyOf).toEqual([
      { $ref: "#/components/schemas/ImprovementFeatureV2Set" },
      { type: "null" },
    ]);

    for (const [name, collection] of [
      ["EvaluationPillarsProjection", "pillars"],
      ["EvaluationGoalsProjection", "goals"],
      ["EvaluationEvidenceProjection", "evidence"],
    ] as const) {
      const variants = asObjectArray(schema(name).allOf, `${name}.allOf`);
      const specialization = variants.find((entry) => "properties" in entry);
      if (!specialization) throw new TypeError(`${name} specialization is required`);
      expect(asStringArray(specialization.required, `${name}.required`)).toEqual([collection]);
    }
    expect(property(property(schema("EvaluationArtifactBase"), "properties"), "snapshotType").const)
      .toBe("FINAL");
  });

  it("documents deny-by-default microphone, raw-audio, and cloud-AI consent decisions", () => {
    expect(asStringArray(schema("ConsentPurpose").enum, "ConsentPurpose.enum"))
      .toEqual([...CONSENT_PURPOSES]);
    expect(asStringArray(schema("ConsentDecisionRequest").required, "consent.required"))
      .toEqual(["purpose", "consentVersion", "granted", "expiresAt"]);
    const consentState = schema("ConsentState");
    const consentProperties = property(consentState, "properties");
    expect(property(consentProperties, "microphoneEnabled")).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(property(consentProperties, "rawAudioStorageEnabled")).toMatchObject({
      type: "boolean",
      default: false,
    });
    expect(property(consentProperties, "cloudAiProcessingEnabled")).toMatchObject({
      type: "boolean",
      default: false,
    });
    const getConsent = operation("/interviews/{id}/consents", "get");
    expect(getConsent.parameters).toContainEqual({
      $ref: "#/components/parameters/ConsentRequirement",
    });
    expect(property(property(components, "parameters"), "ConsentRequirement")).toMatchObject({
      name: "require",
      in: "query",
      required: false,
    });
    expect(property(getConsent, "responses")).toHaveProperty("400");
    expect(property(getConsent, "responses")).toHaveProperty("403");
  });

  it("documents SSE replay, media type, batch envelope, and canonical events", () => {
    const streamOperation = operation("/interviews/{id}/events", "get");
    const parameters = streamOperation.parameters;
    if (!Array.isArray(parameters)) throw new TypeError("SSE parameters must be an array");
    expect(parameters).toContainEqual({ $ref: "#/components/parameters/LastEventId" });

    const parameterComponents = property(components, "parameters");
    expect(property(parameterComponents, "LastEventId")).toMatchObject({
      name: "Last-Event-ID",
      in: "header",
      required: false,
    });

    const responses = property(streamOperation, "responses");
    const content = property(property(responses, "200"), "content");
    const eventStream = property(content, "text/event-stream");
    expect(property(eventStream, "schema").type).toBe("string");
    expect(property(eventStream, "x-eventPayloadSchema").$ref).toBe(
      "#/components/schemas/SseEventEnvelope",
    );
    expect(property(responses, "409").$ref).toBe("#/components/responses/ReplayGap");

    expect(asStringArray(schema("RealtimeEventType").enum, "RealtimeEventType.enum")).toEqual(
      [...REALTIME_EVENT_TYPES],
    );
    expect(asStringArray(schema("SseEventEnvelope").required, "SseEventEnvelope.required")).toEqual(
      expect.arrayContaining([
        "schemaVersion",
        "eventId",
        "seq",
        "aggregateVersion",
        "turnId",
        "batchIndex",
        "batchSize",
        "isBatchFinal",
        "snapshotUrl",
        "type",
        "data",
      ]),
    );
  });
});
