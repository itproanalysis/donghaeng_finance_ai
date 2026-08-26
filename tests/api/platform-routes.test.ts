import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
} from "../../src/domain";
import type { RealtimeEventEnvelope } from "../../src/server/platform-repository";
import { getInterviewService } from "../../src/server/service-instance";

import {
  apiFailure,
  readCreateInterviewCommand,
  readCompleteCommand,
  readMessageCommand,
} from "../../src/server/api-response";
import { ApplicationError } from "../../src/server/errors";
import { POST as bootstrap } from "../../src/app/api/auth/bootstrap/route";
import { GET as getInterview } from "../../src/app/api/interviews/[id]/route";
import { POST as createInterview } from "../../src/app/api/interviews/route";
import { POST as addMessage } from "../../src/app/api/interviews/[id]/messages/route";
import { POST as completeInterview } from "../../src/app/api/interviews/[id]/complete/route";
import { GET as streamEvents } from "../../src/app/api/interviews/[id]/events/route";
import { GET as getInformationItems } from "../../src/app/api/interviews/[id]/information-items/route";
import { GET as getLiveFeatures } from "../../src/app/api/interviews/[id]/live-features/route";
import {
  GET as getConsents,
  POST as recordConsent,
} from "../../src/app/api/interviews/[id]/consents/route";

interface TestGlobals {
  __donghaengDatabase?: DatabaseSync;
  __donghaengInterviewService?: unknown;
  __donghaengAuthService?: unknown;
  __donghaengRetentionService?: unknown;
}

const globals = globalThis as typeof globalThis & TestGlobals;
const originalDatabasePath = process.env.DONGHAENG_DB_PATH;
const temporaryDirectories: string[] = [];

function clearServices(): void {
  try {
    globals.__donghaengDatabase?.close();
  } catch {
    // A failed request may already have closed the test database.
  }
  delete globals.__donghaengDatabase;
  delete globals.__donghaengInterviewService;
  delete globals.__donghaengAuthService;
  delete globals.__donghaengRetentionService;
}

function jsonRequest(
  url: string,
  method: string,
  body: Record<string, unknown>,
  cookie?: string,
): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      origin: new URL(url).origin,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  clearServices();
  process.env.DONGHAENG_DB_PATH = originalDatabasePath;
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory && resolve(directory).startsWith(resolve(tmpdir()))) {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

describe("API request and error contracts", () => {
  it("treats an absent or empty optional create body as the dev catalog request", async () => {
    await expect(
      readCreateInterviewCommand(
        new Request("http://localhost/api/interviews", { method: "POST" }),
      ),
    ).resolves.toEqual({ requiredInformationList: null });
    await expect(
      readCreateInterviewCommand(
        new Request("http://localhost/api/interviews", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "",
        }),
      ),
    ).resolves.toEqual({ requiredInformationList: null });
  });

  it("normalizes an allow-listed SOHO industry and rejects unknown profiles", async () => {
    await expect(
      readCreateInterviewCommand(
        jsonRequest("http://localhost/api/interviews", "POST", {
          industryCode: "온라인 쇼핑",
        }),
      ),
    ).resolves.toEqual({
      requiredInformationList: null,
      industryCode: "ONLINE_SHOPPING",
    });
    await expect(
      readCreateInterviewCommand(
        jsonRequest("http://localhost/api/interviews", "POST", {
          industryCode: "UNSUPPORTED",
        }),
      ),
    ).rejects.toMatchObject({
      status: 422,
      code: "INVALID_REQUIRED_INFORMATION_LIST",
    });
  });

  it("accepts an explicit borrower profile without automatic prefill", async () => {
    await expect(
      readCreateInterviewCommand(
        jsonRequest("http://localhost/api/interviews", "POST", {
          industryCode: "미용",
          profile: {
            borrowerName: "김사장 ",
            businessName: " 봄날헤어",
          },
        }),
      ),
    ).resolves.toEqual({
      requiredInformationList: null,
      industryCode: "BEAUTY",
      profile: {
        borrowerName: "김사장",
        businessName: "봄날헤어",
      },
    });
  });

  it("validates the canonical message and completion commands", async () => {
    const message = await readMessageCommand(
      jsonRequest("http://localhost/api/messages", "POST", {
        text: "월 2,300만원입니다",
        clientMessageId: "message-1",
        expectedVersion: 1,
        currentQuestionInfoCode: "monthly_average_sales",
        transcriptMetadata: {
          startMs: 120,
          endMs: 2_480,
          sttConfidence: 0.93,
          sttProvider: "mock-streaming-stt",
        },
      }),
    );
    const completion = await readCompleteCommand(
      jsonRequest("http://localhost/api/complete", "POST", {
        clientCommandId: "complete-1",
        expectedVersion: 2,
        mode: "FORCE_INCOMPLETE",
        borrowerConfirmed: true,
        reason: "사용자 중단",
      }),
    );

    expect(message.clientMessageId).toBe("message-1");
    expect(message.transcriptMetadata).toEqual({
      startMs: 120,
      endMs: 2_480,
      sttConfidence: 0.93,
      sttProvider: "mock-streaming-stt",
    });
    expect(completion.mode).toBe("FORCE_INCOMPLETE");
    expect(completion.improvementChoice).toBeNull();
    await expect(
      readCompleteCommand(
        jsonRequest("http://localhost/api/complete", "POST", {
          clientCommandId: "complete-without-confirmation",
          expectedVersion: 2,
          mode: "FORCE_INCOMPLETE",
          borrowerConfirmed: false,
          reason: "사용자 중단",
        }),
      ),
    ).rejects.toMatchObject({ code: "BORROWER_CONFIRMATION_REQUIRED" });
    await expect(
      readCompleteCommand(
        jsonRequest("http://localhost/api/complete", "POST", {
          clientCommandId: "complete-with-choice",
          expectedVersion: 2,
          mode: "COMPLETE",
          borrowerConfirmed: true,
          reason: null,
          improvementChoice: {
            id: "catalog-improvement-action",
            title: "한 가지 개선 행동 정하기",
            origin: "CATALOG_SUGGESTION",
            sourceInfoCodes: ["improvement_plan"],
            evidenceIds: [],
          },
        }),
      ),
    ).resolves.toMatchObject({
      improvementChoice: {
        id: "catalog-improvement-action",
        origin: "CATALOG_SUGGESTION",
      },
    });
    await expect(
      readCompleteCommand(
        jsonRequest("http://localhost/api/complete", "POST", {
          clientCommandId: "complete-invalid-choice",
          expectedVersion: 2,
          mode: "COMPLETE",
          borrowerConfirmed: true,
          reason: null,
          improvementChoice: {
            id: "catalog-improvement-action",
            title: "한 가지 개선 행동 정하기",
            origin: "CATALOG_SUGGESTION",
            sourceInfoCodes: ["improvement_plan"],
            evidenceIds: [],
            approvalDecision: "APPROVED",
          },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_IMPROVEMENT_CHOICE" });
    await expect(
      readCompleteCommand(
        jsonRequest("http://localhost/api/complete", "POST", {
          clientCommandId: "complete-2",
          expectedVersion: 2,
          mode: "FORCE_INCOMPLETE",
          borrowerConfirmed: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "COMPLETION_REASON_REQUIRED" });
    await expect(
      readMessageCommand(
        jsonRequest("http://localhost/api/messages", "POST", {
          text: "잘못된 음성 구간",
          clientMessageId: "message-invalid-timing",
          expectedVersion: 1,
          currentQuestionInfoCode: "monthly_average_sales",
          transcriptMetadata: { startMs: 500, endMs: 100, sttConfidence: 1.1 },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TRANSCRIPT_METADATA" });
  });

  it("always includes a request ID without leaking unexpected errors", async () => {
    const known = apiFailure(
      new ApplicationError(409, "VERSION_CONFLICT", "충돌", { actualVersion: 2 }),
      { requestId: "request-known" },
    );
    const unexpected = apiFailure(new Error("secret database detail"), {
      requestId: "request-unknown",
    });

    await expect(known.json()).resolves.toMatchObject({
      data: null,
      error: { code: "VERSION_CONFLICT", details: { actualVersion: 2 } },
      meta: { requestId: "request-known" },
    });
    const body = await unexpected.json();
    expect(body).toMatchObject({
      data: null,
      error: { code: "INTERNAL_SERVER_ERROR" },
      meta: { requestId: "request-unknown" },
    });
    expect(JSON.stringify(body)).not.toContain("secret database detail");
  });
});

describe("authenticated platform route flow", () => {
  it("starts with a neutral required question and no assumed business data", async () => {
    const directory = mkdtempSync(join(tmpdir(), "donghaeng-acceptance-create-"));
    temporaryDirectories.push(directory);
    process.env.DONGHAENG_DB_PATH = join(directory, "acceptance-create.db");
    clearServices();

    const bootstrapResponse = await bootstrap(
      jsonRequest("http://localhost/api/auth/bootstrap", "POST", {}),
    );
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const response = await createInterview(
      jsonRequest(
        "http://localhost/api/interviews",
        "POST",
        {
          industryCode: "CAFE",
          requiredInformationList: createDevV1AcceptanceRequiredInformationItems(),
        },
        cookie,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.nextQuestion).toMatchObject({
      infoCode: "monthly_average_sales",
      text: expect.stringContaining("최근 매출 흐름"),
    });
    expect(
      body.data.informationItems.find(
        (item: { infoCode: string }) => item.infoCode === "monthly_average_sales",
      ),
    ).toMatchObject({
      required: true,
      status: "ASKING",
      valueState: "MISSING",
      value: null,
      verification: null,
    });
    expect(body.data.coverage).toMatchObject({
      totalRequired: 8,
      resolvedRequired: 0,
      evaluableRequired: 0,
      overallRate: 0,
    });
    expect(body.data.evidence).toEqual([]);
  });

  it("starts a borrower-selected business without assumed sales or industry facts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "donghaeng-borrower-create-"));
    temporaryDirectories.push(directory);
    process.env.DONGHAENG_DB_PATH = join(directory, "borrower-create.db");
    clearServices();

    const bootstrapResponse = await bootstrap(
      jsonRequest("http://localhost/api/auth/bootstrap", "POST", {}),
    );
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const response = await createInterview(
      jsonRequest(
        "http://localhost/api/interviews",
        "POST",
        {
          industryCode: "BEAUTY",
          profile: {
            borrowerName: "김사장",
            businessName: "봄날헤어",
          },
          requiredInformationList: createDevV1RequiredInformationItems(),
        },
        cookie,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data.borrower).toMatchObject({ name: "김사장" });
    expect(body.data.business).toMatchObject({ businessName: "봄날헤어", industry: "미용" });
    expect(body.data.nextQuestion).toMatchObject({ infoCode: "monthly_average_sales" });
    expect(body.data.nextQuestion.text).toContain("최근 매출 흐름");
    expect(
      body.data.informationItems.find(
        (item: { infoCode: string }) => item.infoCode === "monthly_average_sales",
      ),
    ).toMatchObject({ status: "ASKING", valueState: "MISSING", value: null });
    expect(body.data.evidence).toEqual([]);
  });

  it("accepts a validated RequiredInformationList and rejects malformed catalogs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "donghaeng-required-list-"));
    temporaryDirectories.push(directory);
    process.env.DONGHAENG_DB_PATH = join(directory, "required-list.db");
    clearServices();

    const bootstrapResponse = await bootstrap(
      jsonRequest("http://localhost/api/auth/bootstrap", "POST", {}),
    );
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const requiredInformationList = createDevV1RequiredInformationItems().map((item) =>
      item.infoCode === "fixed_operating_costs"
        ? { ...item, question: "외부 계약에서 받은 월 고정 운영비 질문입니다." }
        : item,
    );
    const accepted = await createInterview(
      jsonRequest(
        "http://localhost/api/interviews",
        "POST",
        { requiredInformationList },
        cookie,
      ),
    );
    const acceptedBody = await accepted.json();

    expect(accepted.status).toBe(201);
    expect(
      acceptedBody.data.informationItems.find(
        (item: { infoCode: string }) => item.infoCode === "fixed_operating_costs",
      )?.question,
    ).toBe("외부 계약에서 받은 월 고정 운영비 질문입니다.");

    const malformed = requiredInformationList.map((item, index) =>
      index === 1 ? { ...item, infoCode: "monthly_average_sales" } : item,
    );
    const rejected = await createInterview(
      jsonRequest(
        "http://localhost/api/interviews",
        "POST",
        { requiredInformationList: malformed },
        cookie,
      ),
    );
    await expect(rejected.json()).resolves.toMatchObject({
      data: null,
      error: { code: "INVALID_REQUIRED_INFORMATION_LIST" },
    });
    expect(rejected.status).toBe(422);
  });

  it("replays more than 100 SSE events without truncating the stream under backpressure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "donghaeng-sse-replay-"));
    temporaryDirectories.push(directory);
    process.env.DONGHAENG_DB_PATH = join(directory, "sse-replay.db");
    clearServices();

    const bootstrapResponse = await bootstrap(
      jsonRequest("http://localhost/api/auth/bootstrap", "POST", {}),
    );
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const interviewId = "bulk-replay-interview";
    const replayEvents: RealtimeEventEnvelope[] = Array.from(
      { length: 130 },
      (_, index) => {
        const seq = index + 1;
        return {
          schemaVersion: 1,
          eventId: `bulk-event-${seq}`,
          seq,
          type: "info.status_changed",
          interviewId,
          aggregateVersion: seq,
          snapshotType: "PREVIEW",
          occurredAt: new Date(seq * 1_000).toISOString(),
          turnId: `bulk-turn-${seq}`,
          batchIndex: 0,
          batchSize: 1,
          isBatchFinal: true,
          snapshotUrl: `/api/interviews/${interviewId}`,
          data: { seq },
        };
      },
    );
    const service = getInterviewService();
    const boundsSpy = vi
      .spyOn(service, "getRealtimeReplayBounds")
      .mockReturnValue({ minimumAvailable: 1, lastEventSeq: replayEvents.length });
    const eventsSpy = vi
      .spyOn(service, "getRealtimeEvents")
      .mockImplementation((_principal, requestedInterviewId, after) =>
        requestedInterviewId === interviewId
          ? replayEvents.filter((event) => event.seq > after)
          : [],
      );
    const abortController = new AbortController();

    try {
      const response = await streamEvents(
        new Request(`http://localhost/api/interviews/${interviewId}/events?after=0`, {
          headers: { cookie },
          signal: abortController.signal,
        }),
        { params: Promise.resolve({ id: interviewId }) },
      );
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      if (!reader) throw new Error("SSE response body is missing");

      const decoder = new TextDecoder();
      let wire = "";
      for (let readCount = 0; readCount < 140 && !wire.includes("id: 130\n"); readCount += 1) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const next = await Promise.race([
          reader.read(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("SSE replay read timed out")), 2_000);
          }),
        ]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        if (next.done) break;
        wire += decoder.decode(next.value, { stream: true });
      }

      const replayedSequences = Array.from(
        wire.matchAll(/^id: (\d+)$/gm),
        (match) => Number(match[1]),
      );
      expect(wire).toContain("retry: 3000");
      expect(wire).not.toContain("event: stream.error");
      expect(replayedSequences).toEqual(
        Array.from({ length: replayEvents.length }, (_, index) => index + 1),
      );
      await reader.cancel();
    } finally {
      abortController.abort();
      boundsSpy.mockRestore();
      eventsSpy.mockRestore();
    }
  });

  it("bootstraps, applies an idempotent turn, replays SSE, and reads FINAL after stop", async () => {
    const directory = mkdtempSync(join(tmpdir(), "donghaeng-api-"));
    temporaryDirectories.push(directory);
    process.env.DONGHAENG_DB_PATH = join(directory, "api-test.db");
    clearServices();

    const unauthorized = await createInterview(
      new Request("http://localhost/api/interviews", {
        method: "POST",
        headers: { origin: "http://localhost" },
      }),
    );
    expect(unauthorized.status).toBe(401);

    const bootstrapResponse = await bootstrap(
      jsonRequest("http://localhost/api/auth/bootstrap", "POST", {}),
    );
    expect(bootstrapResponse.status).toBe(201);
    const cookie = bootstrapResponse.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toMatch(/^donghaeng_session=/);

    const createResponse = await createInterview(
      new Request("http://localhost/api/interviews", {
        method: "POST",
        headers: { origin: "http://localhost", cookie: cookie ?? "" },
      }),
    );
    const createdEnvelope = await createResponse.json();
    expect(createResponse.status).toBe(201);
    const created = createdEnvelope.data;
    const interviewId = created.session.id as string;
    const informationItemsResponse = await getInformationItems(
      new Request(`http://localhost/api/interviews/${interviewId}/information-items`, {
        headers: { cookie: cookie ?? "" },
      }),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(informationItemsResponse.json()).resolves.toMatchObject({
      data: {
        interviewId,
        snapshotType: "PREVIEW",
        informationItems: expect.any(Array),
      },
      error: null,
    });
    const liveFeaturesResponse = await getLiveFeatures(
      new Request(`http://localhost/api/interviews/${interviewId}/live-features`, {
        headers: { cookie: cookie ?? "" },
      }),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(liveFeaturesResponse.json()).resolves.toMatchObject({
      data: {
        interviewId,
        snapshotType: "PREVIEW",
        features: { snapshotType: "PREVIEW" },
        summary: { snapshotType: "PREVIEW" },
      },
      error: null,
    });
    const unauthorizedFeatures = await getLiveFeatures(
      new Request(`http://localhost/api/interviews/${interviewId}/live-features`),
      { params: Promise.resolve({ id: interviewId }) },
    );
    expect(unauthorizedFeatures.status).toBe(401);
    const defaultConsents = await getConsents(
      new Request(`http://localhost/api/interviews/${interviewId}/consents`, {
        headers: { cookie: cookie ?? "" },
      }),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(defaultConsents.json()).resolves.toMatchObject({
      data: {
        microphoneEnabled: false,
        rawAudioStorageEnabled: false,
        cloudAiProcessingEnabled: false,
      },
    });
    const requiredConsent = await getConsents(
      new Request(
        `http://localhost/api/interviews/${interviewId}/consents?require=MICROPHONE_INTERVIEW`,
        { headers: { cookie: cookie ?? "" } },
      ),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(requiredConsent.json()).resolves.toMatchObject({
      data: null,
      error: { code: "MICROPHONE_CONSENT_REQUIRED" },
    });
    const consentResponse = await recordConsent(
      jsonRequest(
        `http://localhost/api/interviews/${interviewId}/consents`,
        "POST",
        {
          purpose: "MICROPHONE_INTERVIEW",
          consentVersion: "microphone-dev-v1",
          granted: true,
          expiresAt: null,
        },
        cookie,
      ),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(consentResponse.json()).resolves.toMatchObject({
      data: {
        purpose: "MICROPHONE_INTERVIEW",
        consentVersion: "microphone-dev-v1",
        effective: true,
      },
      error: null,
    });
    const messageBody = {
      text: "월 2,300만원입니다",
      clientMessageId: "api-message-1",
      expectedVersion: created.session.version,
      currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
    };

    const firstMessage = await addMessage(
      jsonRequest(
        `http://localhost/api/interviews/${interviewId}/messages`,
        "POST",
        messageBody,
        cookie,
      ),
      { params: Promise.resolve({ id: interviewId }) },
    );
    const firstMessageEnvelope = await firstMessage.json();
    const retryMessage = await addMessage(
      jsonRequest(
        `http://localhost/api/interviews/${interviewId}/messages`,
        "POST",
        messageBody,
        cookie,
      ),
      { params: Promise.resolve({ id: interviewId }) },
    );
    expect((await retryMessage.json()).data).toEqual(firstMessageEnvelope.data);

    const abortController = new AbortController();
    const futureCursorResponse = await streamEvents(
      new Request(
        `http://localhost/api/interviews/${interviewId}/events?after=${created.session.lastEventSeq + 999}`,
        { headers: { cookie: cookie ?? "" } },
      ),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(futureCursorResponse.json()).resolves.toMatchObject({
      data: null,
      error: { code: "EVENT_SEQUENCE_AHEAD" },
    });
    const eventResponse = await streamEvents(
      new Request(`http://localhost/api/interviews/${interviewId}/events?after=0`, {
        headers: { cookie: cookie ?? "" },
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: interviewId }) },
    );
    expect(eventResponse.headers.get("content-type")).toContain("text/event-stream");
    const reader = eventResponse.body?.getReader();
    const firstChunk = await reader?.read();
    expect(new TextDecoder().decode(firstChunk?.value)).toContain("retry: 3000");
    await reader?.cancel();
    abortController.abort();

    const completeResponse = await completeInterview(
      jsonRequest(
        `http://localhost/api/interviews/${interviewId}/complete`,
        "POST",
        {
          clientCommandId: "api-complete-1",
          expectedVersion: firstMessageEnvelope.data.snapshot.session.version,
          mode: "FORCE_INCOMPLETE",
          borrowerConfirmed: true,
          reason: "API 통합 테스트 중단",
        },
        cookie,
      ),
      { params: Promise.resolve({ id: interviewId }) },
    );
    expect(completeResponse.status).toBe(200);

    const finalResponse = await getInterview(
      new Request(`http://localhost/api/interviews/${interviewId}`, {
        headers: { cookie: cookie ?? "" },
      }),
      { params: Promise.resolve({ id: interviewId }) },
    );
    await expect(finalResponse.json()).resolves.toMatchObject({
      data: {
        snapshotType: "FINAL",
        session: { snapshotType: "FINAL", lifecycleStatus: "INCOMPLETE" },
      },
      error: null,
      meta: { requestId: expect.any(String) },
    });
  });
});
